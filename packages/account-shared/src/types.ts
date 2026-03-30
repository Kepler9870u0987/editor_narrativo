export type UserStatus = 'pending' | 'active' | 'locked' | 'disabled';

export interface AccountProfile {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
}

export interface AccountSessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipCreated: string | null;
  ipLastSeen: string | null;
  isCurrent: boolean;
}

export interface WrappedKeyMaterialRecord {
  userId: string;
  wrappedDek: string;
  argon2Salt: string;
  wrappedSigningSecretKey: string;
  signingPublicKey: string;
  kekVersion: number;
  recoveryKit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface RegisterResponse {
  user: AccountProfile;
  verificationIssued: boolean;
  verificationToken?: string;
}

export interface VerifyEmailRequest {
  email: string;
  token: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  totpCode?: string;
  recoveryCode?: string;
  deviceName?: string;
}

export interface AuthSuccessResponse {
  accessToken: string;
  expiresInSeconds: number;
  sessionId: string;
  user: AccountProfile;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  accepted: true;
  resetToken?: string;
}

export interface ResetPasswordRequest {
  email: string;
  token: string;
  newPassword: string;
}

export interface UpdateProfileRequest {
  displayName?: string | null;
}

export interface BootstrapKeysRequest {
  wrappedDek: string;
  argon2Salt: string;
  wrappedSigningSecretKey: string;
  signingPublicKey: string;
  kekVersion: number;
  recoveryKit?: string | null;
}

export interface RecoveryImportRequest extends BootstrapKeysRequest {}

export interface RecoveryExportResponse {
  recoveryKit: string;
}

export interface TotpSetupResponse {
  secret: string;
  otpauthUri: string;
}

export interface TotpVerifyRequest {
  code: string;
}

export interface TotpVerifyResponse {
  enabled: true;
  recoveryCodes: string[];
}

export interface ApiErrorResponse {
  error: string;
}
