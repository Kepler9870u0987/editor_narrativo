import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAccountServer } from '../../account-backend/src/server.js';
import { createDocumentsServer } from '../src/server.js';
import type {
  DocumentWSServerMessage,
  EncryptedDocumentUpdate,
} from '@editor-narrativo/documents-shared';

interface JsonResponse<T> {
  status: number;
  body: T;
  setCookie: string | null;
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    cookie?: string;
  } = {},
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as T) : ({} as T),
    setCookie: response.headers.get('set-cookie'),
  };
}

function cookieValue(setCookie: string | null): string | null {
  return setCookie?.split(';')[0] ?? null;
}

async function waitForWSMessage<T extends DocumentWSServerMessage>(
  socket: WebSocket,
  matcher: (message: DocumentWSServerMessage) => message is T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, 5_000);

    const onMessage = (event: MessageEvent) => {
      const parsed = JSON.parse(String(event.data)) as DocumentWSServerMessage;
      if (!matcher(parsed)) {
        return;
      }
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      resolve(parsed);
    };

    socket.addEventListener('message', onMessage);
  });
}

describe('documents-backend E2E', () => {
  let accountServer: FastifyInstance;
  let documentsServer: FastifyInstance;
  let accountBaseUrl: string;
  let documentsBaseUrl: string;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'editor-narrativo-documents-'));

    const account = await createAccountServer({
      port: 0,
      host: '127.0.0.1',
      dbPath: join(tempDir, 'account.sqlite'),
      issuer: 'https://accounts.editor.test',
      audience: 'editor-narrativo',
      exposeInternalTokens: true,
      secureCookies: false,
      rpId: '127.0.0.1',
      rpOrigin: 'http://127.0.0.1',
      rpName: 'Editor Narrativo Test',
    });
    accountServer = account.server;
    await accountServer.listen({ port: 0, host: '127.0.0.1' });
    const accountAddress = accountServer.server.address();
    if (!accountAddress || typeof accountAddress === 'string') {
      throw new Error('Unable to resolve account server address');
    }
    accountBaseUrl = `http://127.0.0.1:${accountAddress.port}`;

    const jwks = await requestJson<{ keys: JsonWebKey[] }>(
      accountBaseUrl,
      '/.well-known/jwks.json',
    );

    const documents = await createDocumentsServer({
      port: 0,
      host: '127.0.0.1',
      dbPath: join(tempDir, 'documents.sqlite'),
      jwtJWKS: jwks.body,
      jwtIssuer: 'https://accounts.editor.test',
      jwtAudience: 'editor-narrativo',
    });
    documentsServer = documents.server;
    await documentsServer.listen({ port: 0, host: '127.0.0.1' });
    const documentsAddress = documentsServer.server.address();
    if (!documentsAddress || typeof documentsAddress === 'string') {
      throw new Error('Unable to resolve documents server address');
    }
    documentsBaseUrl = `http://127.0.0.1:${documentsAddress.port}`;
  });

  afterEach(async () => {
    await documentsServer.close();
    await accountServer.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function registerAndLogin(email: string): Promise<{ accessToken: string; cookie: string }> {
    const register = await requestJson<{ verificationToken: string }>(accountBaseUrl, '/auth/register', {
      method: 'POST',
      body: {
        email,
        password: 'very-secure-password',
      },
    });
    await requestJson(accountBaseUrl, '/auth/verify-email', {
      method: 'POST',
      body: {
        email,
        token: register.body.verificationToken,
      },
    });
    const login = await requestJson<{ accessToken: string }>(accountBaseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email,
        password: 'very-secure-password',
      },
    });
    return {
      accessToken: login.body.accessToken,
      cookie: cookieValue(login.setCookie)!,
    };
  }

  it('creates documents, persists snapshots and batches updates', async () => {
    const auth = await registerAndLogin('documents@example.com');

    const created = await requestJson<{ id: string; latestClock: number }>(
      documentsBaseUrl,
      '/documents',
      {
        method: 'POST',
        token: auth.accessToken,
        body: {
          title: 'Capitolo 1',
          kind: 'manuscript',
        },
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.latestClock).toBe(0);

    const saveSnapshot = await requestJson<{ saved: boolean }>(
      documentsBaseUrl,
      `/documents/${created.body.id}/snapshot`,
      {
        method: 'PUT',
        token: auth.accessToken,
        body: {
          snapshot: {
            documentId: created.body.id,
            snapshotId: crypto.randomUUID(),
            encryptedData: 'ciphertext-v1',
            iv: 'iv-v1',
            signature: 'signature-v1',
            publicKey: 'public-key-v1',
            clock: 1,
            createdAt: new Date().toISOString(),
          },
        },
      },
    );
    expect(saveSnapshot.status).toBe(200);
    expect(saveSnapshot.body.saved).toBe(true);

    const batch = await requestJson<{ accepted: number; latestClock: number }>(
      documentsBaseUrl,
      `/documents/${created.body.id}/updates/batch`,
      {
        method: 'POST',
        token: auth.accessToken,
        body: {
          updates: [
            {
              documentId: created.body.id,
              updateId: crypto.randomUUID(),
              encryptedData: 'ciphertext-u2',
              iv: 'iv-u2',
              signature: 'signature-u2',
              publicKey: 'public-key-u2',
              clock: 2,
              createdAt: new Date().toISOString(),
            },
            {
              documentId: created.body.id,
              updateId: crypto.randomUUID(),
              encryptedData: 'ciphertext-u3',
              iv: 'iv-u3',
              signature: 'signature-u3',
              publicKey: 'public-key-u3',
              clock: 3,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      },
    );
    expect(batch.status).toBe(200);
    expect(batch.body.accepted).toBe(2);
    expect(batch.body.latestClock).toBe(3);

    const documents = await requestJson<Array<{ id: string; latestClock: number; hasSnapshot: boolean }>>(
      documentsBaseUrl,
      '/documents',
      { token: auth.accessToken },
    );
    expect(documents.status).toBe(200);
    expect(documents.body[0]!.id).toBe(created.body.id);
    expect(documents.body[0]!.latestClock).toBe(3);
    expect(documents.body[0]!.hasSnapshot).toBe(true);

    const updates = await requestJson<{ updates: EncryptedDocumentUpdate[] }>(
      documentsBaseUrl,
      `/documents/${created.body.id}/updates?afterClock=1`,
      { token: auth.accessToken },
    );
    expect(updates.status).toBe(200);
    expect(updates.body.updates).toHaveLength(2);
  });

  it('authenticates WebSocket clients, publishes update ack and serves missing updates', async () => {
    const auth = await registerAndLogin('ws-documents@example.com');

    const created = await requestJson<{ id: string }>(
      documentsBaseUrl,
      '/documents',
      {
        method: 'POST',
        token: auth.accessToken,
        body: {
          title: 'Story Bible',
          kind: 'story_bible',
        },
      },
    );

    const socket = new WebSocket(documentsBaseUrl.replace('http', 'ws') + '/ws/documents');
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true });
    });

    socket.send(JSON.stringify({ type: 'AUTH', token: auth.accessToken }));
    await waitForWSMessage(socket, (message): message is { type: 'AUTH_OK' } => message.type === 'AUTH_OK');

    socket.send(JSON.stringify({ type: 'SUBSCRIBE_DOCUMENT', documentId: created.body.id }));
    const snapshotMessage = await waitForWSMessage(
      socket,
      (message): message is { type: 'SNAPSHOT'; snapshot: null } => message.type === 'SNAPSHOT',
    );
    expect(snapshotMessage.snapshot).toBeNull();

    const update: EncryptedDocumentUpdate = {
      documentId: created.body.id,
      updateId: crypto.randomUUID(),
      encryptedData: 'ciphertext-ws',
      iv: 'iv-ws',
      signature: 'signature-ws',
      publicKey: 'public-key-ws',
      clock: 1,
      createdAt: new Date().toISOString(),
    };
    socket.send(JSON.stringify({ type: 'PUSH_UPDATE', update }));
    const ack = await waitForWSMessage(
      socket,
      (message): message is { type: 'UPDATE_ACK'; documentId: string; updateId: string; clock: number } =>
        message.type === 'UPDATE_ACK',
    );
    expect(ack.documentId).toBe(created.body.id);
    expect(ack.clock).toBe(1);

    socket.send(JSON.stringify({
      type: 'REQUEST_MISSING_UPDATES',
      documentId: created.body.id,
      afterClock: 0,
    }));
    const missing = await waitForWSMessage(
      socket,
      (message): message is { type: 'MISSING_UPDATES'; documentId: string; updates: EncryptedDocumentUpdate[] } =>
        message.type === 'MISSING_UPDATES',
    );
    expect(missing.documentId).toBe(created.body.id);
    expect(missing.updates).toHaveLength(1);

    socket.close();
  });
});
