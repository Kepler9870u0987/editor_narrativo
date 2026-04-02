/**
 * Fastify Server — Zero Data Retention (ZDR) Proxy for LLM Logic Checks.
 *
 * - No filesystem logging (only stderr for critical crashes)
 * - PII masking before forwarding to external LLM
 * - WebSocket "Stateful Bridge" with session buffers
 * - JWT In-Band Auth on WebSocket (never in URL)
 * - Rate limiting per user
 */

import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRateLimit from '@fastify/rate-limit';
import type { WebSocket } from '@fastify/websocket';
import type { JSONWebKeySet } from 'jose';

import type {
  WSServerMessage,
  LogicCheckResponse,
} from '@editor-narrativo/shared';
import { WS_HEARTBEAT_INTERVAL_MS } from '@editor-narrativo/shared';

import { PIIMasker } from './pii-masker.js';
import {
  SessionBufferManager,
  type SessionAttachment,
} from './session-buffer.js';
import { buildLogicCheckPrompt, parseLogicCheckResponse } from './prompt-builder.js';
import { createJWTVerifier } from './auth.js';
import type { LLMMessage } from './llm-provider.js';
import { OpenAICompatibleProvider, type LLMProvider } from './llm-provider.js';
import {
  parseLogicCheckRequest,
  parseWSClientMessage,
} from './request-validation.js';

export interface ServerConfig {
  port: number;
  host: string;
  jwtSecret?: string;
  jwtJWKS?: JSONWebKeySet;
  jwtIssuer?: string;
  jwtAudience?: string;
  llmProvider: LLMProvider;
  allowedOrigins?: string[];
}

const FASTIFY_BODY_LIMIT_BYTES = 256 * 1024;
const MAX_WS_MESSAGES_PER_MINUTE = 120;
const MAX_CONCURRENT_STREAMS_PER_USER = 3;
const MAX_BUFFERED_TOKENS_PER_SESSION = 2_000;
const MAX_BUFFERED_BYTES_PER_SESSION = 256 * 1024;
const EMPTY_LOGIC_CHECK_RESULT: LogicCheckResponse = {
  hasConflict: false,
  conflicts: [],
  evidence_chains: [],
};

interface WebSocketUserState {
  messageTimestamps: number[];
  activeSessions: Set<string>;
}

function rawMessageToString(raw: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8');
  }

  return raw.toString('utf8');
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function isOriginAllowed(
  origin: string | undefined,
  config: ServerConfig,
): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (config.allowedOrigins && config.allowedOrigins.length > 0) {
    return config.allowedOrigins.includes(normalizedOrigin);
  }

  const expectedHosts = new Set<string>([config.host]);
  if (config.host === '0.0.0.0' || config.host === '::') {
    expectedHosts.add('127.0.0.1');
    expectedHosts.add('localhost');
  }

  const parsedOrigin = new URL(normalizedOrigin);
  return expectedHosts.has(parsedOrigin.hostname);
}

function resolveAllowedOrigin(
  origin: string | undefined,
  config: ServerConfig,
): string | null {
  if (!origin) {
    return null;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin || !isOriginAllowed(origin, config)) {
    return null;
  }

  return normalizedOrigin;
}

function getUserState(
  states: Map<string, WebSocketUserState>,
  userId: string,
): WebSocketUserState {
  const existing = states.get(userId);
  if (existing) {
    return existing;
  }

  const created: WebSocketUserState = {
    messageTimestamps: [],
    activeSessions: new Set<string>(),
  };
  states.set(userId, created);
  return created;
}

function consumeRateLimitSlot(state: WebSocketUserState, now = Date.now()): boolean {
  const cutoff = now - 60_000;
  state.messageTimestamps = state.messageTimestamps.filter((ts) => ts >= cutoff);
  if (state.messageTimestamps.length >= MAX_WS_MESSAGES_PER_MINUTE) {
    return false;
  }
  state.messageTimestamps.push(now);
  return true;
}

function sendSocketMessage(
  socket: WebSocket,
  message: WSServerMessage,
): boolean {
  if (socket.readyState !== socket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function createSocketAttachment(
  socket: WebSocket,
  sessionId: string,
  attachedSessions: Set<string>,
): SessionAttachment {
  return {
    onToken: (token) => {
      const sent = sendSocketMessage(socket, {
        type: 'STREAM_TOKEN',
        token,
        sessionId,
      });
      if (!sent) {
        attachedSessions.delete(sessionId);
      }
      return sent;
    },
    onComplete: (result) => {
      attachedSessions.delete(sessionId);
      return sendSocketMessage(socket, {
        type: 'STREAM_END',
        sessionId,
        result,
      });
    },
    onError: (message) => {
      attachedSessions.delete(sessionId);
      return sendSocketMessage(socket, {
        type: 'STREAM_ERROR',
        sessionId,
        message,
      });
    },
  };
}

function collectStreamCompletion(
  provider: LLMProvider,
  messages: LLMMessage[],
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let fullResponse = '';

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }
      fn();
    };

    const controller = provider.streamCompletion(messages, {
      onToken: (token) => {
        fullResponse += token;
      },
      onComplete: (response) => {
        finish(() => resolve(response || fullResponse));
      },
      onError: (error) => {
        finish(() => reject(error));
      },
    });

    const onAbort = () => {
      controller.abort('Client disconnected');
      finish(() => reject(new Error('LLM stream aborted')));
    };

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function createServer(config: ServerConfig) {
  // ── Zero logging policy: only stderr for crashes ─────────
  const server = Fastify({
    bodyLimit: FASTIFY_BODY_LIMIT_BYTES,
    logger: {
      level: 'error',
      transport: undefined, // No file transport — stderr only
    },
  });

  // ── Plugins ──────────────────────────────────────────────
  await server.register(fastifyWebsocket);
  await server.register(fastifyRateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      // Use user identity from JWT for authenticated requests,
      // fall back to IP + User-Agent fingerprint for unauthenticated
      const auth = request.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        return auth;
      }
      const ua = Array.isArray(request.headers['user-agent'])
        ? request.headers['user-agent'][0] ?? ''
        : request.headers['user-agent'] ?? '';
      return `${request.ip}|${ua}`;
    },
  });

  server.addHook('onRequest', async (request, reply) => {
    const allowedOrigin = resolveAllowedOrigin(request.headers.origin, config);
    if (request.headers.origin && !allowedOrigin) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }

    // Security headers
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (allowedOrigin) {
      reply.header('Access-Control-Allow-Origin', allowedOrigin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  // ── JWT Setup ────────────────────────────────────────────
  const jwtVerifier = config.jwtJWKS
    ? createJWTVerifier({
        jwks: config.jwtJWKS,
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
      })
    : createJWTVerifier({
        secret: config.jwtSecret ?? '',
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
      });

  // ── Session Buffer Manager ───────────────────────────────
  const userStates = new Map<string, WebSocketUserState>();
  const issuedSessions = new Map<string, Set<string>>();

  const releaseUserSession = (ownerId: string, sessionId: string) => {
    const state = userStates.get(ownerId);
    if (!state) return;
    state.activeSessions.delete(sessionId);
  };

  const issueSession = (ownerId: string): string => {
    const sessionId = crypto.randomUUID();
    const current = issuedSessions.get(ownerId) ?? new Set<string>();
    current.add(sessionId);
    issuedSessions.set(ownerId, current);
    return sessionId;
  };

  const consumeIssuedSession = (ownerId: string, sessionId: string): boolean => {
    const current = issuedSessions.get(ownerId);
    if (!current?.has(sessionId)) {
      return false;
    }
    current.delete(sessionId);
    if (current.size === 0) {
      issuedSessions.delete(ownerId);
    }
    return true;
  };

  const bufferManager = new SessionBufferManager({
    maxBufferedTokens: MAX_BUFFERED_TOKENS_PER_SESSION,
    maxBufferedBytes: MAX_BUFFERED_BYTES_PER_SESSION,
    onAbort: (sessionId, session) => {
      releaseUserSession(session.ownerId, sessionId);
    },
  });

  // ── Health Check ─────────────────────────────────────────
  server.get('/health', async () => ({ status: 'ok' }));

  // ── CSP Violation Reports ────────────────────────────────
  server.post('/csp-report', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const report = body?.['csp-report'] ?? body;
      if (report && typeof report === 'object') {
        server.log.warn({ cspReport: report }, 'CSP violation report');
      }
    } catch {
      // Ignore malformed reports
    }
    return reply.code(204).send();
  });

  // ── REST Endpoint (non-streaming) ────────────────────────
  server.post('/api/llm/complete', async (request, reply) => {
    // JWT auth via Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing Authorization header' });
    }

    try {
      await jwtVerifier.verifyToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const body = parseLogicCheckRequest(request.body);
    if (!body) {
      return reply.code(400).send({ error: 'Invalid request payload' });
    }

    const masker = new PIIMasker();
    const abortController = new AbortController();
    const handleAbort = () => {
      abortController.abort('Client disconnected');
    };
    request.raw.once('close', handleAbort);
    try {
      const maskedScene = masker.mask(body.sceneText);
      const maskedContext = body.ragContext.map((c) => masker.mask(c));

      const messages = buildLogicCheckPrompt({
        ...body,
        sceneText: maskedScene,
        ragContext: maskedContext,
      });

      // Forward to LLM (collect full response, no streaming for REST)
      const fullResponse = await collectStreamCompletion(
        config.llmProvider,
        messages,
        abortController.signal,
      );

      // De-mask PII in the response
      const demaskedResponse = masker.demask(fullResponse);
      const parsed = parseLogicCheckResponse(demaskedResponse);

      if (!parsed) {
        return reply.code(502).send({ error: 'LLM returned invalid response format' });
      }

      return parsed;
    } catch (err) {
      if (abortController.signal.aborted) {
        return reply.code(499).send({ error: 'Request aborted' });
      }
      throw err;
    } finally {
      request.raw.off('close', handleAbort);
      masker.destroy();
    }
  });

  // ── WebSocket Endpoint ───────────────────────────────────
  server.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    if (!isOriginAllowed(request.headers.origin, config)) {
      socket.close(4003, 'Origin not allowed');
      return;
    }

    let authenticated = false;
    let userId: string | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const attachedSessions = new Set<string>();

    const cleanupSocket = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      for (const sessionId of attachedSessions) {
        bufferManager.detach(sessionId);
      }
      attachedSessions.clear();
    };

    // Heartbeat
    heartbeatTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, WS_HEARTBEAT_INTERVAL_MS);

    socket.on('message', async (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = parseWSClientMessage(JSON.parse(rawMessageToString(raw)));
        if (!msg) {
          socket.close(4400, 'Invalid message');
          return;
        }

        // ── AUTH (must be first message) ─────────────────
        if (msg.type === 'AUTH') {
          try {
            const payload = await jwtVerifier.verifyToken(msg.token);
            authenticated = true;
            userId = payload.sub;
            sendSocketMessage(socket, { type: 'AUTH_OK' });
          } catch {
            sendSocketMessage(socket, {
              type: 'AUTH_FAIL',
              reason: 'Invalid JWT token',
            });
            socket.close(4001, 'Authentication failed');
          }
          return;
        }

        if (!authenticated || !userId) {
          socket.close(4001, 'Not authenticated');
          return;
        }

        const userState = getUserState(userStates, userId);
        if (!consumeRateLimitSlot(userState)) {
          socket.close(4408, 'Rate limit exceeded');
          return;
        }

        if (msg.type === 'CREATE_SESSION') {
          const sessionId = issueSession(userId);
          sendSocketMessage(socket, { type: 'SESSION_READY', sessionId });
          return;
        }

        // ── RECONNECT (flush buffered tokens) ───────────
        if (msg.type === 'RECONNECT') {
          const attachment = createSocketAttachment(
            socket,
            msg.sessionId,
            attachedSessions,
          );
          attachedSessions.add(msg.sessionId);

          const attachResult = bufferManager.attach(msg.sessionId, userId, attachment);
          if (attachResult.status === 'forbidden') {
            attachedSessions.delete(msg.sessionId);
            socket.close(4003, 'Session access denied');
            return;
          }

          if (attachResult.status === 'missing') {
            attachedSessions.delete(msg.sessionId);
            sendSocketMessage(socket, {
              type: 'STREAM_ERROR',
              sessionId: msg.sessionId,
              message: 'Session not found or expired',
            });
          }
          return;
        }

        // ── LOGIC CHECK (streaming) ─────────────────────
        if (msg.type === 'LOGIC_CHECK') {
          const { payload } = msg;
          const { sessionId } = payload;
          const ownerId = userId;
          if (userState.activeSessions.size >= MAX_CONCURRENT_STREAMS_PER_USER) {
            sendSocketMessage(socket, {
              type: 'STREAM_ERROR',
              sessionId,
              message: 'Too many concurrent streams for this user',
            });
            return;
          }

          if (!consumeIssuedSession(userId, sessionId)) {
            sendSocketMessage(socket, {
              type: 'STREAM_ERROR',
              sessionId,
              message: 'Session ID not issued by the server',
            });
            return;
          }

          const attachment = createSocketAttachment(
            socket,
            sessionId,
            attachedSessions,
          );
          const session = bufferManager.create(sessionId, userId, null, attachment);

          if (!session) {
            sendSocketMessage(socket, {
              type: 'STREAM_ERROR',
              sessionId,
              message: 'Session ID already in use',
            });
            return;
          }

          userState.activeSessions.add(sessionId);
          attachedSessions.add(sessionId);

          const masker = new PIIMasker();
          const maskedScene = masker.mask(payload.sceneText);
          const maskedContext = payload.ragContext.map((c) => masker.mask(c));

          const messages: LLMMessage[] = buildLogicCheckPrompt({
            ...payload,
            sceneText: maskedScene,
            ragContext: maskedContext,
          });

          const controller = config.llmProvider.streamCompletion(messages, {
            onToken: (token) => {
              const demaskedToken = masker.demask(token);

              bufferManager.appendToken(sessionId, demaskedToken);
              if (false && bufferManager.has(sessionId)) {
                // Client disconnected — buffer the token (Detach, Don't Destroy)
                if (!bufferManager.has(sessionId)) {
                  bufferManager.create(sessionId, userId!, null);
                }
                bufferManager.appendToken(sessionId, demaskedToken);
              }
            },
            onComplete: (fullResponse) => {
              const demaskedFull = masker.demask(fullResponse);
              const parsed =
                parseLogicCheckResponse(demaskedFull) ?? EMPTY_LOGIC_CHECK_RESULT;
              masker.destroy();

              releaseUserSession(ownerId, sessionId);
              bufferManager.completeStream(sessionId, parsed);
              if (false) {
                const result = parsed ?? {
                  hasConflict: false,
                  conflicts: [],
                  evidence_chains: [],
                };
                const msg: WSServerMessage = {
                  type: 'STREAM_END',
                  sessionId,
                  result,
                };
                socket.send(JSON.stringify(msg));
              }
            },
            onError: (err) => {
              masker.destroy();
              releaseUserSession(ownerId, sessionId);
              bufferManager.errorStream(sessionId, err.message);
              if (false) {
                const msg: WSServerMessage = {
                  type: 'STREAM_ERROR',
                  sessionId,
                  message: err.message,
                };
                socket.send(JSON.stringify(msg));
              }
            },
          });
          bufferManager.setController(sessionId, controller);
        }
      } catch {
        socket.close(4400, 'Invalid message');
        // Malformed message — ignore (ZDR: don't log payloads)
      }
    });

    socket.on('close', () => {
      cleanupSocket();
    });

    socket.on('error', () => {
      cleanupSocket();
    });
  });

  // ── Graceful shutdown ───────────────────────────────────
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await server.close();
  };

  const handleSignal = () => {
    void shutdown();
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  server.addHook('onClose', async () => {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    bufferManager.destroyAll();
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '4010');
  const host = process.env.HOST ?? '127.0.0.1';

  // Dev-mode stub provider: echoes back a no-conflict result
  const devLlmProvider: LLMProvider = {
    streamCompletion(_messages, callbacks) {
      const controller = new AbortController();
      setTimeout(() => {
        const result = JSON.stringify({
          hasConflict: false,
          conflicts: [],
          evidence_chains: [],
        });
        callbacks.onToken(result);
        callbacks.onComplete(result);
      }, 100);
      return controller;
    },
  };

  const llmProvider: LLMProvider = process.env.LLM_API_KEY
    ? new OpenAICompatibleProvider({
        apiKey: process.env.LLM_API_KEY,
        baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
        model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      })
    : devLlmProvider;

  // Fetch JWKS from account-backend for JWT verification in dev
  const accountBaseUrl = process.env.ACCOUNT_BASE_URL ?? 'http://127.0.0.1:4000';
  let jwtJWKS: import('jose').JSONWebKeySet | undefined;
  let jwtSecret: string | undefined = process.env.JWT_SECRET;
  if (!jwtSecret) {
    try {
      const resp = await fetch(`${accountBaseUrl}/.well-known/jwks.json`);
      if (resp.ok) {
        jwtJWKS = await resp.json() as import('jose').JSONWebKeySet;
        console.log('proxy-backend: using JWKS from account-backend');
      }
    } catch {
      console.warn('proxy-backend: could not fetch JWKS from account-backend, using dev secret');
    }
    if (!jwtJWKS) {
      jwtSecret = 'dev-only-secret-must-be-at-least-32-bytes-long!!';
    }
  }

  createServer({
    port,
    host,
    llmProvider,
    jwtIssuer: process.env.JWT_ISSUER,
    jwtAudience: process.env.JWT_AUDIENCE,
    ...(jwtSecret ? { jwtSecret } : {}),
    ...(jwtJWKS ? { jwtJWKS } : {}),
    allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  })
    .then((server) => server.listen({ port, host }))
    .then((address) => console.log(`proxy-backend listening on ${address}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
