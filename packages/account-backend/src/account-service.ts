import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  AccountProfile,
  AccountSessionSummary,
  AuthSuccessResponse,
  BootstrapKeysRequest,
  ForgotPasswordResponse,
  PasskeyLoginFinishRequest,
  PasskeyLoginStartResponse,
  PasskeyRegisterFinishRequest,
  PasskeyRegisterStartResponse,
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
  generateWebAuthnChallenge,
  utf8ToBase64url,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationCredentialInput,
  type RegistrationCredentialInput,
} from './webauthn.js';
import {
  type AccountRepository,
  MemoryAccountRepository,
  type AccountUserRecord,
  type AuditEventRecord,
  type LoginAttemptRecord,
  type PasskeyCredentialRecord,
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
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;

/** Lockout thresholds: after N failures, lock for M milliseconds */
const LOCKOUT_TIERS: Array<{ threshold: number; durationMs: number }> = [
  { threshold: 5, durationMs: 15 * 60 * 1000 },   // 5 failures → 15 min
  { threshold: 10, durationMs: 60 * 60 * 1000 },   // 10 failures → 1 hour
  { threshold: 20, durationMs: 24 * 60 * 60 * 1000 }, // 20 failures → 24 hours
];

function computeLockoutDuration(failedCount: number): number | null {
  let durationMs: number | null = null;
  for (const tier of LOCKOUT_TIERS) {
    if (failedCount >= tier.threshold) {
      durationMs = tier.durationMs;
    }
  }
  return durationMs;
}

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
  rpId?: string;
  rpOrigin?: string;
  rpName?: string;
  passkeyChallengeTtlMs?: number;
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
  rotateUnlock(userId: string, input: BootstrapKeysRequest, mfaCode?: string): Promise<WrappedKeyMaterialRecord>;
  exportRecoveryKit(userId: string, mfaCode?: string): Promise<RecoveryExportResponse>;
  importRecoveryKit(userId: string, input: BootstrapKeysRequest, mfaCode?: string): Promise<WrappedKeyMaterialRecord>;
  setupTotp(userId: string): Promise<TotpSetupResponse>;
  verifyTotpSetup(userId: string, code: string): Promise<TotpVerifyResponse>;
  startPasskeyRegistration(userId: string): Promise<PasskeyRegisterStartResponse>;
  finishPasskeyRegistration(
    userId: string,
    credential: PasskeyRegisterFinishRequest['credential'],
    context: RequestContext,
  ): Promise<{ registered: true }>;
  startPasskeyLogin(email: string): Promise<PasskeyLoginStartResponse>;
  finishPasskeyLogin(
    input: PasskeyLoginFinishRequest,
    context: RequestContext,
  ): Promise<LoginResult>;
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
  repository: AccountRepository = new MemoryAccountRepository(),
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
  const passkeyChallengeTtlMs = config.passkeyChallengeTtlMs ?? PASSKEY_CHALLENGE_TTL_MS;
  const rpOrigin = config.rpOrigin ?? config.issuer;
  const rpId = config.rpId ?? new URL(rpOrigin).hostname;
  const rpName = config.rpName ?? 'Editor Narrativo';

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

  async function requireActiveUser(userId: string): Promise<AccountUserRecord> {
    const user = await requireUser(userId);
    if (user.status !== 'active') {
      throw new ServiceError(403, 'inactive_user', 'User is not active');
    }
    return user;
  }

  /**
   * Step-up MFA: require a TOTP code for sensitive operations when the
   * user has MFA enabled. If MFA is not enabled, this is a no-op.
   *
   * @throws ServiceError 403 mfa_required — if MFA is enabled but no code provided
   * @throws ServiceError 403 mfa_invalid — if MFA code is wrong
   */
  async function requireStepUpMfa(userId: string, mfaCode: string | undefined): Promise<void> {
    const totpFactor = repository.getTotpFactor(userId);
    if (!totpFactor?.enabledAt) {
      // MFA not enabled — nothing to verify
      return;
    }
    if (!mfaCode) {
      throw new ServiceError(403, 'mfa_required', 'MFA verification required for this operation');
    }
    const valid = verifyTotpCode(totpFactor.secret, mfaCode);
    if (!valid) {
      throw new ServiceError(403, 'mfa_invalid', 'Invalid MFA code');
    }
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

  function createSessionForUser(
    user: AccountUserRecord,
    context: RequestContext,
    deviceName?: string,
  ): { session: UserSessionRecord; refreshToken: string; now: Date } {
    const now = new Date();
    const sessionId = crypto.randomUUID();
    const refreshToken = buildRefreshToken(sessionId);
    const session: UserSessionRecord = {
      id: sessionId,
      userId: user.id,
      refreshTokenFamilyId: crypto.randomUUID(),
      refreshTokenHash: hashOpaqueToken(refreshToken),
      deviceName: deviceName?.trim() || context.deviceName || null,
      userAgent: context.userAgent,
      ipCreated: context.ip,
      ipLastSeen: context.ip,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + refreshTokenTtlMs),
      revokedAt: null,
      revocationReason: null,
    };
    return { session, refreshToken, now };
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

      // ── Lockout check ──────────────────────────────────
      const attempts = repository.getLoginAttempts(user.id);
      if (attempts?.lockedUntil && attempts.lockedUntil > new Date()) {
        const retryAfterSeconds = Math.ceil((attempts.lockedUntil.getTime() - Date.now()) / 1000);
        appendAuditEvent('login_locked', context, {
          email: emailNormalized,
          failedCount: attempts.failedCount,
          retryAfterSeconds,
        }, user.id, null, 90);
        throw new ServiceError(429, 'account_locked', `Account temporarily locked. Retry after ${retryAfterSeconds} seconds`);
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
        const now = new Date();
        const currentCount = (attempts?.failedCount ?? 0) + 1;
        const lockDurationMs = computeLockoutDuration(currentCount);
        const lockedUntil = lockDurationMs ? new Date(now.getTime() + lockDurationMs) : null;
        repository.recordLoginFailure(user.id, now, lockedUntil);
        appendAuditEvent('login_failed', context, { email: emailNormalized, failedCount: currentCount }, user.id, null, 60);
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
          const now = new Date();
          const currentCount = (attempts?.failedCount ?? 0) + 1;
          const lockDurationMs = computeLockoutDuration(currentCount);
          const lockedUntil = lockDurationMs ? new Date(now.getTime() + lockDurationMs) : null;
          repository.recordLoginFailure(user.id, now, lockedUntil);
          appendAuditEvent('login_failed', context, { email: emailNormalized, mfa: true, failedCount: currentCount }, user.id, null, 80);
          throw new ServiceError(401, 'invalid_mfa', 'Invalid multi-factor authentication code');
        }
      }

      // ── Login successful — reset lockout counter ─────
      repository.resetLoginAttempts(user.id);

      const { session, refreshToken, now } = createSessionForUser(user, context, input.deviceName);
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
      mfaCode?: string,
    ): Promise<WrappedKeyMaterialRecord> {
      await requireStepUpMfa(userId, mfaCode);
      return persistKeyMaterial(userId, input);
    },

    async exportRecoveryKit(userId: string, mfaCode?: string): Promise<RecoveryExportResponse> {
      await requireStepUpMfa(userId, mfaCode);
      const record = repository.getWrappedKeyMaterial(userId);
      if (!record?.recoveryKit) {
        throw new ServiceError(404, 'recovery_kit_missing', 'Recovery kit not found');
      }

      return { recoveryKit: record.recoveryKit };
    },

    async importRecoveryKit(
      userId: string,
      input: BootstrapKeysRequest,
      mfaCode?: string,
    ): Promise<WrappedKeyMaterialRecord> {
      await requireStepUpMfa(userId, mfaCode);
      return persistKeyMaterial(userId, input);
    },

    async startPasskeyRegistration(userId: string): Promise<PasskeyRegisterStartResponse> {
      const user = await requireActiveUser(userId);
      const challenge = generateWebAuthnChallenge();
      repository.storeWebAuthnChallenge({
        id: crypto.randomUUID(),
        userId: user.id,
        emailNormalized: user.emailNormalized,
        type: 'passkey-register',
        challenge,
        expiresAt: new Date(Date.now() + passkeyChallengeTtlMs),
        usedAt: null,
      });

      const excludeCredentials = repository
        .listPasskeyCredentialsForUser(user.id)
        .map((record) => ({ id: record.credentialId, type: 'public-key' as const }));

      return {
        challenge,
        rp: {
          id: rpId,
          name: rpName,
        },
        user: {
          id: utf8ToBase64url(user.id),
          name: user.emailNormalized,
          displayName: user.displayName ?? user.emailNormalized,
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        timeout: passkeyChallengeTtlMs,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
        excludeCredentials,
      };
    },

    async finishPasskeyRegistration(
      userId: string,
      credential: RegistrationCredentialInput,
      context: RequestContext,
    ): Promise<{ registered: true }> {
      const user = await requireActiveUser(userId);
      const clientData = JSON.parse(
        Buffer.from(credential.response.clientDataJSON, 'base64url').toString('utf8'),
      ) as { challenge?: string };
      const challenge = typeof clientData.challenge === 'string' ? clientData.challenge : '';
      const verified = verifyRegistrationResponse({
        credential,
        challenge,
        rpId,
        origin: rpOrigin,
      });
      const challengeRecord = repository.consumeWebAuthnChallenge(
        user.id,
        'passkey-register',
        challenge,
        new Date(),
      );
      if (!challengeRecord) {
        throw new ServiceError(400, 'invalid_passkey_challenge', 'Invalid passkey challenge');
      }
      if (repository.getPasskeyCredentialByCredentialId(verified.credentialId)) {
        throw new ServiceError(409, 'passkey_exists', 'Passkey already registered');
      }

      const record: PasskeyCredentialRecord = {
        id: crypto.randomUUID(),
        userId: user.id,
        credentialId: verified.credentialId,
        publicKeyJwk: verified.publicKeyJwk,
        signCount: verified.signCount,
        transports: verified.transports,
        createdAt: new Date(),
        lastUsedAt: null,
      };
      repository.createPasskeyCredential(record);

      appendAuditEvent(
        'passkey_register_success',
        context,
        { credentialId: record.credentialId },
        user.id,
      );

      return { registered: true };
    },

    async startPasskeyLogin(email: string): Promise<PasskeyLoginStartResponse> {
      const emailNormalized = normalizeEmail(email);
      validateEmail(emailNormalized);
      const user = repository.getUserByEmail(emailNormalized);
      if (!user || user.status !== 'active') {
        throw new ServiceError(404, 'user_not_found', 'User not found');
      }

      const credentials = repository.listPasskeyCredentialsForUser(user.id);
      if (credentials.length === 0) {
        throw new ServiceError(400, 'passkey_not_registered', 'No passkeys registered');
      }

      const challenge = generateWebAuthnChallenge();
      repository.storeWebAuthnChallenge({
        id: crypto.randomUUID(),
        userId: user.id,
        emailNormalized,
        type: 'passkey-login',
        challenge,
        expiresAt: new Date(Date.now() + passkeyChallengeTtlMs),
        usedAt: null,
      });

      return {
        challenge,
        rpId,
        timeout: passkeyChallengeTtlMs,
        userVerification: 'required',
        allowCredentials: credentials.map((record) => ({
          id: record.credentialId,
          type: 'public-key' as const,
        })),
      };
    },

    async finishPasskeyLogin(
      input: PasskeyLoginFinishRequest,
      context: RequestContext,
    ): Promise<LoginResult> {
      const emailNormalized = normalizeEmail(input.email);
      validateEmail(emailNormalized);

      const credentialRecord = repository.getPasskeyCredentialByCredentialId(input.credential.id);
      if (!credentialRecord) {
        appendAuditEvent(
          'passkey_login_failed',
          context,
          { email: emailNormalized, reason: 'credential_missing' },
          null,
          null,
          75,
        );
        throw new ServiceError(401, 'invalid_passkey', 'Invalid passkey assertion');
      }

      const user = await requireActiveUser(credentialRecord.userId);
      if (user.emailNormalized !== emailNormalized) {
        throw new ServiceError(401, 'invalid_passkey', 'Invalid passkey assertion');
      }

      const clientData = JSON.parse(
        Buffer.from(input.credential.response.clientDataJSON, 'base64url').toString('utf8'),
      ) as { challenge?: string };
      const challenge = typeof clientData.challenge === 'string' ? clientData.challenge : '';

      try {
        const verified = await verifyAuthenticationResponse({
          credential: input.credential as AuthenticationCredentialInput,
          challenge,
          rpId,
          origin: rpOrigin,
          publicKeyJwk: credentialRecord.publicKeyJwk,
          expectedCredentialId: credentialRecord.credentialId,
          currentSignCount: credentialRecord.signCount,
        });
        credentialRecord.signCount = verified.signCount;
        credentialRecord.lastUsedAt = new Date();
      } catch {
        appendAuditEvent(
          'passkey_login_failed',
          context,
          { email: emailNormalized, reason: 'signature_invalid' },
          user.id,
          null,
          90,
        );
        throw new ServiceError(401, 'invalid_passkey', 'Invalid passkey assertion');
      }
      const challengeRecord = repository.consumeWebAuthnChallenge(
        user.id,
        'passkey-login',
        challenge,
        new Date(),
      );
      if (!challengeRecord || challengeRecord.emailNormalized !== emailNormalized) {
        appendAuditEvent(
          'passkey_login_failed',
          context,
          { email: emailNormalized, reason: 'challenge_missing' },
          user.id,
          null,
          85,
        );
        throw new ServiceError(401, 'invalid_passkey', 'Invalid passkey assertion');
      }
      repository.updatePasskeyCredential(credentialRecord);

      const { session, refreshToken, now } = createSessionForUser(user, context, input.deviceName);
      repository.createSession(session);
      user.lastLoginAt = now;
      user.updatedAt = now;
      repository.updateUser(user);

      appendAuditEvent(
        'passkey_login_success',
        context,
        { credentialId: credentialRecord.credentialId },
        user.id,
        session.id,
      );

      return {
        ...(await issueAuthResult(user, session)),
        refreshToken,
      };
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
