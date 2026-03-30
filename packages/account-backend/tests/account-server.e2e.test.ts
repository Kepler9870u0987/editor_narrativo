import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAccountServer } from '../src/server.js';
import { generateTotpCode } from '../src/totp.js';
import { createServer as createProxyServer } from '../../proxy-backend/src/server.js';
import type { LLMProvider, LLMMessage, LLMStreamCallbacks } from '../../proxy-backend/src/llm-provider.js';

interface JsonResponse<T> {
  status: number;
  body: T;
  setCookie: string | null;
}

class ImmediateProvider implements LLMProvider {
  streamCompletion(
    _messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
  ): AbortController {
    const controller = new AbortController();
    queueMicrotask(() => {
      callbacks.onComplete('{"hasConflict":false,"conflicts":[],"evidence_chains":[]}');
    });
    return controller;
  }
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
    body: text ? JSON.parse(text) as T : ({} as T),
    setCookie: response.headers.get('set-cookie'),
  };
}

function cookieValue(setCookie: string | null): string | null {
  return setCookie?.split(';')[0] ?? null;
}

describe('account-backend E2E', () => {
  let accountServer: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    const context = await createAccountServer({
      port: 0,
      host: '127.0.0.1',
      issuer: 'https://accounts.editor.test',
      audience: 'editor-narrativo',
      exposeInternalTokens: true,
      secureCookies: false,
    });
    accountServer = context.server;
    await accountServer.listen({ port: 0, host: '127.0.0.1' });

    const address = accountServer.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to resolve account server address');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await accountServer.close();
  });

  it('registers, verifies, logs in, rotates refresh tokens and manages key material', async () => {
    const register = await requestJson<{
      verificationToken: string;
      user: { status: string };
    }>(baseUrl, '/auth/register', {
      method: 'POST',
      body: {
        email: 'alice@example.com',
        password: 'very-secure-password',
        displayName: 'Alice',
      },
    });
    expect(register.status).toBe(201);
    expect(register.body.user.status).toBe('pending');

    const verify = await requestJson<{ verified: boolean }>(baseUrl, '/auth/verify-email', {
      method: 'POST',
      body: {
        email: 'alice@example.com',
        token: register.body.verificationToken,
      },
    });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);

    const login = await requestJson<{
      accessToken: string;
      sessionId: string;
      user: { emailVerifiedAt: string };
    }>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: 'alice@example.com',
        password: 'very-secure-password',
        deviceName: 'Vitest Browser',
      },
    });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerifiedAt).toBeTruthy();
    const refreshCookie = cookieValue(login.setCookie);
    expect(refreshCookie).toBeTruthy();

    const me = await requestJson<{ email: string; displayName: string }>(baseUrl, '/me', {
      token: login.body.accessToken,
    });
    expect(me.body.email).toBe('alice@example.com');
    expect(me.body.displayName).toBe('Alice');

    const updated = await requestJson<{ displayName: string }>(baseUrl, '/me', {
      method: 'PATCH',
      token: login.body.accessToken,
      body: { displayName: 'Alice Revised' },
    });
    expect(updated.body.displayName).toBe('Alice Revised');

    const bootstrap = await requestJson<{ userId: string; wrappedDek: string }>(
      baseUrl,
      '/me/keys/bootstrap',
      {
        method: 'POST',
        token: login.body.accessToken,
        body: {
          wrappedDek: 'wrapped-dek-v1',
          argon2Salt: 'salt-v1',
          wrappedSigningSecretKey: 'wrapped-signing-secret-v1',
          signingPublicKey: 'signing-public-v1',
          kekVersion: 1,
          recoveryKit: 'recovery-kit-v1',
        },
      },
    );
    expect(bootstrap.body.wrappedDek).toBe('wrapped-dek-v1');

    const material = await requestJson<{ recoveryKit: string }>(baseUrl, '/me/keys/material', {
      token: login.body.accessToken,
    });
    expect(material.body.recoveryKit).toBe('recovery-kit-v1');

    const recoveryExport = await requestJson<{ recoveryKit: string }>(
      baseUrl,
      '/me/keys/recovery/export',
      {
        method: 'POST',
        token: login.body.accessToken,
      },
    );
    expect(recoveryExport.body.recoveryKit).toBe('recovery-kit-v1');

    const sessions = await requestJson<Array<{ id: string; isCurrent: boolean }>>(
      baseUrl,
      '/me/sessions',
      { token: login.body.accessToken },
    );
    expect(sessions.status).toBe(200);
    expect(sessions.body).toHaveLength(1);
    expect(sessions.body[0]!.isCurrent).toBe(true);

    const refreshed = await requestJson<{ accessToken: string; sessionId: string }>(
      baseUrl,
      '/auth/refresh',
      {
        method: 'POST',
        cookie: refreshCookie!,
      },
    );
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.sessionId).toBe(login.body.sessionId);
    const rotatedRefreshCookie = cookieValue(refreshed.setCookie);
    expect(rotatedRefreshCookie).toBeTruthy();

    const logout = await requestJson<{ loggedOut: boolean }>(baseUrl, '/auth/logout', {
      method: 'POST',
      cookie: rotatedRefreshCookie!,
    });
    expect(logout.status).toBe(200);
    expect(logout.body.loggedOut).toBe(true);

    const refreshAfterLogout = await requestJson<{ error: string }>(baseUrl, '/auth/refresh', {
      method: 'POST',
      cookie: rotatedRefreshCookie!,
    });
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('detects refresh token reuse and revokes the whole token family', async () => {
    const register = await requestJson<{ verificationToken: string }>(baseUrl, '/auth/register', {
      method: 'POST',
      body: {
        email: 'bob@example.com',
        password: 'very-secure-password',
      },
    });
    await requestJson(baseUrl, '/auth/verify-email', {
      method: 'POST',
      body: {
        email: 'bob@example.com',
        token: register.body.verificationToken,
      },
    });

    const login = await requestJson<{ sessionId: string }>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: 'bob@example.com',
        password: 'very-secure-password',
      },
    });
    const cookie1 = cookieValue(login.setCookie)!;

    const refresh1 = await requestJson(baseUrl, '/auth/refresh', {
      method: 'POST',
      cookie: cookie1,
    });
    expect(refresh1.status).toBe(200);
    const cookie2 = cookieValue(refresh1.setCookie)!;

    const replay = await requestJson<{ error: string }>(baseUrl, '/auth/refresh', {
      method: 'POST',
      cookie: cookie1,
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toContain('reuse');

    const familyRevoked = await requestJson<{ error: string }>(baseUrl, '/auth/refresh', {
      method: 'POST',
      cookie: cookie2,
    });
    expect(familyRevoked.status).toBe(401);
  });

  it('supports password reset and MFA-protected login with TOTP', async () => {
    const register = await requestJson<{ verificationToken: string }>(baseUrl, '/auth/register', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
        password: 'very-secure-password',
      },
    });
    await requestJson(baseUrl, '/auth/verify-email', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
        token: register.body.verificationToken,
      },
    });

    const login = await requestJson<{ accessToken: string }>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
        password: 'very-secure-password',
      },
    });

    const totpSetup = await requestJson<{ secret: string }>(baseUrl, '/auth/mfa/totp/setup', {
      method: 'POST',
      token: login.body.accessToken,
    });
    const totpCode = generateTotpCode(totpSetup.body.secret);
    const totpVerify = await requestJson<{ recoveryCodes: string[] }>(
      baseUrl,
      '/auth/mfa/totp/verify',
      {
        method: 'POST',
        token: login.body.accessToken,
        body: { code: totpCode },
      },
    );
    expect(totpVerify.status).toBe(200);
    expect(totpVerify.body.recoveryCodes.length).toBeGreaterThan(0);

    const loginWithoutTotp = await requestJson<{ error: string }>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
        password: 'very-secure-password',
      },
    });
    expect(loginWithoutTotp.status).toBe(401);

    const forgot = await requestJson<{ resetToken: string }>(baseUrl, '/auth/password/forgot', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
      },
    });
    expect(forgot.status).toBe(202);

    const reset = await requestJson<{ passwordReset: boolean }>(baseUrl, '/auth/password/reset', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
        token: forgot.body.resetToken,
        newPassword: 'even-more-secure-password',
      },
    });
    expect(reset.status).toBe(200);

    const oldPasswordLogin = await requestJson<{ error: string }>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
        password: 'very-secure-password',
        totpCode,
      },
    });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await requestJson<{ accessToken: string }>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: 'mfa@example.com',
        password: 'even-more-secure-password',
        totpCode: generateTotpCode(totpSetup.body.secret),
      },
    });
    expect(newPasswordLogin.status).toBe(200);
  });

  it('issues tokens that the proxy-backend can verify through JWKS', async () => {
    const register = await requestJson<{ verificationToken: string }>(baseUrl, '/auth/register', {
      method: 'POST',
      body: {
        email: 'proxy@example.com',
        password: 'very-secure-password',
      },
    });
    await requestJson(baseUrl, '/auth/verify-email', {
      method: 'POST',
      body: {
        email: 'proxy@example.com',
        token: register.body.verificationToken,
      },
    });
    const login = await requestJson<{ accessToken: string }>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: 'proxy@example.com',
        password: 'very-secure-password',
      },
    });

    const jwks = await requestJson<{ keys: JsonWebKey[] }>(baseUrl, '/.well-known/jwks.json');
    const proxy = await createProxyServer({
      port: 0,
      host: '127.0.0.1',
      jwtJWKS: jwks.body,
      jwtIssuer: 'https://accounts.editor.test',
      jwtAudience: 'editor-narrativo',
      llmProvider: new ImmediateProvider(),
    });
    await proxy.listen({ port: 0, host: '127.0.0.1' });

    try {
      const address = proxy.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to resolve proxy address');
      }

      const proxyResponse = await fetch(`http://127.0.0.1:${address.port}/api/llm/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${login.body.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sceneText: 'La scena e coerente.',
          ragContext: ['Il personaggio e vivo.'],
        }),
      });
      expect(proxyResponse.status).toBe(200);
      const payload = await proxyResponse.json() as { hasConflict: boolean };
      expect(payload.hasConflict).toBe(false);
    } finally {
      await proxy.close();
    }
  });
});
