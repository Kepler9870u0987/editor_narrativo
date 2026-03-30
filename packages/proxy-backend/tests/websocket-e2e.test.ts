import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { createJWTService } from '../src/auth.js';
import type { LLMProvider, LLMMessage, LLMStreamCallbacks } from '../src/llm-provider.js';

interface ProviderScriptContext {
  messages: LLMMessage[];
  callbacks: LLMStreamCallbacks;
  controller: AbortController;
}

type ProviderScript = (context: ProviderScriptContext) => void;

class ScriptedProvider implements LLMProvider {
  private scripts: ProviderScript[] = [];

  enqueue(script: ProviderScript): void {
    this.scripts.push(script);
  }

  streamCompletion(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
  ): AbortController {
    const controller = new AbortController();
    const script = this.scripts.shift();

    if (!script) {
      queueMicrotask(() => callbacks.onError(new Error('No scripted response')));
      return controller;
    }

    script({ messages, callbacks, controller });
    return controller;
  }
}

class JsonSocketClient {
  readonly socket: WebSocket;
  private messageQueue: unknown[] = [];
  private waiters: Array<(value: unknown) => void> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      const payload = this.parseMessage(event.data);
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(payload);
      } else {
        this.messageQueue.push(payload);
      }
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === this.socket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.socket.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        this.socket.removeEventListener('open', onOpen);
        reject(new Error('WebSocket failed to open'));
      };

      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('error', onError, { once: true });
    });
  }

  send(payload: unknown): void {
    this.socket.send(JSON.stringify(payload));
  }

  async nextMessage<T = unknown>(): Promise<T> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift() as T;
    }

    return new Promise<T>((resolve) => {
      this.waiters.push((value) => resolve(value as T));
    });
  }

  async close(code?: number, reason?: string): Promise<void> {
    if (this.socket.readyState === this.socket.CLOSED) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.socket.addEventListener('close', () => resolve(), { once: true });
      this.socket.close(code, reason);
    });
  }

  waitForClose(): Promise<CloseEvent> {
    return new Promise((resolve) => {
      this.socket.addEventListener('close', (event) => resolve(event), { once: true });
    });
  }

  private parseMessage(raw: unknown): unknown {
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }

    if (raw instanceof ArrayBuffer) {
      return JSON.parse(Buffer.from(raw).toString('utf8'));
    }

    throw new Error('Unsupported WebSocket message payload');
  }
}

describe('proxy-backend websocket E2E', () => {
  const jwtSecret = 'e2e-secret-that-is-definitely-32-bytes+';
  let server: FastifyInstance;
  let provider: ScriptedProvider;
  let baseUrl: string;
  let jwtService = createJWTService({
    secret: jwtSecret,
    issuer: 'e2e',
    audience: 'e2e',
  });

  beforeEach(async () => {
    provider = new ScriptedProvider();
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      jwtSecret,
      jwtIssuer: 'e2e',
      jwtAudience: 'e2e',
      llmProvider: provider,
      allowedOrigins: ['http://127.0.0.1'],
    });

    await server.listen({ port: 0, host: '127.0.0.1' });
    const address = server.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve server address');
    }
    baseUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    await server.close();
  });

  it('issues a session and streams the final result over a real WebSocket', async () => {
    provider.enqueue(({ callbacks, controller }) => {
      const timers = [
        setTimeout(() => callbacks.onToken('{"has'), 5),
        setTimeout(() => callbacks.onToken('Conflict":false,"conflicts":[],"evidence_chains":[]}'), 10),
        setTimeout(() => callbacks.onComplete('{"hasConflict":false,"conflicts":[],"evidence_chains":[]}'), 15),
      ];

      controller.signal.addEventListener('abort', () => {
        for (const timer of timers) clearTimeout(timer);
        callbacks.onError(new Error('aborted'));
      }, { once: true });
    });

    const token = await jwtService.createToken({ sub: 'user-1' });
    const client = new JsonSocketClient(baseUrl);
    await client.open();

    client.send({ type: 'AUTH', token });
    expect(await client.nextMessage()).toEqual({ type: 'AUTH_OK' });

    client.send({ type: 'CREATE_SESSION' });
    const sessionReady = await client.nextMessage<{ type: 'SESSION_READY'; sessionId: string }>();
    expect(sessionReady.type).toBe('SESSION_READY');

    client.send({
      type: 'LOGIC_CHECK',
      payload: {
        sceneText: 'Test scene',
        ragContext: [],
        sessionId: sessionReady.sessionId,
      },
    });

    const firstToken = await client.nextMessage<{ type: 'STREAM_TOKEN'; token: string }>();
    expect(firstToken.type).toBe('STREAM_TOKEN');
    const secondToken = await client.nextMessage<{ type: 'STREAM_TOKEN'; token: string }>();
    expect(secondToken.type).toBe('STREAM_TOKEN');
    const end = await client.nextMessage<{ type: 'STREAM_END'; result: { hasConflict: boolean } }>();
    expect(end.type).toBe('STREAM_END');
    expect(end.result.hasConflict).toBe(false);

    await client.close();
  });

  it('supports reconnect for the same user and denies reconnect from another user', async () => {
    provider.enqueue(({ callbacks, controller }) => {
      const timers = [
        setTimeout(() => callbacks.onToken('{"hasConflict":'), 5),
        setTimeout(() => callbacks.onToken('false,"conflicts":[],"evidence_chains":[]}'), 40),
        setTimeout(() => callbacks.onComplete('{"hasConflict":false,"conflicts":[],"evidence_chains":[]}'), 60),
      ];

      controller.signal.addEventListener('abort', () => {
        for (const timer of timers) clearTimeout(timer);
        callbacks.onError(new Error('aborted'));
      }, { once: true });
    });

    const tokenA = await jwtService.createToken({ sub: 'owner' });
    const tokenB = await jwtService.createToken({ sub: 'intruder' });

    const owner = new JsonSocketClient(baseUrl);
    await owner.open();
    owner.send({ type: 'AUTH', token: tokenA });
    await owner.nextMessage();
    owner.send({ type: 'CREATE_SESSION' });
    const sessionReady = await owner.nextMessage<{ type: 'SESSION_READY'; sessionId: string }>();

    owner.send({
      type: 'LOGIC_CHECK',
      payload: {
        sceneText: 'Reconnect me',
        ragContext: [],
        sessionId: sessionReady.sessionId,
      },
    });

    const firstToken = await owner.nextMessage<{ type: 'STREAM_TOKEN'; token: string }>();
    expect(firstToken.type).toBe('STREAM_TOKEN');
    await owner.close();

    const intruder = new JsonSocketClient(baseUrl);
    await intruder.open();
    intruder.send({ type: 'AUTH', token: tokenB });
    await intruder.nextMessage();
    const intruderClose = intruder.waitForClose();
    intruder.send({ type: 'RECONNECT', sessionId: sessionReady.sessionId });
    expect((await intruderClose).code).toBe(4003);

    const reconnect = new JsonSocketClient(baseUrl);
    await reconnect.open();
    reconnect.send({ type: 'AUTH', token: tokenA });
    await reconnect.nextMessage();
    reconnect.send({ type: 'RECONNECT', sessionId: sessionReady.sessionId });

    const resumedToken = await reconnect.nextMessage<{ type: 'STREAM_TOKEN'; token: string }>();
    expect(resumedToken.type).toBe('STREAM_TOKEN');
    const end = await reconnect.nextMessage<{ type: 'STREAM_END' }>();
    expect(end.type).toBe('STREAM_END');

    await reconnect.close();
  });

  it('enforces server-issued sessions and concurrent stream limits', async () => {
    for (let i = 0; i < 4; i++) {
      provider.enqueue(({ controller }) => {
        controller.signal.addEventListener('abort', () => {}, { once: true });
      });
    }

    const token = await jwtService.createToken({ sub: 'limited-user' });
    const client = new JsonSocketClient(baseUrl);
    await client.open();
    client.send({ type: 'AUTH', token });
    await client.nextMessage();

    client.send({
      type: 'LOGIC_CHECK',
      payload: {
        sceneText: 'No issued session',
        ragContext: [],
        sessionId: 'not-issued',
      },
    });
    const missingIssueError = await client.nextMessage<{ type: 'STREAM_ERROR'; message: string }>();
    expect(missingIssueError.message).toContain('not issued');

    const sessionIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      client.send({ type: 'CREATE_SESSION' });
      const ready = await client.nextMessage<{ type: 'SESSION_READY'; sessionId: string }>();
      sessionIds.push(ready.sessionId);
    }

    for (let i = 0; i < 3; i++) {
      client.send({
        type: 'LOGIC_CHECK',
        payload: {
          sceneText: `Scene ${i}`,
          ragContext: [],
          sessionId: sessionIds[i]!,
        },
      });
    }

    client.send({
      type: 'LOGIC_CHECK',
      payload: {
        sceneText: 'Too many',
        ragContext: [],
        sessionId: sessionIds[3]!,
      },
    });

    const concurrentLimitError = await client.nextMessage<{ type: 'STREAM_ERROR'; message: string }>();
    expect(concurrentLimitError.message).toContain('Too many concurrent streams');

    await client.close();
  });

  it('closes the socket when the websocket message rate limit is exceeded', async () => {
    const token = await jwtService.createToken({ sub: 'rate-limited-user' });
    const client = new JsonSocketClient(baseUrl);
    await client.open();
    client.send({ type: 'AUTH', token });
    await client.nextMessage();

    const closePromise = client.waitForClose();
    for (let i = 0; i < 121; i++) {
      client.send({ type: 'CREATE_SESSION' });
    }

    expect((await closePromise).code).toBe(4408);
  });
});
