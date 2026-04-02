import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type {
  ApiErrorResponse,
  BootstrapKeysRequest,
  ForgotPasswordRequest,
  LoginRequest,
  PasskeyLoginFinishRequest,
  PasskeyLoginStartRequest,
  PasskeyRegisterFinishRequest,
  RecoveryImportRequest,
  RegisterRequest,
  TotpVerifyRequest,
  UpdateProfileRequest,
  VerifyEmailRequest,
} from '@editor-narrativo/account-shared';
import {
  createAccountService,
  isServiceError,
  type AccountService,
  type AccountServiceConfig,
  type RequestContext,
} from './account-service.js';
import { SQLiteAccountRepository } from './sqlite-repository.js';
import {
  RegisterRequestSchema,
  VerifyEmailRequestSchema,
  LoginRequestSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  UpdateProfileRequestSchema,
  BootstrapKeysRequestSchema,
  TotpVerifyRequestSchema,
  PasskeyRegisterFinishRequestSchema,
  PasskeyLoginStartRequestSchema,
  PasskeyLoginFinishRequestSchema,
} from './validation.js';

const FASTIFY_BODY_LIMIT_BYTES = 128 * 1024;
const DEFAULT_COOKIE_NAME = 'refresh_token';

export interface AccountServerConfig extends AccountServiceConfig {
  port: number;
  host: string;
  allowedOrigins?: string[];
  refreshCookieName?: string;
  secureCookies?: boolean;
  dbPath?: string;
}

export interface AccountServerContext {
  server: FastifyInstance;
  accountService: AccountService;
}

class RequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function zodParse<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      const message = err.issues.map((e) => e.message).join('; ');
      throw new RequestError(400, message);
    }
    throw new RequestError(400, 'Invalid payload');
  }
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new RequestError(400, 'Invalid payload');
  }
  return value as Record<string, unknown>;
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function isOriginAllowed(origin: string | undefined, config: AccountServerConfig): boolean {
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

function resolveAllowedOrigin(origin: string | undefined, config: AccountServerConfig): string | null {
  if (!origin) {
    return null;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized || !isOriginAllowed(origin, config)) {
    return null;
  }

  return normalized;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [name, ...valueParts] = pair.trim().split('=');
    if (!name || valueParts.length === 0) {
      continue;
    }
    result[name] = decodeURIComponent(valueParts.join('='));
  }
  return result;
}

function serializeCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    secure ? 'Secure' : null,
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');
}

function clearCookie(name: string, secure: boolean): string {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    secure ? 'Secure' : null,
    'SameSite=Strict',
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ');
}

function readRefreshToken(request: any, cookieName: string): string | null {
  const cookies = parseCookies(request.headers.cookie);
  return cookies[cookieName] ?? request.body?.refreshToken ?? null;
}

function getRequestContext(request: any): RequestContext {
  const userAgentHeader = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: Array.isArray(userAgentHeader) ? userAgentHeader[0] ?? null : userAgentHeader ?? null,
    deviceName: request.body?.deviceName ?? null,
  };
}

function asErrorResponse(error: unknown): { statusCode: number; body: ApiErrorResponse } {
  if (error instanceof RequestError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message },
    };
  }

  if (isServiceError(error)) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message },
    };
  }

  return {
    statusCode: 500,
    body: { error: 'Internal server error' },
  };
}

export async function createAccountServer(
  config: AccountServerConfig,
): Promise<AccountServerContext> {
  const server = Fastify({
    bodyLimit: FASTIFY_BODY_LIMIT_BYTES,
    logger: {
      level: 'error',
      transport: undefined,
    },
  });

  const repository = new SQLiteAccountRepository(
    resolve(config.dbPath ?? join(process.cwd(), 'var', 'account-backend.sqlite')),
  );
  const accountService = await createAccountService(config, repository);
  const cookieName = config.refreshCookieName ?? DEFAULT_COOKIE_NAME;
  const secureCookies = config.secureCookies ?? true;
  const refreshMaxAgeSeconds = Math.floor((config.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000) / 1000);

  server.addHook('onClose', async () => {
    repository.close();
  });

  await server.register(fastifyRateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
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
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Credentials', 'true');
    }

    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  async function authenticateRequest(request: any): Promise<{ userId: string; sessionId: string }> {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new RequestError(401, 'Missing Authorization header');
    }

    const authenticated = await accountService.authenticateAccessToken(authHeader.slice(7));
    return {
      userId: authenticated.user.id,
      sessionId: authenticated.sessionId,
    };
  }

  function readMfaCode(request: any): string | undefined {
    const header = request.headers['x-mfa-code'];
    if (typeof header === 'string' && header.length > 0) return header;
    if (typeof request.body?.mfaCode === 'string' && request.body.mfaCode.length > 0) return request.body.mfaCode;
    return undefined;
  }

  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/.well-known/jwks.json', async () => accountService.getJWKS());

  server.post('/auth/register', async (request, reply) => {
    try {
      const result = await accountService.register(
        zodParse(RegisterRequestSchema, request.body),
        getRequestContext(request),
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/verify-email', async (request, reply) => {
    try {
      const profile = await accountService.verifyEmail(
        zodParse(VerifyEmailRequestSchema, request.body),
        getRequestContext(request),
      );
      return reply.send({ verified: true, user: profile });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/login', async (request, reply) => {
    try {
      const result = await accountService.login(
        zodParse(LoginRequestSchema, request.body),
        getRequestContext(request),
      );
      reply.header(
        'Set-Cookie',
        serializeCookie(cookieName, result.refreshToken, refreshMaxAgeSeconds, secureCookies),
      );
      return reply.send({
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
        sessionId: result.sessionId,
        user: result.user,
      });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/refresh', async (request, reply) => {
    try {
      const refreshToken = readRefreshToken(request, cookieName);
      if (!refreshToken) {
        return reply.code(401).send({ error: 'Missing refresh token' });
      }

      const result = await accountService.refresh(refreshToken, getRequestContext(request));
      reply.header(
        'Set-Cookie',
        serializeCookie(cookieName, result.refreshToken, refreshMaxAgeSeconds, secureCookies),
      );
      return reply.send({
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
        sessionId: result.sessionId,
        user: result.user,
      });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/logout', async (request, reply) => {
    try {
      const refreshToken = readRefreshToken(request, cookieName);
      if (refreshToken) {
        await accountService.logout(refreshToken, getRequestContext(request));
      }
      reply.header('Set-Cookie', clearCookie(cookieName, secureCookies));
      return reply.send({ loggedOut: true });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/logout-all', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      await accountService.logoutAll(auth.userId, getRequestContext(request));
      reply.header('Set-Cookie', clearCookie(cookieName, secureCookies));
      return reply.send({ loggedOutAll: true });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/password/forgot', async (request, reply) => {
    try {
      const result = await accountService.forgotPassword(
        zodParse(ForgotPasswordRequestSchema, request.body).email,
        getRequestContext(request),
      );
      return reply.code(202).send(result);
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/password/reset', async (request, reply) => {
    try {
      const body = zodParse(ResetPasswordRequestSchema, request.body);
      await accountService.resetPassword(
        body.email,
        body.token,
        body.newPassword,
        getRequestContext(request),
      );
      return reply.send({ passwordReset: true });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/mfa/totp/setup', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const setup = await accountService.setupTotp(auth.userId);
      return reply.send(setup);
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/mfa/totp/verify', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const body = zodParse(TotpVerifyRequestSchema, request.body);
      const result = await accountService.verifyTotpSetup(auth.userId, body.code);
      return reply.send(result);
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/passkeys/register/start', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      return reply.send(await accountService.startPasskeyRegistration(auth.userId));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/passkeys/register/finish', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      return reply.send(
        await accountService.finishPasskeyRegistration(
          auth.userId,
          zodParse(PasskeyRegisterFinishRequestSchema, request.body).credential,
          getRequestContext(request),
        ),
      );
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/passkeys/login/start', async (request, reply) => {
    try {
      const body = zodParse(PasskeyLoginStartRequestSchema, request.body);
      return reply.send(await accountService.startPasskeyLogin(body.email));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/passkeys/login/finish', async (request, reply) => {
    try {
      const result = await accountService.finishPasskeyLogin(
        zodParse(PasskeyLoginFinishRequestSchema, request.body),
        getRequestContext(request),
      );
      reply.header(
        'Set-Cookie',
        serializeCookie(cookieName, result.refreshToken, refreshMaxAgeSeconds, secureCookies),
      );
      return reply.send({
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
        sessionId: result.sessionId,
        user: result.user,
      });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.get('/me', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const user = await accountService.getProfile(auth.userId);
      return reply.send(user);
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.patch('/me', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const result = await accountService.updateProfile(
        auth.userId,
        zodParse(UpdateProfileRequestSchema, request.body),
      );
      return reply.send(result);
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.get('/me/sessions', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      return reply.send(await accountService.listSessions(auth.userId, auth.sessionId));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.delete('/me/sessions/:id', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const params = expectRecord(request.params);
      if (typeof params.id !== 'string') {
        throw new RequestError(400, 'Invalid session id');
      }
      await accountService.revokeSession(auth.userId, params.id, getRequestContext(request));
      return reply.send({ revoked: true });
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/me/keys/bootstrap', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      return reply.send(
        await accountService.bootstrapKeys(
          auth.userId,
          zodParse(BootstrapKeysRequestSchema, request.body),
        ),
      );
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.get('/me/keys/material', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const material = await accountService.getWrappedKeyMaterial(auth.userId);
      if (!material) {
        return reply.code(404).send({ error: 'Key material not found' });
      }
      return reply.send(material);
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/me/keys/rotate-unlock', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      return reply.send(
        await accountService.rotateUnlock(
          auth.userId,
          zodParse(BootstrapKeysRequestSchema, request.body),
          readMfaCode(request),
        ),
      );
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/me/keys/recovery/export', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      return reply.send(await accountService.exportRecoveryKit(auth.userId, readMfaCode(request)));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/me/keys/recovery/import', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const body = zodParse(BootstrapKeysRequestSchema, request.body) as RecoveryImportRequest;
      return reply.send(await accountService.importRecoveryKit(auth.userId, body, readMfaCode(request)));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  return { server, accountService };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '4000');
  const host = process.env.HOST ?? '127.0.0.1';

  createAccountServer({
    port,
    host,
    issuer: process.env.JWT_ISSUER ?? `http://${host}:${port}`,
    audience: process.env.JWT_AUDIENCE ?? 'editor-narrativo',
    secureCookies: false,
    allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  })
    .then(({ server }) => server.listen({ port, host }))
    .then((address) => console.log(`account-backend listening on ${address}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
