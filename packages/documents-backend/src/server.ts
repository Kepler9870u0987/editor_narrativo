import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRateLimit from '@fastify/rate-limit';
import type { WebSocket } from '@fastify/websocket';
import type { JSONWebKeySet } from 'jose';
import { ZodError } from 'zod';
import {
  createJWTVerifier,
  type JWTVerifier,
} from '@editor-narrativo/proxy-backend';
import type {
  CreateDocumentRequest,
  DocumentWSClientMessage,
  DocumentWSServerMessage,
  PostUpdatesBatchRequest,
  PutSnapshotRequest,
  UpdateDocumentRequest,
} from '@editor-narrativo/documents-shared';
import { SQLiteDocumentsRepository } from './repository.js';
import {
  CreateDocumentRequestSchema,
  UpdateDocumentRequestSchema,
  PutSnapshotRequestSchema,
  PostUpdatesBatchRequestSchema,
} from './validation.js';

const FASTIFY_BODY_LIMIT_BYTES = 512 * 1024;

export interface DocumentsServerConfig {
  port: number;
  host: string;
  dbPath?: string;
  allowedOrigins?: string[];
  jwtSecret?: string;
  jwtJWKS?: JSONWebKeySet;
  jwtIssuer?: string;
  jwtAudience?: string;
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function isOriginAllowed(origin: string | undefined, config: DocumentsServerConfig): boolean {
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

  return true;
}

function resolveAllowedOrigin(origin: string | undefined, config: DocumentsServerConfig): string | null {
  if (!origin) {
    return null;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized || !isOriginAllowed(origin, config)) {
    return null;
  }

  return normalized;
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid payload');
  }
  return value as Record<string, unknown>;
}

function zodParse<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      const message = err.issues.map((e) => e.message).join('; ');
      throw new Error(message);
    }
    throw new Error('Invalid payload');
  }
}

function parseCreateDocumentRequest(value: unknown): CreateDocumentRequest {
  return zodParse(CreateDocumentRequestSchema, value);
}

function parseUpdateDocumentRequest(value: unknown): UpdateDocumentRequest {
  return zodParse(UpdateDocumentRequestSchema, value);
}

function parseSnapshotRequest(value: unknown): PutSnapshotRequest {
  return zodParse(PutSnapshotRequestSchema, value);
}

function parseUpdatesBatchRequest(value: unknown): PostUpdatesBatchRequest {
  return zodParse(PostUpdatesBatchRequestSchema, value);
}

function parseWSMessage(value: unknown): DocumentWSClientMessage | null {
  const record = expectRecord(value);
  switch (record.type) {
    case 'AUTH':
      return typeof record.token === 'string'
        ? { type: 'AUTH', token: record.token }
        : null;
    case 'SUBSCRIBE_DOCUMENT':
      return typeof record.documentId === 'string'
        ? { type: 'SUBSCRIBE_DOCUMENT', documentId: record.documentId }
        : null;
    case 'PUSH_UPDATE': {
      const parsed = parseUpdatesBatchRequest({ updates: [record.update] });
      return { type: 'PUSH_UPDATE', update: parsed.updates[0]! };
    }
    case 'REQUEST_MISSING_UPDATES':
      return typeof record.documentId === 'string' && typeof record.afterClock === 'number'
        ? { type: 'REQUEST_MISSING_UPDATES', documentId: record.documentId, afterClock: record.afterClock }
        : null;
    case 'PING':
      return { type: 'PING' };
    default:
      return null;
  }
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

function sendSocketMessage(socket: WebSocket, message: DocumentWSServerMessage): boolean {
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

async function authenticateRequest(
  authHeader: string | undefined,
  verifier: JWTVerifier,
): Promise<{ userId: string }> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing Authorization header');
  }

  const payload = await verifier.verifyToken(authHeader.slice(7));
  return { userId: payload.sub };
}

export async function createDocumentsServer(config: DocumentsServerConfig) {
  const server = Fastify({
    bodyLimit: FASTIFY_BODY_LIMIT_BYTES,
    logger: {
      level: 'error',
      transport: undefined,
    },
  });

  const repository = new SQLiteDocumentsRepository(
    resolve(config.dbPath ?? join(process.cwd(), 'var', 'documents-backend.sqlite')),
  );
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

  const subscribers = new Map<string, Set<WebSocket>>();

  const subscribeSocket = (documentId: string, socket: WebSocket) => {
    const set = subscribers.get(documentId) ?? new Set<WebSocket>();
    set.add(socket);
    subscribers.set(documentId, set);
  };

  const unsubscribeSocket = (socket: WebSocket) => {
    for (const [documentId, set] of subscribers) {
      set.delete(socket);
      if (set.size === 0) {
        subscribers.delete(documentId);
      }
    }
  };

  const broadcastUpdate = (documentId: string, message: DocumentWSServerMessage, exclude?: WebSocket) => {
    const set = subscribers.get(documentId);
    if (!set) {
      return;
    }
    for (const socket of set) {
      if (socket === exclude) {
        continue;
      }
      sendSocketMessage(socket, message);
    }
  };

  server.addHook('onClose', async () => {
    repository.close();
  });

  await server.register(fastifyWebsocket);
  await server.register(fastifyRateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
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
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    }

    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  server.get('/health', async () => ({ status: 'ok' }));

  server.post('/documents', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      const created = repository.createDocument(auth.userId, parseCreateDocumentRequest(request.body));
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  });

  server.get('/documents', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      return reply.send(repository.listDocumentsForUser(auth.userId));
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  server.get('/documents/:id', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      const params = expectRecord(request.params);
      const documentId = String(params.id);
      const document = repository.getDocument(documentId);
      if (!document || document.ownerUserId !== auth.userId) {
        return reply.code(404).send({ error: 'Document not found' });
      }
      return reply.send(document);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  server.patch('/documents/:id', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      const params = expectRecord(request.params);
      const documentId = String(params.id);
      const current = repository.getDocument(documentId);
      if (!current || current.ownerUserId !== auth.userId) {
        return reply.code(404).send({ error: 'Document not found' });
      }
      const updated = repository.updateDocument(documentId, parseUpdateDocumentRequest(request.body));
      return reply.send(updated);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  });

  server.get('/documents/:id/snapshot', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      const params = expectRecord(request.params);
      const documentId = String(params.id);
      const current = repository.getDocument(documentId);
      if (!current || current.ownerUserId !== auth.userId) {
        return reply.code(404).send({ error: 'Document not found' });
      }
      const snapshot = repository.getSnapshot(documentId);
      if (!snapshot) {
        return reply.code(404).send({ error: 'Snapshot not found' });
      }
      return reply.send(snapshot);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  server.put('/documents/:id/snapshot', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      const params = expectRecord(request.params);
      const documentId = String(params.id);
      const current = repository.getDocument(documentId);
      if (!current || current.ownerUserId !== auth.userId) {
        return reply.code(404).send({ error: 'Document not found' });
      }
      const body = parseSnapshotRequest(request.body);
      if (body.snapshot.documentId !== documentId) {
        return reply.code(400).send({ error: 'Snapshot document mismatch' });
      }
      repository.putSnapshot(body.snapshot);
      return reply.send({ saved: true });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  });

  server.get('/documents/:id/updates', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      const params = expectRecord(request.params);
      const query = expectRecord(request.query);
      const documentId = String(params.id);
      const current = repository.getDocument(documentId);
      if (!current || current.ownerUserId !== auth.userId) {
        return reply.code(404).send({ error: 'Document not found' });
      }
      const afterClock = typeof query.afterClock === 'string' ? Number(query.afterClock) : 0;
      return reply.send({
        documentId,
        updates: repository.listUpdatesAfter(documentId, Number.isFinite(afterClock) ? afterClock : 0),
      });
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  server.post('/documents/:id/updates/batch', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request.headers.authorization, jwtVerifier);
      const params = expectRecord(request.params);
      const documentId = String(params.id);
      const current = repository.getDocument(documentId);
      if (!current || current.ownerUserId !== auth.userId) {
        return reply.code(404).send({ error: 'Document not found' });
      }
      const body = parseUpdatesBatchRequest(request.body);
      const result = repository.appendUpdates(documentId, body.updates);
      for (const update of result.accepted) {
        broadcastUpdate(documentId, { type: 'REMOTE_UPDATE', update });
      }
      return reply.send({
        accepted: result.accepted.length,
        latestClock: result.latestClock,
      });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Update rejected' });
    }
  });

  server.get('/ws/documents', { websocket: true }, (socket: WebSocket, request) => {
    if (!isOriginAllowed(request.headers.origin, config)) {
      socket.close(4003, 'Origin not allowed');
      return;
    }

    let userId: string | null = null;

    const handleClose = () => {
      unsubscribeSocket(socket);
    };

    socket.on('close', handleClose);
    socket.on('error', handleClose);

    socket.on('message', async (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const message = parseWSMessage(JSON.parse(rawMessageToString(raw)));
        if (!message) {
          socket.close(4400, 'Invalid message');
          return;
        }

        if (message.type === 'AUTH') {
          try {
            const payload = await jwtVerifier.verifyToken(message.token);
            userId = payload.sub;
            sendSocketMessage(socket, { type: 'AUTH_OK' });
          } catch {
            sendSocketMessage(socket, { type: 'AUTH_FAIL', reason: 'Invalid token' });
            socket.close(4001, 'Authentication failed');
          }
          return;
        }

        if (!userId) {
          socket.close(4001, 'Not authenticated');
          return;
        }

        if (message.type === 'PING') {
          sendSocketMessage(socket, { type: 'PONG' });
          return;
        }

        if (message.type === 'SUBSCRIBE_DOCUMENT') {
          const document = repository.getDocument(message.documentId);
          if (!document || document.ownerUserId !== userId) {
            sendSocketMessage(socket, { type: 'ERROR', message: 'Document not found', documentId: message.documentId });
            return;
          }
          subscribeSocket(message.documentId, socket);
          sendSocketMessage(socket, {
            type: 'SNAPSHOT',
            snapshot: repository.getSnapshot(message.documentId),
          });
          return;
        }

        if (message.type === 'REQUEST_MISSING_UPDATES') {
          const document = repository.getDocument(message.documentId);
          if (!document || document.ownerUserId !== userId) {
            sendSocketMessage(socket, { type: 'ERROR', message: 'Document not found', documentId: message.documentId });
            return;
          }
          sendSocketMessage(socket, {
            type: 'MISSING_UPDATES',
            documentId: message.documentId,
            updates: repository.listUpdatesAfter(message.documentId, message.afterClock),
          });
          return;
        }

        if (message.type === 'PUSH_UPDATE') {
          const document = repository.getDocument(message.update.documentId);
          if (!document || document.ownerUserId !== userId) {
            sendSocketMessage(socket, { type: 'ERROR', message: 'Document not found', documentId: message.update.documentId });
            return;
          }

          try {
            repository.appendUpdates(message.update.documentId, [message.update]);
            sendSocketMessage(socket, {
              type: 'UPDATE_ACK',
              documentId: message.update.documentId,
              updateId: message.update.updateId,
              clock: message.update.clock,
            });
            broadcastUpdate(message.update.documentId, { type: 'REMOTE_UPDATE', update: message.update }, socket);
          } catch (error) {
            sendSocketMessage(socket, {
              type: 'RESYNC_REQUIRED',
              documentId: message.update.documentId,
              reason: error instanceof Error ? error.message : 'Update rejected',
            });
          }
        }
      } catch {
        socket.close(4400, 'Invalid message');
      }
    });
  });

  return { server, repository };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '4100');
  const host = process.env.HOST ?? '127.0.0.1';
  const jwtIssuer = process.env.JWT_ISSUER;
  const jwtAudience = process.env.JWT_AUDIENCE;
  const jwtSecret = process.env.JWT_SECRET;

  createDocumentsServer({
    port,
    host,
    jwtIssuer,
    jwtAudience,
    ...(jwtSecret ? { jwtSecret } : {}),
  })
    .then(({ server }) => server.listen({ port, host }))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
