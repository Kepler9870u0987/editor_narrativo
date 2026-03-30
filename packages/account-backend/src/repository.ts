export interface AccountUserRecord {
  id: string;
  emailNormalized: string;
  displayName: string | null;
  status: 'pending' | 'active' | 'locked' | 'disabled';
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface AuthCredentialRecord {
  userId: string;
  passwordHash: string;
  passwordAlgoVersion: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface UserSessionRecord {
  id: string;
  userId: string;
  refreshTokenFamilyId: string;
  refreshTokenHash: string;
  deviceName: string | null;
  userAgent: string | null;
  ipCreated: string | null;
  ipLastSeen: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
}

export interface EmailVerificationTokenRecord {
  id: string;
  userId: string;
  emailNormalized: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  emailNormalized: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface TotpFactorRecord {
  userId: string;
  secret: string;
  pending: boolean;
  enabledAt: Date | null;
  recoveryCodeHashes: string[];
}

export interface WrappedKeyMaterialRecordInternal {
  userId: string;
  wrappedDek: string;
  argon2Salt: string;
  wrappedSigningSecretKey: string;
  signingPublicKey: string;
  kekVersion: number;
  recoveryKit: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PasskeyCredentialRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKeyJwk: JsonWebKey;
  signCount: number;
  transports: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface WebAuthnChallengeRecord {
  id: string;
  userId: string;
  emailNormalized: string;
  type: 'passkey-register' | 'passkey-login';
  challenge: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface AuditEventRecord {
  id: string;
  userId: string | null;
  sessionId: string | null;
  eventType: string;
  occurredAt: Date;
  ip: string | null;
  userAgent: string | null;
  riskScore: number;
  metadataRedacted: Record<string, unknown>;
}

export interface AccountRepository {
  createUser(user: AccountUserRecord, credential: AuthCredentialRecord): void;
  getUserByEmail(emailNormalized: string): AccountUserRecord | null;
  getUserById(userId: string): AccountUserRecord | null;
  updateUser(user: AccountUserRecord): void;
  getCredential(userId: string): AuthCredentialRecord | null;
  updateCredential(credential: AuthCredentialRecord): void;
  createSession(session: UserSessionRecord): void;
  getSession(sessionId: string): UserSessionRecord | null;
  updateSession(session: UserSessionRecord): void;
  listSessionsForUser(userId: string): UserSessionRecord[];
  revokeSession(sessionId: string, reason: string, now: Date): UserSessionRecord | null;
  revokeSessionFamily(familyId: string, reason: string, now: Date): void;
  revokeAllSessionsForUser(userId: string, reason: string, now: Date): void;
  storeEmailVerificationToken(record: EmailVerificationTokenRecord): void;
  consumeEmailVerificationToken(emailNormalized: string, tokenHash: string, now: Date): EmailVerificationTokenRecord | null;
  storePasswordResetToken(record: PasswordResetTokenRecord): void;
  consumePasswordResetToken(emailNormalized: string, tokenHash: string, now: Date): PasswordResetTokenRecord | null;
  upsertTotpFactor(record: TotpFactorRecord): void;
  getTotpFactor(userId: string): TotpFactorRecord | null;
  upsertWrappedKeyMaterial(record: WrappedKeyMaterialRecordInternal): void;
  getWrappedKeyMaterial(userId: string): WrappedKeyMaterialRecordInternal | null;
  createPasskeyCredential(record: PasskeyCredentialRecord): void;
  getPasskeyCredentialByCredentialId(credentialId: string): PasskeyCredentialRecord | null;
  listPasskeyCredentialsForUser(userId: string): PasskeyCredentialRecord[];
  updatePasskeyCredential(record: PasskeyCredentialRecord): void;
  storeWebAuthnChallenge(record: WebAuthnChallengeRecord): void;
  consumeWebAuthnChallenge(userId: string, type: WebAuthnChallengeRecord['type'], challenge: string, now: Date): WebAuthnChallengeRecord | null;
  appendAuditEvent(event: AuditEventRecord): void;
  listAuditEvents(): AuditEventRecord[];
  close?(): void;
}

export class MemoryAccountRepository implements AccountRepository {
  private readonly users = new Map<string, AccountUserRecord>();
  private readonly userIdsByEmail = new Map<string, string>();
  private readonly credentials = new Map<string, AuthCredentialRecord>();
  private readonly sessions = new Map<string, UserSessionRecord>();
  private readonly verificationTokens = new Map<string, EmailVerificationTokenRecord>();
  private readonly passwordResetTokens = new Map<string, PasswordResetTokenRecord>();
  private readonly totpFactors = new Map<string, TotpFactorRecord>();
  private readonly wrappedKeyMaterial = new Map<string, WrappedKeyMaterialRecordInternal>();
  private readonly passkeyCredentials = new Map<string, PasskeyCredentialRecord>();
  private readonly passkeyCredentialIds = new Map<string, string>();
  private readonly webAuthnChallenges = new Map<string, WebAuthnChallengeRecord>();
  private readonly auditEvents: AuditEventRecord[] = [];

  createUser(user: AccountUserRecord, credential: AuthCredentialRecord): void {
    this.users.set(user.id, user);
    this.userIdsByEmail.set(user.emailNormalized, user.id);
    this.credentials.set(user.id, credential);
  }

  getUserByEmail(emailNormalized: string): AccountUserRecord | null {
    const userId = this.userIdsByEmail.get(emailNormalized);
    return userId ? this.users.get(userId) ?? null : null;
  }

  getUserById(userId: string): AccountUserRecord | null {
    return this.users.get(userId) ?? null;
  }

  updateUser(user: AccountUserRecord): void {
    this.users.set(user.id, user);
    this.userIdsByEmail.set(user.emailNormalized, user.id);
  }

  getCredential(userId: string): AuthCredentialRecord | null {
    return this.credentials.get(userId) ?? null;
  }

  updateCredential(credential: AuthCredentialRecord): void {
    this.credentials.set(credential.userId, credential);
  }

  createSession(session: UserSessionRecord): void {
    this.sessions.set(session.id, session);
  }

  getSession(sessionId: string): UserSessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
  }

  updateSession(session: UserSessionRecord): void {
    this.sessions.set(session.id, session);
  }

  listSessionsForUser(userId: string): UserSessionRecord[] {
    return Array.from(this.sessions.values()).filter((session) => session.userId === userId);
  }

  revokeSession(sessionId: string, reason: string, now: Date): UserSessionRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    session.revokedAt ??= now;
    session.revocationReason ??= reason;
    this.sessions.set(sessionId, session);
    return session;
  }

  revokeSessionFamily(familyId: string, reason: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenFamilyId === familyId) {
        session.revokedAt ??= now;
        session.revocationReason ??= reason;
        this.sessions.set(session.id, session);
      }
    }
  }

  revokeAllSessionsForUser(userId: string, reason: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        session.revokedAt ??= now;
        session.revocationReason ??= reason;
        this.sessions.set(session.id, session);
      }
    }
  }

  storeEmailVerificationToken(record: EmailVerificationTokenRecord): void {
    this.verificationTokens.set(record.id, record);
  }

  consumeEmailVerificationToken(
    emailNormalized: string,
    tokenHash: string,
    now: Date,
  ): EmailVerificationTokenRecord | null {
    for (const record of this.verificationTokens.values()) {
      if (
        record.emailNormalized === emailNormalized &&
        record.tokenHash === tokenHash &&
        !record.usedAt &&
        record.expiresAt > now
      ) {
        record.usedAt = now;
        this.verificationTokens.set(record.id, record);
        return record;
      }
    }

    return null;
  }

  storePasswordResetToken(record: PasswordResetTokenRecord): void {
    this.passwordResetTokens.set(record.id, record);
  }

  consumePasswordResetToken(
    emailNormalized: string,
    tokenHash: string,
    now: Date,
  ): PasswordResetTokenRecord | null {
    for (const record of this.passwordResetTokens.values()) {
      if (
        record.emailNormalized === emailNormalized &&
        record.tokenHash === tokenHash &&
        !record.usedAt &&
        record.expiresAt > now
      ) {
        record.usedAt = now;
        this.passwordResetTokens.set(record.id, record);
        return record;
      }
    }

    return null;
  }

  upsertTotpFactor(record: TotpFactorRecord): void {
    this.totpFactors.set(record.userId, record);
  }

  getTotpFactor(userId: string): TotpFactorRecord | null {
    return this.totpFactors.get(userId) ?? null;
  }

  upsertWrappedKeyMaterial(record: WrappedKeyMaterialRecordInternal): void {
    this.wrappedKeyMaterial.set(record.userId, record);
  }

  getWrappedKeyMaterial(userId: string): WrappedKeyMaterialRecordInternal | null {
    return this.wrappedKeyMaterial.get(userId) ?? null;
  }

  createPasskeyCredential(record: PasskeyCredentialRecord): void {
    this.passkeyCredentials.set(record.id, record);
    this.passkeyCredentialIds.set(record.credentialId, record.id);
  }

  getPasskeyCredentialByCredentialId(credentialId: string): PasskeyCredentialRecord | null {
    const recordId = this.passkeyCredentialIds.get(credentialId);
    return recordId ? this.passkeyCredentials.get(recordId) ?? null : null;
  }

  listPasskeyCredentialsForUser(userId: string): PasskeyCredentialRecord[] {
    return Array.from(this.passkeyCredentials.values()).filter((record) => record.userId === userId);
  }

  updatePasskeyCredential(record: PasskeyCredentialRecord): void {
    this.passkeyCredentials.set(record.id, record);
    this.passkeyCredentialIds.set(record.credentialId, record.id);
  }

  storeWebAuthnChallenge(record: WebAuthnChallengeRecord): void {
    this.webAuthnChallenges.set(record.id, record);
  }

  consumeWebAuthnChallenge(
    userId: string,
    type: WebAuthnChallengeRecord['type'],
    challenge: string,
    now: Date,
  ): WebAuthnChallengeRecord | null {
    for (const record of this.webAuthnChallenges.values()) {
      if (
        record.userId === userId &&
        record.type === type &&
        record.challenge === challenge &&
        !record.usedAt &&
        record.expiresAt > now
      ) {
        record.usedAt = now;
        this.webAuthnChallenges.set(record.id, record);
        return record;
      }
    }

    return null;
  }

  appendAuditEvent(event: AuditEventRecord): void {
    this.auditEvents.push(event);
  }

  listAuditEvents(): AuditEventRecord[] {
    return [...this.auditEvents];
  }
}
