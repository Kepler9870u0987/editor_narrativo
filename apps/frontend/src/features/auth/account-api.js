import { appEnv } from '../../lib/env';
import { apiFetch } from '../../lib/http';
function url(path) {
    return `${appEnv.accountBasePath}${path}`;
}
export const accountApi = {
    register(payload) {
        return apiFetch(url('/auth/register'), {
            method: 'POST',
            body: payload,
        });
    },
    verifyEmail(payload) {
        return apiFetch(url('/auth/verify-email'), {
            method: 'POST',
            body: payload,
        });
    },
    login(payload) {
        return apiFetch(url('/auth/login'), {
            method: 'POST',
            body: payload,
        });
    },
    refresh() {
        return apiFetch(url('/auth/refresh'), {
            method: 'POST',
        });
    },
    logout(accessToken) {
        return apiFetch(url('/auth/logout'), {
            method: 'POST',
            accessToken,
        });
    },
    logoutAll(accessToken) {
        return apiFetch(url('/auth/logout-all'), {
            method: 'POST',
            accessToken,
        });
    },
    forgotPassword(email) {
        return apiFetch(url('/auth/password/forgot'), {
            method: 'POST',
            body: { email },
        });
    },
    resetPassword(payload) {
        return apiFetch(url('/auth/password/reset'), {
            method: 'POST',
            body: payload,
        });
    },
    getMe(accessToken) {
        return apiFetch(url('/me'), { accessToken });
    },
    updateProfile(accessToken, patch) {
        return apiFetch(url('/me'), {
            method: 'PATCH',
            accessToken,
            body: patch,
        });
    },
    listSessions(accessToken) {
        return apiFetch(url('/me/sessions'), { accessToken });
    },
    revokeSession(accessToken, sessionId) {
        return apiFetch(url(`/me/sessions/${sessionId}`), {
            method: 'DELETE',
            accessToken,
        });
    },
    bootstrapKeys(accessToken, payload) {
        return apiFetch(url('/me/keys/bootstrap'), {
            method: 'POST',
            accessToken,
            body: payload,
        });
    },
    getKeyMaterial(accessToken) {
        return apiFetch(url('/me/keys/material'), { accessToken });
    },
    rotateUnlock(accessToken, payload) {
        return apiFetch(url('/me/keys/rotate-unlock'), {
            method: 'POST',
            accessToken,
            body: payload,
        });
    },
    exportRecoveryKit(accessToken) {
        return apiFetch(url('/me/keys/recovery/export'), {
            method: 'POST',
            accessToken,
        });
    },
    importRecoveryKit(accessToken, payload) {
        return apiFetch(url('/me/keys/recovery/import'), {
            method: 'POST',
            accessToken,
            body: payload,
        });
    },
    startTotp(accessToken) {
        return apiFetch(url('/auth/mfa/totp/setup'), {
            method: 'POST',
            accessToken,
        });
    },
    verifyTotp(accessToken, code) {
        return apiFetch(url('/auth/mfa/totp/verify'), {
            method: 'POST',
            accessToken,
            body: { code },
        });
    },
    startPasskeyRegistration(accessToken) {
        return apiFetch(url('/auth/passkeys/register/start'), {
            method: 'POST',
            accessToken,
        });
    },
    finishPasskeyRegistration(accessToken, payload) {
        return apiFetch(url('/auth/passkeys/register/finish'), {
            method: 'POST',
            accessToken,
            body: payload,
        });
    },
    startPasskeyLogin(payload) {
        return apiFetch(url('/auth/passkeys/login/start'), {
            method: 'POST',
            body: payload,
        });
    },
    finishPasskeyLogin(payload) {
        return apiFetch(url('/auth/passkeys/login/finish'), {
            method: 'POST',
            body: payload,
        });
    },
};
//# sourceMappingURL=account-api.js.map