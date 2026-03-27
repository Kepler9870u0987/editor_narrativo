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
import fastifyWebsocket from '@fastify/websocket';
import fastifyRateLimit from '@fastify/rate-limit';
import type { WebSocket } from '@fastify/websocket';

import type {
  WSClientMessage,
  WSServerMessage,
  LogicCheckRequest,
} from '@editor-narrativo/shared';
import { WS_HEARTBEAT_INTERVAL_MS } from '@editor-narrativo/shared';

import { PIIMasker } from './pii-masker.js';
import { SessionBufferManager } from './session-buffer.js';
import { buildLogicCheckPrompt, parseLogicCheckResponse } from './prompt-builder.js';
import { initJWT, verifyToken } from './auth.js';
import type { LLMProvider, LLMMessage } from './llm-provider.js';

export interface ServerConfig {
  port: number;
  host: string;
  jwtSecret: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  llmProvider: LLMProvider;
}

export async function createServer(config: ServerConfig) {
  // ── Zero logging policy: only stderr for crashes ─────────
  const server = Fastify({
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
  });

  // ── JWT Setup ────────────────────────────────────────────
  initJWT({
    secret: config.jwtSecret,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  });

  // ── Session Buffer Manager ───────────────────────────────
  const bufferManager = new SessionBufferManager();

  // ── Health Check ─────────────────────────────────────────
  server.get('/health', async () => ({ status: 'ok', sessions: bufferManager.activeSessionCount }));

  // ── REST Endpoint (non-streaming) ────────────────────────
  server.post<{ Body: LogicCheckRequest }>('/api/llm/complete', async (request, reply) => {
    // JWT auth via Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing Authorization header' });
    }

    try {
      await verifyToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const masker = new PIIMasker();
    try {
      const body = request.body;
      const maskedScene = masker.mask(body.sceneText);
      const maskedContext = body.ragContext.map((c) => masker.mask(c));

      const messages = buildLogicCheckPrompt({
        ...body,
        sceneText: maskedScene,
        ragContext: maskedContext,
      });

      // Forward to LLM (collect full response, no streaming for REST)
      const fullResponse = await new Promise<string>((resolve, reject) => {
        let response = '';
        config.llmProvider.streamCompletion(messages as LLMMessage[], {
          onToken: (token) => { response += token; },
          onComplete: () => resolve(response),
          onError: reject,
        });
      });

      // De-mask PII in the response
      const demaskedResponse = masker.demask(fullResponse);
      const parsed = parseLogicCheckResponse(demaskedResponse);

      if (!parsed) {
        return reply.code(502).send({ error: 'LLM returned invalid response format' });
      }

      return parsed;
    } finally {
      masker.destroy();
    }
  });

  // ── WebSocket Endpoint ───────────────────────────────────
  server.get('/ws', { websocket: true }, (socket: WebSocket) => {
    let authenticated = false;
    let userId: string | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    // Heartbeat
    heartbeatTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, WS_HEARTBEAT_INTERVAL_MS);

    socket.on('message', async (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(raw.toString()) as WSClientMessage;

        // ── AUTH (must be first message) ─────────────────
        if (msg.type === 'AUTH') {
          try {
            const payload = await verifyToken(msg.token);
            authenticated = true;
            userId = payload.sub;
            const response: WSServerMessage = { type: 'AUTH_OK' };
            socket.send(JSON.stringify(response));
          } catch {
            const response: WSServerMessage = {
              type: 'AUTH_FAIL',
              reason: 'Invalid JWT token',
            };
            socket.send(JSON.stringify(response));
            socket.close(4001, 'Authentication failed');
          }
          return;
        }

        if (!authenticated) {
          socket.close(4001, 'Not authenticated');
          return;
        }

        // ── RECONNECT (flush buffered tokens) ───────────
        if (msg.type === 'RECONNECT') {
          const session = bufferManager.flush(msg.sessionId);
          if (session) {
            const flushMsg: WSServerMessage = {
              type: 'BUFFER_FLUSH',
              tokens: session.tokens,
              sessionId: msg.sessionId,
            };
            socket.send(JSON.stringify(flushMsg));

            if (session.streamCompleted && session.finalResult) {
              const endMsg: WSServerMessage = {
                type: 'STREAM_END',
                sessionId: msg.sessionId,
                result: session.finalResult as any,
              };
              socket.send(JSON.stringify(endMsg));
            }
            if (session.error) {
              const errMsg: WSServerMessage = {
                type: 'STREAM_ERROR',
                sessionId: msg.sessionId,
                message: session.error,
              };
              socket.send(JSON.stringify(errMsg));
            }
          }
          return;
        }

        // ── LOGIC CHECK (streaming) ─────────────────────
        if (msg.type === 'LOGIC_CHECK') {
          const { payload } = msg;
          const { sessionId } = payload;

          const masker = new PIIMasker();
          const maskedScene = masker.mask(payload.sceneText);
          const maskedContext = payload.ragContext.map((c) => masker.mask(c));

          const messages = buildLogicCheckPrompt({
            ...payload,
            sceneText: maskedScene,
            ragContext: maskedContext,
          });

          config.llmProvider.streamCompletion(messages as LLMMessage[], {
            onToken: (token) => {
              const demaskedToken = masker.demask(token);

              if (socket.readyState === socket.OPEN) {
                const msg: WSServerMessage = {
                  type: 'STREAM_TOKEN',
                  token: demaskedToken,
                  sessionId,
                };
                socket.send(JSON.stringify(msg));
              } else {
                // Client disconnected — buffer the token (Detach, Don't Destroy)
                if (!bufferManager.has(sessionId)) {
                  bufferManager.create(sessionId);
                }
                bufferManager.appendToken(sessionId, demaskedToken);
              }
            },
            onComplete: (fullResponse) => {
              const demaskedFull = masker.demask(fullResponse);
              const parsed = parseLogicCheckResponse(demaskedFull);
              masker.destroy();

              if (socket.readyState === socket.OPEN) {
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
              } else {
                bufferManager.completeStream(sessionId, parsed);
              }
            },
            onError: (err) => {
              masker.destroy();
              if (socket.readyState === socket.OPEN) {
                const msg: WSServerMessage = {
                  type: 'STREAM_ERROR',
                  sessionId,
                  message: err.message,
                };
                socket.send(JSON.stringify(msg));
              } else {
                bufferManager.errorStream(sessionId, err.message);
              }
            },
          });
        }
      } catch (err) {
        // Malformed message — ignore (ZDR: don't log payloads)
      }
    });

    socket.on('close', () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    });

    socket.on('error', () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    });
  });

  // ── Graceful shutdown ───────────────────────────────────
  const shutdown = async () => {
    bufferManager.destroyAll();
    await server.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
