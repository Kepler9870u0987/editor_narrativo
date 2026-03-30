import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  AccountProfile,
  AccountSessionSummary,
  AuthSuccessResponse,
  BootstrapKeysRequest,
  ForgotPasswordResponse,
  RecoveryExportResponse,
  RegisterRequest,
  RegisterResponse,
  TotpSetupResponse,
  TotpVerifyResponse,
  UpdateProfileRequest,
  VerifyEmailRequest,
  WrappedKeyMaterialRecord,
} from '@editor-narrativo/account-shared';
import {
  buildTotpOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotpCode,
} from './totp.js';
import { hashPassword, verifyPassword } from './password-hasher.js';
import {
  MemoryAccountRepository,
  type AccountUserRecord,
  type AuditEventRecord,
  type TotpFactorRecord,
  type UserSessionRecord,
  type WrappedKeyMaterialRecordInternal,
} from './repository.js';
import {
  createAccessTokenService,
  type AccessTokenPayload,
} from './token-service.js';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const MIN_PASSWORD_LENGTH = 12;

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  deviceName?: string | null;
}

export interface LoginRequestInput {
  email: string;
  password: string;
  totpCode?: string;
  recoveryCode?: string;
  deviceName?: string;
}

export interface LoginResult extends AuthSuccessResponse {
  refreshToken: string;
}

export interface RefreshResult extends AuthSuccessResponse {
  refreshToken: string;
}

export interface AccountServiceConfig {
  issuer: string;
  audience: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlMs?: number;
  emailVerificationTtlMs?: number;
  passwordResetTtlMs?: number;
  passwordPepper?: string;
  exposeInternalTokens?: boolean;
  totpIssuer?: string;
}

export interface AuthenticatedRequest {
  user: AccountProfile;
  sessionId: string;
}

export interface AccountService {
  getJWKS(): { keys: JsonWebKey[] };
  register(input: RegisterRequest, context: RequestContext): Promise<RegisterResponse>;
  verifyEmail(input: VerifyEmailRequest, context: RequestContext): Promise<AccountProfile>;
  login(input: LoginRequestInput, context: RequestContext): Promise<LoginResult>;
  refresh(refreshToken: string, context: RequestContext): Promise<RefreshResult>;
  logout(refreshToken: string, context: RequestContext): Promise<void>;
  logoutAll(userId: string, context: RequestContext): Promise<void>;
  forgotPassword(email: string, context: RequestContext): Promise<ForgotPasswordResponse>;
  resetPassword(email: string, token: string, newPassword: string, context: RequestContext): Promise<void>;
  authenticateAccessToken(token: string): Promise<AuthenticatedRequest>;
  getProfile(userId: string): Promise<AccountProfile>;
  updateProfile(userId: string, patch: UpdateProfileRequest): Promise<AccountProfile>;
  listSessions(userId: string, currentSessionId: string): Promise<AccountSessionSummary[]>;
  revokeSession(userId: string, sessionId: string, context: RequestContext): Promise<void>;
  bootstrapKeys(userId: string, input: BootstrapKeysRequest): Promise<WrappedKeyMaterialRecord>;
  getWrappedKeyMaterial(userId: string): Promise<WrappedKeyMaterialRecord | null>;
  rotateUnlock(userId: string, input: BootstrapKeysRequest): Promise<WrappedKeyMaterialRecord>;
  exportRecoveryKit(userId: string): Promise<RecoveryExportResponse>;
  importRecoveryKit(userId: string, input: BootstrapKeysRequest): Promise<WrappedKeyMaterialRecord>;
  setupTotp(userId: string): Promise<TotpSetupResponse>;
  verifyTotpSetup(userId: string, code: string): Promise<TotpVerifyResponse>;
}

class ServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ServiceError(400, 'invalid_email', 'Invalid email address');
  }
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ServiceError(
      400,
      'weak_password',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function buildRefreshToken(sessionId: string): string {
  return `v1.${sessionId}.${generateOpaqueToken()}`;
}

function parseRefreshToken(refreshToken: string): { sessionId: string } {
  const [version, sessionId, secret] = refreshToken.split('.');
  if (version !== 'v1' || !sessionId || !secret) {
    throw new ServiceError(401, 'invalid_refresh_token', 'Invalid refresh token');
  }

  return { sessionId };
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata));
}

function assertEqualConstantTime(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function mapProfile(user: AccountUserRecord, mfaEnabled: boolean): AccountProfile {
  return {
    id: user.id,
    email: user.emailNormalized,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: toIso(user.emailVerifiedAt),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: toIso(user.lastLoginAt),
    mfaEnabled,
  };
}

function mapKeyMaterial(record: WrappedKeyMaterialRecordInternal): WrappedKeyMaterialRecord {
  return {
    userId: record.userId,
    wrappedDek: record.wrappedDek,
    argon2Salt: record.argon2Salt,
    wrappedSigningSecretKey: record.wrappedSigningSecretKey,
    signingPublicKey: record.signingPublicKey,
    kekVersion: record.kekVersion,
    recoveryKit: record.recoveryKit,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapSessionSummary(
  session: UserSessionRecord,
  currentSessionId: string,
): AccountSessionSummary {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: toIso(session.revokedAt),
    revocationReason: session.revocationReason,
    deviceName: session.deviceName,
    userAgent: session.userAgent,
    ipCreated: session.ipCreated,
    ipLastSeen: session.ipLastSeen,
    isCurrent: session.id === currentSessionId,
  };
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export async function createAccountService(
  config: AccountServiceConfig,
  repository = new MemoryAccountRepository(),
): Promise<AccountService> {
  const accessTokenService = await createAccessTokenService({
    issuer: config.issuer,
    audience: config.audience,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
  });

  const passwordPepper = config.passwordPepper ?? '';
  const totpIssuer = config.totpIssuer ?? 'Editor Narrativo';
  const emailVerificationTtlMs =
    config.emailVerificationTtlMs ?? EMAIL_VERIFICATION_TTL_MS;
  const passwordResetTtlMs = config.passwordResetTtlMs ?? PASSWORD_RESET_TTL_MS;
  const refreshTokenTtlMs = config.refreshTokenTtlMs ?? REFRESH_TOKEN_TTL_MS;

  function appendAuditEvent(
    eventType: string,
    context: RequestContext,
    metadata: Record<string, unknown>,
    userId: string | null = null,
    sessionId: string | null = null,
    riskScore = 0,
  ): void {
    const event: AuditEventRecord = {
      id: crypto.randomUUID(),
      userId,
      sessionId,
      eventType,
      occurredAt: new Date(),
      ip: context.ip,
      userAgent: context.userAgent,
      riskScore,
      metadataRedacted: redactMetadata(metadata),
    };
    repository.appendAuditEvent(event);
  }

  async function issueAuthResult(
    user: AccountUserRecord,
    session: UserSessionRecord,
  ): Promise<AuthSuccessResponse> {
    const token = await accessTokenService.issueToken({
      sub: user.id,
      sid: session.id,
      email: user.emailNormalized,
      scope: ['account', 'proxy'],
    });

    return {
      accessToken: token,
      expiresInSeconds: config.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
      sessionId: session.id,
      user: mapProfile(user, Boolean(repository.getTotpFactor(user.id)?.enabledAt)),
    };
  }

  async function requireUser(userId: string): Promise<AccountUserRecord> {
    const user = repository.getUserById(userId);
    if (!user) {
      throw new ServiceError(404, 'user_not_found', 'User not found');
    }
    return user;
  }

  async function authenticate(token: string): Promise<{
    payload: AccessTokenPayload;
    user: AccountUserRecord;
    session: UserSessionRecord;
  }> {
    const payload = await accessTokenService.verifyToken(token);
    const user = await requireUser(payload.sub);
    const session = repository.getSession(payload.sid);
    if (!session || session.userId !== user.id) {
      throw new ServiceError(401, 'invalid_session', 'Session not found');
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw new ServiceError(401, 'invalid_session', 'Session is no longer valid');
    }
    if (user.status !== 'active') {
      throw new ServiceError(403, 'inactive_user', 'User is not active');
    }
    return { payload, user, session };
  }

  async function persistKeyMaterial(
    userId: string,
    input: BootstrapKeysRequest,
  ): Promise<WrappedKeyMaterialRecord> {
    if (!input.wrappedDek || !input.argon2Salt || !input.wrappedSigningSecretKey || !input.signingPublicKey) {
      throw new ServiceError(400, 'invalid_key_material', 'Incomplete key material');
    }

    const existing = repository.getWrappedKeyMaterial(userId);
    const now = new Date();
    const record: WrappedKeyMaterialRecordInternal = {
      userId,
      wrappedDek: input.wrappedDek,
      argon2Salt: input.argon2Salt,
      wrappedSigningSecretKey: input.wrappedSigningSecretKey,
      signingPublicKey: input.signingPublicKey,
      kekVersion: input.kekVersion,
      recoveryKit: input.recoveryKit ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    repository.upsertWrappedKeyMaterial(record);
    return mapKeyMaterial(record);
  }

  return {
    getJWKS(): { keys: JsonWebKey[] } {
      return accessTokenService.getJWKS();
    },

    async register(input: RegisterRequest, context: RequestContext): Promise<RegisterResponse> {
      const emailNormalized = normalizeEmail(input.email);
      validateEmail(emailNormalized);
      validatePassword(input.password);

      if (repository.getUserByEmail(emailNormalized)) {
        throw new ServiceError(409, 'email_in_use', 'Email already in use');
      }

      const now = new Date();
      const user: AccountUserRecord = {
        id: crypto.randomUUID(),
        emailNormalized,
        displayName: input.displayName?.trim() || null,
        status: 'pending',
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      };
      const credential = {
        userId: user.id,
        passwordHash: await hashPassword(input.password, passwordPepper),
        passwordAlgoVersion: 'argon2id-v1',
        createdAt: now,
        lastUsedAt: null,
      };

      repository.createUser(user, credential);

      const verificationToken = generateOpaqueToken();
      repository.storeEmailVerificationToken({
        id: crypto.randomUUID(),
        userId: user.id,
        emailNormalized,
        tokenHash: hashOpaqueToken(verificationToken),
        expiresAt: new Date(now.getTime() + emailVerificationTtlMs),
        usedAt: null,
      });

      appendAuditEvent('register', context, { email: emailNormalized }, user.id);

      return {
        user: mapProfile(user, false),
        verificationIssued: true,
        ...(config.exposeInternalTokens ? { verificationToken } : {}),
      };
    },

    async verifyEmail(
      input: VerifyEmailRequest,
      context: RequestContext,
    ): Promise<AccountProfile> {
      const emailNormalized = normalizeEmail(input.email);
      const token = repository.consumeEmailVerificationToken(
        emailNormalized,
        hashOpaqueToken(input.token),
        new Date(),
      );

      if (!token) {
        throw new ServiceError(400, 'invalid_verification_token', 'Invalid verification token');
      }

      const user = await requireUser(token.userId);
      user.emailVerifiedAt = new Date();
      user.status = 'active';
      user.updatedAt = new Date();
      repository.updateUser(user);

      appendAuditEvent('verify_email', context, { email: emailNormalized }, user.id);

      return mapProfile(user, Boolean(repository.getTotpFactor(user.id)?.enabledAt));
    },

    async login(input: LoginRequestInput, context: RequestContext): Promise<LoginResult> {
      const emailNormalized = normalizeEmail(input.email);
      const user = repository.getUserByEmail(emailNormalized);
      if (!user) {
        appendAuditEvent('login_failed', context, { email: emailNormalized }, null, null, 40);
        throw new ServiceError(401, 'invalid_credentials', 'Invalid credentials');
      }

      const credential = repository.getCredential(user.id);
      if (!credential) {
        throw new ServiceError(500, 'credential_missing', 'Credential missing');
      }

      const passwordOk = await verifyPassword(
        input.password,
        credential.passwordHash,
        passwordPepper,
      );
      if (!passwordOk) {
        appendAuditEvent('login_failed', context, { email: emailNormalized }, user.id, null, 60);
        throw new ServiceError(401, 'invalid_credentials', 'Invalid credentials');
      }

      if (user.status !== 'active') {
        throw new ServiceError(403, 'inactive_user', 'User is not active');
      }

      const totpFactor = repository.getTotpFactor(user.id);
      if (totpFactor?.enabledAt) {
        const hasRecoveryCode = Boolean(input.recoveryCode);
        const hasTotpCode = Boolean(input.totpCode);
        if (!hasRecoveryCode && !hasTotpCode) {
          throw new ServiceError(401, 'mfa_required', 'TOTP code or recovery code required');
        }

        let validSecondFactor = false;
        if (input.totpCode) {
          validSecondFactor = verifyTotpCode(totpFactor.secret, input.totpCode);
        } else if (input.recoveryCode) {
          const hash = hashRecoveryCode(input.recoveryCode);
          const index = totpFactor.recoveryCodeHashes.findIndex((item) =>
            assertEqualConstantTime(item, hash),
          );
          if (index >= 0) {
            totpFactor.recoveryCodeHashes.splice(index, 1);
            repository.upsertTotpFactor(totpFactor);
            validSecondFactor = true;
          }
        }

        if (!validSecondFactor) {
          appendAuditEvent('login_failed', context, { email: emailNormalized, mfa: true }, user.id, null, 80);
          throw new ServiceError(401, 'invalid_mfa', 'Invalid multi-factor authentication code');
        }
      }

      const now = new Date();
      const sessionId = crypto.randomUUID();
      const refreshToken = buildRefreshToken(sessionId);
      const session: UserSessionRecord = {
        id: sessionId,
        userId: user.id,
        refreshTokenFamilyId: crypto.randomUUID(),
        refreshTokenHash: hashOpaqueToken(refreshToken),
        deviceName: input.deviceName?.trim() || context.deviceName || null,
        userAgent: context.userAgent,
        ipCreated: context.ip,
        ipLastSeen: context.ip,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + refreshTokenTtlMs),
        revokedAt: null,
        revocationReason: null,
      };
      repository.createSession(session);

      credential.lastUsedAt = now;
      repository.updateCredential(credential);
      user.lastLoginAt = now;
      user.updatedAt = now;
      repository.updateUser(user);

      appendAuditEvent('login_success', context, { email: emailNormalized }, user.id, session.id);

      return {
        ...(await issueAuthResult(user, session)),
        refreshToken,
      };
    },

    async refresh(refreshToken: string, context: RequestContext): Promise<RefreshResult> {
      const { sessionId } = parseRefreshToken(refreshToken);
      const session = repository.getSession(sessionId);
      if (!session) {
        throw new ServiceError(401, 'invalid_refresh_token', 'Invalid refresh token');
      }

      const now = new Date();
      if (session.revokedAt || session.expiresAt <= now) {
        throw new ServiceError(401, 'invalid_refresh_token', 'Refresh token expired');
      }

      const presentedHash = hashOpaqueToken(refreshToken);
      if (!assertEqualConstantTime(presentedHash, session.refreshTokenHash)) {
        repository.revokeSessionFamily(
          session.refreshTokenFamilyId,
          'refresh token reuse detected',
          now,
        );
        appendAuditEvent(
          'refresh_token_reuse',
          context,
          { sessionId },
          session.userId,
          session.id,
          95,
        );
        throw new ServiceError(401, 'refresh_token_reused', 'Refresh token reuse detected');
      }

      const user = await requireUser(session.userId);
      if (user.status !== 'active') {
        throw new ServiceError(403, 'inactive_user', 'User is not active');
      }

      const rotatedRefreshToken = buildRefreshToken(session.id);
      session.refreshTokenHash = hashOpaqueToken(rotatedRefreshToken);
      session.lastSeenAt = now;
      session.ipLastSeen = context.ip;
      session.userAgent = context.userAgent ?? session.userAgent;
      session.deviceName = context.deviceName ?? session.deviceName;
      repository.updateSession(session);

      appendAuditEvent('refresh_success', context, { sessionId }, user.id, session.id);

      return {
        ...(await issueAuthResult(user, session)),
        refreshToken: rotatedRefreshToken,
      };
    },

    async logout(refreshToken: string, context: RequestContext): Promise<void> {
      const { sessionId } = parseRefreshToken(refreshToken);
      const session = repository.getSession(sessionId);
      if (!session) {
        return;
      }

      const presentedHash = hashOpaqueToken(refreshToken);
      if (assertEqualConstantTime(presentedHash, session.refreshTokenHash)) {
        repository.revokeSession(session.id, 'user logout', new Date());
        appendAuditEvent('logout', context, { sessionId }, session.userId, session.id);
      }
    },

    async logoutAll(userId: string, context: RequestContext): Promise<void> {
      repository.revokeAllSessionsForUser(userId, 'logout all', new Date());
      appendAuditEvent('logout_all', context, {}, userId);
    },

    async forgotPassword(email: string, context: RequestContext): Promise<ForgotPasswordResponse> {
      const emailNormalized = normalizeEmail(email);
      const user = repository.getUserByEmail(emailNormalized);
      if (!user) {
        return { accepted: true };
      }

      const resetToken = generateOpaqueToken();
      repository.storePasswordResetToken({
        id: crypto.randomUUID(),
        userId: user.id,
        emailNormalized,
        tokenHash: hashOpaqueToken(resetToken),
        expiresAt: new Date(Date.now() + passwordResetTtlMs),
        usedAt: null,
      });

      appendAuditEvent('password_reset_requested', context, { email: emailNormalized }, user.id);

      return {
        accepted: true,
        ...(config.exposeInternalTokens ? { resetToken } : {}),
      };
    },

    async resetPassword(
      email: string,
      token: string,
      newPassword: string,
      context: RequestContext,
    ): Promise<void> {
      validatePassword(newPassword);
      const emailNormalized = normalizeEmail(email);
      const record = repository.consumePasswordResetToken(
        emailNormalized,
        hashOpaqueToken(token),
        new Date(),
      );

      if (!record) {
        throw new ServiceError(400, 'invalid_reset_token', 'Invalid reset token');
      }

      const user = await requireUser(record.userId);
      const credential = repository.getCredential(user.id);
      if (!credential) {
        throw new ServiceError(500, 'credential_missing', 'Credential missing');
      }

      credential.passwordHash = await hashPassword(newPassword, passwordPepper);
      credential.lastUsedAt = new Date();
      repository.updateCredential(credential);
      repository.revokeAllSessionsForUser(user.id, 'password reset', new Date());

      appendAuditEvent('password_reset_completed', context, { email: emailNormalized }, user.id);
    },

    async authenticateAccessToken(token: string): Promise<AuthenticatedRequest> {
      const { payload, user } = await authenticate(token);
      return {
        user: mapProfile(user, Boolean(repository.getTotpFactor(user.id)?.enabledAt)),
        sessionId: payload.sid,
      };
    },

    async getProfile(userId: string): Promise<AccountProfile> {
      const user = await requireUser(userId);
      return mapProfile(user, Boolean(repository.getTotpFactor(user.id)?.enabledAt));
    },

    async updateProfile(
      userId: string,
      patch: UpdateProfileRequest,
    ): Promise<AccountProfile> {
      const user = await requireUser(userId);
      user.displayName =
        patch.displayName === undefined ? user.displayName : patch.displayName?.trim() || null;
      user.updatedAt = new Date();
      repository.updateUser(user);
      return mapProfile(user, Boolean(repository.getTotpFactor(user.id)?.enabledAt));
    },

    async listSessions(
      userId: string,
      currentSessionId: string,
    ): Promise<AccountSessionSummary[]> {
      return repository
        .listSessionsForUser(userId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((session) => mapSessionSummary(session, currentSessionId));
    },

    async revokeSession(
      userId: string,
      sessionId: string,
      context: RequestContext,
    ): Promise<void> {
      const session = repository.getSession(sessionId);
      if (!session || session.userId !== userId) {
        throw new ServiceError(404, 'session_not_found', 'Session not found');
      }

      repository.revokeSession(sessionId, 'session revoked by user', new Date());
      appendAuditEvent('session_revoked', context, { sessionId }, userId, sessionId);
    },

    async bootstrapKeys(
      userId: string,
      input: BootstrapKeysRequest,
    ): Promise<WrappedKeyMaterialRecord> {
      return persistKeyMaterial(userId, input);
    },

    async getWrappedKeyMaterial(userId: string): Promise<WrappedKeyMaterialRecord | null> {
      const record = repository.getWrappedKeyMaterial(userId);
      return record ? mapKeyMaterial(record) : null;
    },

    async rotateUnlock(
      userId: string,
      input: BootstrapKeysRequest,
    ): Promise<WrappedKeyMaterialRecord> {
      return persistKeyMaterial(userId, input);
    },

    async exportRecoveryKit(userId: string): Promise<RecoveryExportResponse> {
      const record = repository.getWrappedKeyMaterial(userId);
      if (!record?.recoveryKit) {
        throw new ServiceError(404, 'recovery_kit_missing', 'Recovery kit not found');
      }

      return { recoveryKit: record.recoveryKit };
    },

    async importRecoveryKit(
      userId: string,
      input: BootstrapKeysRequest,
    ): Promise<WrappedKeyMaterialRecord> {
      return persistKeyMaterial(userId, input);
    },

    async setupTotp(userId: string): Promise<TotpSetupResponse> {
      const user = await requireUser(userId);
      const secret = generateTotpSecret();
      const record: TotpFactorRecord = {
        userId,
        secret,
        pending: true,
        enabledAt: null,
        recoveryCodeHashes: [],
      };
      repository.upsertTotpFactor(record);

      return {
        secret,
        otpauthUri: buildTotpOtpAuthUri(totpIssuer, user.emailNormalized, secret),
      };
    },

    async verifyTotpSetup(userId: string, code: string): Promise<TotpVerifyResponse> {
      const factor = repository.getTotpFactor(userId);
      if (!factor?.pending) {
        throw new ServiceError(400, 'totp_not_pending', 'No pending TOTP setup found');
      }

      if (!verifyTotpCode(factor.secret, code)) {
        throw new ServiceError(400, 'invalid_totp_code', 'Invalid TOTP code');
      }

      const recoveryCodes = generateRecoveryCodes();
      factor.pending = false;
      factor.enabledAt = new Date();
      factor.recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);
      repository.upsertTotpFactor(factor);

      return {
        enabled: true,
        recoveryCodes,
      };
    },
  };
}
