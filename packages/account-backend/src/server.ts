import { join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
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

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new RequestError(400, 'Invalid payload');
  }
  return value as Record<string, unknown>;
}

function parseRegisterRequest(value: unknown): RegisterRequest {
  const record = expectRecord(value);
  if (typeof record.email !== 'string' || typeof record.password !== 'string') {
    throw new RequestError(400, 'Invalid register request');
  }
  return {
    email: record.email,
    password: record.password,
    ...(typeof record.displayName === 'string' ? { displayName: record.displayName } : {}),
  };
}

function parseVerifyEmailRequest(value: unknown): VerifyEmailRequest {
  const record = expectRecord(value);
  if (typeof record.email !== 'string' || typeof record.token !== 'string') {
    throw new RequestError(400, 'Invalid verify-email request');
  }
  return { email: record.email, token: record.token };
}

function parseLoginRequest(value: unknown): LoginRequest {
  const record = expectRecord(value);
  if (typeof record.email !== 'string' || typeof record.password !== 'string') {
    throw new RequestError(400, 'Invalid login request');
  }
  return {
    email: record.email,
    password: record.password,
    ...(typeof record.totpCode === 'string' ? { totpCode: record.totpCode } : {}),
    ...(typeof record.recoveryCode === 'string' ? { recoveryCode: record.recoveryCode } : {}),
    ...(typeof record.deviceName === 'string' ? { deviceName: record.deviceName } : {}),
  };
}

function parseForgotPasswordRequest(value: unknown): ForgotPasswordRequest {
  const record = expectRecord(value);
  if (typeof record.email !== 'string') {
    throw new RequestError(400, 'Invalid forgot-password request');
  }
  return { email: record.email };
}

function parseResetPasswordRequest(value: unknown): {
  email: string;
  token: string;
  newPassword: string;
} {
  const record = expectRecord(value);
  if (
    typeof record.email !== 'string' ||
    typeof record.token !== 'string' ||
    typeof record.newPassword !== 'string'
  ) {
    throw new RequestError(400, 'Invalid reset-password request');
  }

  return {
    email: record.email,
    token: record.token,
    newPassword: record.newPassword,
  };
}

function parseUpdateProfileRequest(value: unknown): UpdateProfileRequest {
  const record = expectRecord(value);
  if (
    record.displayName !== undefined &&
    record.displayName !== null &&
    typeof record.displayName !== 'string'
  ) {
    throw new RequestError(400, 'Invalid update-profile request');
  }
  return {
    ...(record.displayName !== undefined ? { displayName: record.displayName as string | null } : {}),
  };
}

function parseBootstrapKeysRequest(value: unknown): BootstrapKeysRequest {
  const record = expectRecord(value);
  if (
    typeof record.wrappedDek !== 'string' ||
    typeof record.argon2Salt !== 'string' ||
    typeof record.wrappedSigningSecretKey !== 'string' ||
    typeof record.signingPublicKey !== 'string' ||
    typeof record.kekVersion !== 'number'
  ) {
    throw new RequestError(400, 'Invalid key bootstrap request');
  }

  return {
    wrappedDek: record.wrappedDek,
    argon2Salt: record.argon2Salt,
    wrappedSigningSecretKey: record.wrappedSigningSecretKey,
    signingPublicKey: record.signingPublicKey,
    kekVersion: record.kekVersion,
    ...(typeof record.recoveryKit === 'string' || record.recoveryKit === null
      ? { recoveryKit: record.recoveryKit as string | null }
      : {}),
  };
}

function parseTotpVerifyRequest(value: unknown): TotpVerifyRequest {
  const record = expectRecord(value);
  if (typeof record.code !== 'string') {
    throw new RequestError(400, 'Invalid TOTP verify request');
  }
  return { code: record.code };
}

function parsePasskeyRegisterFinishRequest(value: unknown): PasskeyRegisterFinishRequest {
  const record = expectRecord(value);
  const credential = expectRecord(record.credential);
  const response = expectRecord(credential.response);
  if (
    typeof credential.id !== 'string' ||
    typeof credential.rawId !== 'string' ||
    credential.type !== 'public-key' ||
    typeof response.clientDataJSON !== 'string' ||
    typeof response.attestationObject !== 'string'
  ) {
    throw new RequestError(400, 'Invalid passkey registration payload');
  }

  return {
    credential: {
      id: credential.id,
      rawId: credential.rawId,
      type: 'public-key',
      response: {
        clientDataJSON: response.clientDataJSON,
        attestationObject: response.attestationObject,
        ...(Array.isArray(response.transports)
          ? {
              transports: response.transports.filter(
                (item): item is string => typeof item === 'string',
              ),
            }
          : {}),
      },
    },
  };
}

function parsePasskeyLoginStartRequest(value: unknown): PasskeyLoginStartRequest {
  const record = expectRecord(value);
  if (typeof record.email !== 'string') {
    throw new RequestError(400, 'Invalid passkey login request');
  }
  return { email: record.email };
}

function parsePasskeyLoginFinishRequest(value: unknown): PasskeyLoginFinishRequest {
  const record = expectRecord(value);
  const credential = expectRecord(record.credential);
  const response = expectRecord(credential.response);
  if (
    typeof record.email !== 'string' ||
    typeof credential.id !== 'string' ||
    typeof credential.rawId !== 'string' ||
    credential.type !== 'public-key' ||
    typeof response.clientDataJSON !== 'string' ||
    typeof response.authenticatorData !== 'string' ||
    typeof response.signature !== 'string'
  ) {
    throw new RequestError(400, 'Invalid passkey assertion payload');
  }

  return {
    email: record.email,
    ...(typeof record.deviceName === 'string' ? { deviceName: record.deviceName } : {}),
    credential: {
      id: credential.id,
      rawId: credential.rawId,
      type: 'public-key',
      response: {
        clientDataJSON: response.clientDataJSON,
        authenticatorData: response.authenticatorData,
        signature: response.signature,
        ...(typeof response.userHandle === 'string' || response.userHandle === null
          ? { userHandle: response.userHandle as string | null }
          : {}),
      },
    },
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
    keyGenerator: (request) => request.ip,
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

  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/.well-known/jwks.json', async () => accountService.getJWKS());

  server.post('/auth/register', async (request, reply) => {
    try {
      const result = await accountService.register(
        parseRegisterRequest(request.body),
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
        parseVerifyEmailRequest(request.body),
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
        parseLoginRequest(request.body),
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
        parseForgotPasswordRequest(request.body).email,
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
      const body = parseResetPasswordRequest(request.body);
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
      const body = parseTotpVerifyRequest(request.body);
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
          parsePasskeyRegisterFinishRequest(request.body).credential,
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
      const body = parsePasskeyLoginStartRequest(request.body);
      return reply.send(await accountService.startPasskeyLogin(body.email));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/auth/passkeys/login/finish', async (request, reply) => {
    try {
      const result = await accountService.finishPasskeyLogin(
        parsePasskeyLoginFinishRequest(request.body),
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
        parseUpdateProfileRequest(request.body),
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
          parseBootstrapKeysRequest(request.body),
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
          parseBootstrapKeysRequest(request.body),
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
      return reply.send(await accountService.exportRecoveryKit(auth.userId));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.post('/me/keys/recovery/import', async (request, reply) => {
    try {
      const auth = await authenticateRequest(request);
      const body = parseBootstrapKeysRequest(request.body) as RecoveryImportRequest;
      return reply.send(await accountService.importRecoveryKit(auth.userId, body));
    } catch (error) {
      const mapped = asErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  return { server, accountService };
}
