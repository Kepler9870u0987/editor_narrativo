import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AccountRepository,
  AccountUserRecord,
  AuditEventRecord,
  AuthCredentialRecord,
  EmailVerificationTokenRecord,
  LoginAttemptRecord,
  PasswordResetTokenRecord,
  PasskeyCredentialRecord,
  TotpFactorRecord,
  UserSessionRecord,
  WebAuthnChallengeRecord,
  WrappedKeyMaterialRecordInternal,
} from './repository.js';

type Row = Record<string, unknown>;

function toDate(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new Error('Invalid date value in SQLite row');
  }
  return new Date(value);
}

function toNullableDate(value: unknown): Date | null {
  return value === null ? null : toDate(value);
}

function toStringArray(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function toObject<T>(value: unknown): T {
  if (typeof value !== 'string') {
    throw new Error('Invalid JSON value in SQLite row');
  }
  return JSON.parse(value) as T;
}

export class SQLiteAccountRepository implements AccountRepository {
  private readonly database: DatabaseSync;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new DatabaseSync(resolvedPath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email_normalized TEXT NOT NULL UNIQUE,
        display_name TEXT NULL,
        status TEXT NOT NULL,
        email_verified_at TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        password_algo_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_family_id TEXT NOT NULL,
        refresh_token_hash TEXT NOT NULL,
        device_name TEXT NULL,
        user_agent TEXT NULL,
        ip_created TEXT NULL,
        ip_last_seen TEXT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT NULL,
        revocation_reason TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email_normalized TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email_normalized TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS totp_factors (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret TEXT NOT NULL,
        pending INTEGER NOT NULL,
        enabled_at TEXT NULL,
        recovery_code_hashes TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wrapped_key_material (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        wrapped_dek TEXT NOT NULL,
        argon2_salt TEXT NOT NULL,
        wrapped_signing_secret_key TEXT NOT NULL,
        signing_public_key TEXT NOT NULL,
        kek_version INTEGER NOT NULL,
        recovery_kit TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS passkey_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE,
        public_key_jwk TEXT NOT NULL,
        sign_count INTEGER NOT NULL,
        transports TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email_normalized TEXT NOT NULL,
        type TEXT NOT NULL,
        challenge TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NULL,
        session_id TEXT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        ip TEXT NULL,
        user_agent TEXT NULL,
        risk_score INTEGER NOT NULL,
        metadata_redacted TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON user_sessions(refresh_token_family_id);
      CREATE INDEX IF NOT EXISTS idx_email_verification_lookup ON email_verification_tokens(email_normalized, token_hash);
      CREATE INDEX IF NOT EXISTS idx_password_reset_lookup ON password_reset_tokens(email_normalized, token_hash);
      CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkey_credentials(user_id);
      CREATE INDEX IF NOT EXISTS idx_webauthn_challenge_lookup ON webauthn_challenges(user_id, type, challenge);
      CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id, occurred_at);

      CREATE TABLE IF NOT EXISTS login_attempts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        failed_count INTEGER NOT NULL DEFAULT 0,
        last_failed_at TEXT NULL,
        locked_until TEXT NULL
      );
    `);
  }

  close(): void {
    this.database.close();
  }

  private mapUser(row: Row): AccountUserRecord {
    return {
      id: String(row.id),
      emailNormalized: String(row.email_normalized),
      displayName: typeof row.display_name === 'string' ? row.display_name : null,
      status: String(row.status) as AccountUserRecord['status'],
      emailVerifiedAt: toNullableDate(row.email_verified_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
      lastLoginAt: toNullableDate(row.last_login_at),
    };
  }

  private mapCredential(row: Row): AuthCredentialRecord {
    return {
      userId: String(row.user_id),
      passwordHash: String(row.password_hash),
      passwordAlgoVersion: String(row.password_algo_version),
      createdAt: toDate(row.created_at),
      lastUsedAt: toNullableDate(row.last_used_at),
    };
  }

  private mapSession(row: Row): UserSessionRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      refreshTokenFamilyId: String(row.refresh_token_family_id),
      refreshTokenHash: String(row.refresh_token_hash),
      deviceName: typeof row.device_name === 'string' ? row.device_name : null,
      userAgent: typeof row.user_agent === 'string' ? row.user_agent : null,
      ipCreated: typeof row.ip_created === 'string' ? row.ip_created : null,
      ipLastSeen: typeof row.ip_last_seen === 'string' ? row.ip_last_seen : null,
      createdAt: toDate(row.created_at),
      lastSeenAt: toDate(row.last_seen_at),
      expiresAt: toDate(row.expires_at),
      revokedAt: toNullableDate(row.revoked_at),
      revocationReason: typeof row.revocation_reason === 'string' ? row.revocation_reason : null,
    };
  }

  private mapEmailVerificationToken(row: Row): EmailVerificationTokenRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      emailNormalized: String(row.email_normalized),
      tokenHash: String(row.token_hash),
      expiresAt: toDate(row.expires_at),
      usedAt: toNullableDate(row.used_at),
    };
  }

  private mapPasswordResetToken(row: Row): PasswordResetTokenRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      emailNormalized: String(row.email_normalized),
      tokenHash: String(row.token_hash),
      expiresAt: toDate(row.expires_at),
      usedAt: toNullableDate(row.used_at),
    };
  }

  private mapTotpFactor(row: Row): TotpFactorRecord {
    return {
      userId: String(row.user_id),
      secret: String(row.secret),
      pending: Number(row.pending) === 1,
      enabledAt: toNullableDate(row.enabled_at),
      recoveryCodeHashes: toStringArray(row.recovery_code_hashes),
    };
  }

  private mapWrappedKeyMaterial(row: Row): WrappedKeyMaterialRecordInternal {
    return {
      userId: String(row.user_id),
      wrappedDek: String(row.wrapped_dek),
      argon2Salt: String(row.argon2_salt),
      wrappedSigningSecretKey: String(row.wrapped_signing_secret_key),
      signingPublicKey: String(row.signing_public_key),
      kekVersion: Number(row.kek_version),
      recoveryKit: typeof row.recovery_kit === 'string' ? row.recovery_kit : null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  private mapPasskeyCredential(row: Row): PasskeyCredentialRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      credentialId: String(row.credential_id),
      publicKeyJwk: toObject<JsonWebKey>(row.public_key_jwk),
      signCount: Number(row.sign_count),
      transports: toStringArray(row.transports),
      createdAt: toDate(row.created_at),
      lastUsedAt: toNullableDate(row.last_used_at),
    };
  }

  private mapWebAuthnChallenge(row: Row): WebAuthnChallengeRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      emailNormalized: String(row.email_normalized),
      type: String(row.type) as WebAuthnChallengeRecord['type'],
      challenge: String(row.challenge),
      expiresAt: toDate(row.expires_at),
      usedAt: toNullableDate(row.used_at),
    };
  }

  private mapAuditEvent(row: Row): AuditEventRecord {
    return {
      id: String(row.id),
      userId: typeof row.user_id === 'string' ? row.user_id : null,
      sessionId: typeof row.session_id === 'string' ? row.session_id : null,
      eventType: String(row.event_type),
      occurredAt: toDate(row.occurred_at),
      ip: typeof row.ip === 'string' ? row.ip : null,
      userAgent: typeof row.user_agent === 'string' ? row.user_agent : null,
      riskScore: Number(row.risk_score),
      metadataRedacted: toObject<Record<string, unknown>>(row.metadata_redacted),
    };
  }

  createUser(user: AccountUserRecord, credential: AuthCredentialRecord): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(`
          INSERT INTO users (id, email_normalized, display_name, status, email_verified_at, created_at, updated_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          user.id,
          user.emailNormalized,
          user.displayName,
          user.status,
          user.emailVerifiedAt?.toISOString() ?? null,
          user.createdAt.toISOString(),
          user.updatedAt.toISOString(),
          user.lastLoginAt?.toISOString() ?? null,
        );
      this.database
        .prepare(`
          INSERT INTO auth_credentials (user_id, password_hash, password_algo_version, created_at, last_used_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          credential.userId,
          credential.passwordHash,
          credential.passwordAlgoVersion,
          credential.createdAt.toISOString(),
          credential.lastUsedAt?.toISOString() ?? null,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getUserByEmail(emailNormalized: string): AccountUserRecord | null {
    const row = this.database
      .prepare('SELECT * FROM users WHERE email_normalized = ?')
      .get(emailNormalized) as Row | undefined;
    return row ? this.mapUser(row) : null;
  }

  getUserById(userId: string): AccountUserRecord | null {
    const row = this.database
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as Row | undefined;
    return row ? this.mapUser(row) : null;
  }

  updateUser(user: AccountUserRecord): void {
    this.database
      .prepare(`
        UPDATE users
        SET email_normalized = ?, display_name = ?, status = ?, email_verified_at = ?, created_at = ?, updated_at = ?, last_login_at = ?
        WHERE id = ?
      `)
      .run(
        user.emailNormalized,
        user.displayName,
        user.status,
        user.emailVerifiedAt?.toISOString() ?? null,
        user.createdAt.toISOString(),
        user.updatedAt.toISOString(),
        user.lastLoginAt?.toISOString() ?? null,
        user.id,
      );
  }

  getCredential(userId: string): AuthCredentialRecord | null {
    const row = this.database
      .prepare('SELECT * FROM auth_credentials WHERE user_id = ?')
      .get(userId) as Row | undefined;
    return row ? this.mapCredential(row) : null;
  }

  updateCredential(credential: AuthCredentialRecord): void {
    this.database
      .prepare(`
        UPDATE auth_credentials
        SET password_hash = ?, password_algo_version = ?, created_at = ?, last_used_at = ?
        WHERE user_id = ?
      `)
      .run(
        credential.passwordHash,
        credential.passwordAlgoVersion,
        credential.createdAt.toISOString(),
        credential.lastUsedAt?.toISOString() ?? null,
        credential.userId,
      );
  }

  createSession(session: UserSessionRecord): void {
    this.database
      .prepare(`
        INSERT INTO user_sessions (
          id, user_id, refresh_token_family_id, refresh_token_hash, device_name, user_agent, ip_created, ip_last_seen,
          created_at, last_seen_at, expires_at, revoked_at, revocation_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        session.id,
        session.userId,
        session.refreshTokenFamilyId,
        session.refreshTokenHash,
        session.deviceName,
        session.userAgent,
        session.ipCreated,
        session.ipLastSeen,
        session.createdAt.toISOString(),
        session.lastSeenAt.toISOString(),
        session.expiresAt.toISOString(),
        session.revokedAt?.toISOString() ?? null,
        session.revocationReason,
      );
  }

  getSession(sessionId: string): UserSessionRecord | null {
    const row = this.database
      .prepare('SELECT * FROM user_sessions WHERE id = ?')
      .get(sessionId) as Row | undefined;
    return row ? this.mapSession(row) : null;
  }

  updateSession(session: UserSessionRecord): void {
    this.database
      .prepare(`
        UPDATE user_sessions
        SET user_id = ?, refresh_token_family_id = ?, refresh_token_hash = ?, device_name = ?, user_agent = ?, ip_created = ?,
            ip_last_seen = ?, created_at = ?, last_seen_at = ?, expires_at = ?, revoked_at = ?, revocation_reason = ?
        WHERE id = ?
      `)
      .run(
        session.userId,
        session.refreshTokenFamilyId,
        session.refreshTokenHash,
        session.deviceName,
        session.userAgent,
        session.ipCreated,
        session.ipLastSeen,
        session.createdAt.toISOString(),
        session.lastSeenAt.toISOString(),
        session.expiresAt.toISOString(),
        session.revokedAt?.toISOString() ?? null,
        session.revocationReason,
        session.id,
      );
  }

  listSessionsForUser(userId: string): UserSessionRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM user_sessions WHERE user_id = ?')
        .all(userId) as Row[]
    ).map((row) => this.mapSession(row));
  }

  revokeSession(sessionId: string, reason: string, now: Date): UserSessionRecord | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }
    session.revokedAt ??= now;
    session.revocationReason ??= reason;
    this.updateSession(session);
    return session;
  }

  revokeSessionFamily(familyId: string, reason: string, now: Date): void {
    this.database
      .prepare(`
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, ?), revocation_reason = COALESCE(revocation_reason, ?)
        WHERE refresh_token_family_id = ?
      `)
      .run(now.toISOString(), reason, familyId);
  }

  revokeAllSessionsForUser(userId: string, reason: string, now: Date): void {
    this.database
      .prepare(`
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, ?), revocation_reason = COALESCE(revocation_reason, ?)
        WHERE user_id = ?
      `)
      .run(now.toISOString(), reason, userId);
  }

  storeEmailVerificationToken(record: EmailVerificationTokenRecord): void {
    this.database
      .prepare(`
        INSERT INTO email_verification_tokens (id, user_id, email_normalized, token_hash, expires_at, used_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.userId,
        record.emailNormalized,
        record.tokenHash,
        record.expiresAt.toISOString(),
        record.usedAt?.toISOString() ?? null,
      );
  }

  consumeEmailVerificationToken(
    emailNormalized: string,
    tokenHash: string,
    now: Date,
  ): EmailVerificationTokenRecord | null {
    const row = this.database
      .prepare(`
        SELECT * FROM email_verification_tokens
        WHERE email_normalized = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY expires_at DESC
        LIMIT 1
      `)
      .get(emailNormalized, tokenHash, now.toISOString()) as Row | undefined;
    if (!row) {
      return null;
    }
    this.database
      .prepare('UPDATE email_verification_tokens SET used_at = ? WHERE id = ?')
      .run(now.toISOString(), String(row.id));
    return this.mapEmailVerificationToken({ ...row, used_at: now.toISOString() });
  }

  storePasswordResetToken(record: PasswordResetTokenRecord): void {
    this.database
      .prepare(`
        INSERT INTO password_reset_tokens (id, user_id, email_normalized, token_hash, expires_at, used_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.userId,
        record.emailNormalized,
        record.tokenHash,
        record.expiresAt.toISOString(),
        record.usedAt?.toISOString() ?? null,
      );
  }

  consumePasswordResetToken(
    emailNormalized: string,
    tokenHash: string,
    now: Date,
  ): PasswordResetTokenRecord | null {
    const row = this.database
      .prepare(`
        SELECT * FROM password_reset_tokens
        WHERE email_normalized = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY expires_at DESC
        LIMIT 1
      `)
      .get(emailNormalized, tokenHash, now.toISOString()) as Row | undefined;
    if (!row) {
      return null;
    }
    this.database
      .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
      .run(now.toISOString(), String(row.id));
    return this.mapPasswordResetToken({ ...row, used_at: now.toISOString() });
  }

  upsertTotpFactor(record: TotpFactorRecord): void {
    this.database
      .prepare(`
        INSERT INTO totp_factors (user_id, secret, pending, enabled_at, recovery_code_hashes)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          secret = excluded.secret,
          pending = excluded.pending,
          enabled_at = excluded.enabled_at,
          recovery_code_hashes = excluded.recovery_code_hashes
      `)
      .run(
        record.userId,
        record.secret,
        record.pending ? 1 : 0,
        record.enabledAt?.toISOString() ?? null,
        JSON.stringify(record.recoveryCodeHashes),
      );
  }

  getTotpFactor(userId: string): TotpFactorRecord | null {
    const row = this.database
      .prepare('SELECT * FROM totp_factors WHERE user_id = ?')
      .get(userId) as Row | undefined;
    return row ? this.mapTotpFactor(row) : null;
  }

  upsertWrappedKeyMaterial(record: WrappedKeyMaterialRecordInternal): void {
    this.database
      .prepare(`
        INSERT INTO wrapped_key_material (
          user_id, wrapped_dek, argon2_salt, wrapped_signing_secret_key, signing_public_key,
          kek_version, recovery_kit, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          wrapped_dek = excluded.wrapped_dek,
          argon2_salt = excluded.argon2_salt,
          wrapped_signing_secret_key = excluded.wrapped_signing_secret_key,
          signing_public_key = excluded.signing_public_key,
          kek_version = excluded.kek_version,
          recovery_kit = excluded.recovery_kit,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      .run(
        record.userId,
        record.wrappedDek,
        record.argon2Salt,
        record.wrappedSigningSecretKey,
        record.signingPublicKey,
        record.kekVersion,
        record.recoveryKit,
        record.createdAt.toISOString(),
        record.updatedAt.toISOString(),
      );
  }

  getWrappedKeyMaterial(userId: string): WrappedKeyMaterialRecordInternal | null {
    const row = this.database
      .prepare('SELECT * FROM wrapped_key_material WHERE user_id = ?')
      .get(userId) as Row | undefined;
    return row ? this.mapWrappedKeyMaterial(row) : null;
  }

  createPasskeyCredential(record: PasskeyCredentialRecord): void {
    this.database
      .prepare(`
        INSERT INTO passkey_credentials (
          id, user_id, credential_id, public_key_jwk, sign_count, transports, created_at, last_used_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.userId,
        record.credentialId,
        JSON.stringify(record.publicKeyJwk),
        record.signCount,
        JSON.stringify(record.transports),
        record.createdAt.toISOString(),
        record.lastUsedAt?.toISOString() ?? null,
      );
  }

  getPasskeyCredentialByCredentialId(credentialId: string): PasskeyCredentialRecord | null {
    const row = this.database
      .prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?')
      .get(credentialId) as Row | undefined;
    return row ? this.mapPasskeyCredential(row) : null;
  }

  listPasskeyCredentialsForUser(userId: string): PasskeyCredentialRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM passkey_credentials WHERE user_id = ? ORDER BY created_at ASC')
        .all(userId) as Row[]
    ).map((row) => this.mapPasskeyCredential(row));
  }

  updatePasskeyCredential(record: PasskeyCredentialRecord): void {
    this.database
      .prepare(`
        UPDATE passkey_credentials
        SET user_id = ?, credential_id = ?, public_key_jwk = ?, sign_count = ?, transports = ?, created_at = ?, last_used_at = ?
        WHERE id = ?
      `)
      .run(
        record.userId,
        record.credentialId,
        JSON.stringify(record.publicKeyJwk),
        record.signCount,
        JSON.stringify(record.transports),
        record.createdAt.toISOString(),
        record.lastUsedAt?.toISOString() ?? null,
        record.id,
      );
  }

  storeWebAuthnChallenge(record: WebAuthnChallengeRecord): void {
    this.database
      .prepare(`
        INSERT INTO webauthn_challenges (id, user_id, email_normalized, type, challenge, expires_at, used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.userId,
        record.emailNormalized,
        record.type,
        record.challenge,
        record.expiresAt.toISOString(),
        record.usedAt?.toISOString() ?? null,
      );
  }

  consumeWebAuthnChallenge(
    userId: string,
    type: WebAuthnChallengeRecord['type'],
    challenge: string,
    now: Date,
  ): WebAuthnChallengeRecord | null {
    const row = this.database
      .prepare(`
        SELECT * FROM webauthn_challenges
        WHERE user_id = ? AND type = ? AND challenge = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY expires_at DESC
        LIMIT 1
      `)
      .get(userId, type, challenge, now.toISOString()) as Row | undefined;
    if (!row) {
      return null;
    }
    this.database
      .prepare('UPDATE webauthn_challenges SET used_at = ? WHERE id = ?')
      .run(now.toISOString(), String(row.id));
    return this.mapWebAuthnChallenge({ ...row, used_at: now.toISOString() });
  }

  appendAuditEvent(event: AuditEventRecord): void {
    this.database
      .prepare(`
        INSERT INTO audit_events (
          id, user_id, session_id, event_type, occurred_at, ip, user_agent, risk_score, metadata_redacted
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id,
        event.userId,
        event.sessionId,
        event.eventType,
        event.occurredAt.toISOString(),
        event.ip,
        event.userAgent,
        event.riskScore,
        JSON.stringify(event.metadataRedacted),
      );
  }

  listAuditEvents(): AuditEventRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM audit_events ORDER BY occurred_at ASC')
        .all() as Row[]
    ).map((row) => this.mapAuditEvent(row));
  }

  getLoginAttempts(userId: string): LoginAttemptRecord | null {
    const row = this.database
      .prepare('SELECT * FROM login_attempts WHERE user_id = ?')
      .get(userId) as Row | undefined;
    if (!row) return null;
    return {
      userId: String(row.user_id),
      failedCount: Number(row.failed_count),
      lastFailedAt: toNullableDate(row.last_failed_at),
      lockedUntil: toNullableDate(row.locked_until),
    };
  }

  recordLoginFailure(userId: string, now: Date, lockedUntil: Date | null): void {
    this.database
      .prepare(`
        INSERT INTO login_attempts (user_id, failed_count, last_failed_at, locked_until)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          failed_count = login_attempts.failed_count + 1,
          last_failed_at = excluded.last_failed_at,
          locked_until = excluded.locked_until
      `)
      .run(userId, now.toISOString(), lockedUntil?.toISOString() ?? null);
  }

  resetLoginAttempts(userId: string): void {
    this.database
      .prepare('DELETE FROM login_attempts WHERE user_id = ?')
      .run(userId);
  }
}
