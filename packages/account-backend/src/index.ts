export {
  createAccountService,
  isServiceError,
  type AccountService,
  type AccountServiceConfig,
  type RequestContext,
} from './account-service.js';
export { createAccountServer, type AccountServerConfig, type AccountServerContext } from './server.js';
export { hashPassword, verifyPassword } from './password-hasher.js';
export {
  buildTotpOtpAuthUri,
  generateTotpCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotpCode,
} from './totp.js';
export {
  createAccessTokenService,
  type AccessTokenClaims,
  type AccessTokenPayload,
  type AccessTokenService,
  type AccessTokenServiceConfig,
} from './token-service.js';
export {
  SQLiteAccountRepository,
} from './sqlite-repository.js';
export {
  MemoryAccountRepository,
  type AccountRepository,
  type AccountUserRecord,
  type AuthCredentialRecord,
  type UserSessionRecord,
  type EmailVerificationTokenRecord,
  type PasswordResetTokenRecord,
  type PasskeyCredentialRecord,
  type WebAuthnChallengeRecord,
  type TotpFactorRecord,
  type WrappedKeyMaterialRecordInternal,
  type AuditEventRecord,
} from './repository.js';
export {
  base64urlDecode,
  base64urlEncode,
  decodeCbor,
  encodeCbor,
  generateWebAuthnChallenge,
  sha256,
  utf8ToBase64url,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from './webauthn.js';
