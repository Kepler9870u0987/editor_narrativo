import type {
  AccountProfile,
  AccountSessionSummary,
  AuthSuccessResponse,
  BootstrapKeysRequest,
  ForgotPasswordResponse,
  LoginRequest,
  PasskeyLoginFinishRequest,
  PasskeyLoginStartRequest,
  PasskeyLoginStartResponse,
  PasskeyRegisterFinishRequest,
  PasskeyRegisterStartResponse,
  RecoveryExportResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  TotpSetupResponse,
  TotpVerifyResponse,
  UpdateProfileRequest,
  VerifyEmailRequest,
  WrappedKeyMaterialRecord,
} from '@editor-narrativo/account-shared';
import { appEnv } from '../../lib/env';
import { apiFetch } from '../../lib/http';

function url(path: string): string {
  return `${appEnv.accountBasePath}${path}`;
}

export const accountApi = {
  register(payload: RegisterRequest) {
    return apiFetch<RegisterResponse>(url('/auth/register'), {
      method: 'POST',
      body: payload,
    });
  },
  verifyEmail(payload: VerifyEmailRequest) {
    return apiFetch<{ verified: boolean; user: AccountProfile }>(url('/auth/verify-email'), {
      method: 'POST',
      body: payload,
    });
  },
  login(payload: LoginRequest) {
    return apiFetch<AuthSuccessResponse>(url('/auth/login'), {
      method: 'POST',
      body: payload,
    });
  },
  refresh() {
    return apiFetch<AuthSuccessResponse>(url('/auth/refresh'), {
      method: 'POST',
    });
  },
  logout(accessToken?: string | null) {
    return apiFetch<{ loggedOut: boolean }>(url('/auth/logout'), {
      method: 'POST',
      accessToken,
    });
  },
  logoutAll(accessToken: string) {
    return apiFetch<{ loggedOutAll: boolean }>(url('/auth/logout-all'), {
      method: 'POST',
      accessToken,
    });
  },
  forgotPassword(email: string) {
    return apiFetch<ForgotPasswordResponse>(url('/auth/password/forgot'), {
      method: 'POST',
      body: { email },
    });
  },
  resetPassword(payload: ResetPasswordRequest) {
    return apiFetch<{ passwordReset: boolean }>(url('/auth/password/reset'), {
      method: 'POST',
      body: payload,
    });
  },
  getMe(accessToken: string) {
    return apiFetch<AccountProfile>(url('/me'), { accessToken });
  },
  updateProfile(accessToken: string, patch: UpdateProfileRequest) {
    return apiFetch<AccountProfile>(url('/me'), {
      method: 'PATCH',
      accessToken,
      body: patch,
    });
  },
  listSessions(accessToken: string) {
    return apiFetch<AccountSessionSummary[]>(url('/me/sessions'), { accessToken });
  },
  revokeSession(accessToken: string, sessionId: string) {
    return apiFetch<{ revoked: boolean }>(url(`/me/sessions/${sessionId}`), {
      method: 'DELETE',
      accessToken,
    });
  },
  bootstrapKeys(accessToken: string, payload: BootstrapKeysRequest) {
    return apiFetch<WrappedKeyMaterialRecord>(url('/me/keys/bootstrap'), {
      method: 'POST',
      accessToken,
      body: payload,
    });
  },
  getKeyMaterial(accessToken: string) {
    return apiFetch<WrappedKeyMaterialRecord>(url('/me/keys/material'), { accessToken });
  },
  rotateUnlock(accessToken: string, payload: BootstrapKeysRequest) {
    return apiFetch<WrappedKeyMaterialRecord>(url('/me/keys/rotate-unlock'), {
      method: 'POST',
      accessToken,
      body: payload,
    });
  },
  exportRecoveryKit(accessToken: string) {
    return apiFetch<RecoveryExportResponse>(url('/me/keys/recovery/export'), {
      method: 'POST',
      accessToken,
    });
  },
  importRecoveryKit(accessToken: string, payload: BootstrapKeysRequest) {
    return apiFetch<WrappedKeyMaterialRecord>(url('/me/keys/recovery/import'), {
      method: 'POST',
      accessToken,
      body: payload,
    });
  },
  startTotp(accessToken: string) {
    return apiFetch<TotpSetupResponse>(url('/auth/mfa/totp/setup'), {
      method: 'POST',
      accessToken,
    });
  },
  verifyTotp(accessToken: string, code: string) {
    return apiFetch<TotpVerifyResponse>(url('/auth/mfa/totp/verify'), {
      method: 'POST',
      accessToken,
      body: { code },
    });
  },
  startPasskeyRegistration(accessToken: string) {
    return apiFetch<PasskeyRegisterStartResponse>(url('/auth/passkeys/register/start'), {
      method: 'POST',
      accessToken,
    });
  },
  finishPasskeyRegistration(accessToken: string, payload: PasskeyRegisterFinishRequest) {
    return apiFetch<{ registered: boolean }>(url('/auth/passkeys/register/finish'), {
      method: 'POST',
      accessToken,
      body: payload,
    });
  },
  startPasskeyLogin(payload: PasskeyLoginStartRequest) {
    return apiFetch<PasskeyLoginStartResponse>(url('/auth/passkeys/login/start'), {
      method: 'POST',
      body: payload,
    });
  },
  finishPasskeyLogin(payload: PasskeyLoginFinishRequest) {
    return apiFetch<AuthSuccessResponse>(url('/auth/passkeys/login/finish'), {
      method: 'POST',
      body: payload,
    });
  },
};
