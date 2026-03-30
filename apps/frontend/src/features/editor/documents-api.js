import { appEnv } from '../../lib/env';
import { apiFetch } from '../../lib/http';
function url(path) {
    return `${appEnv.documentsBasePath}${path}`;
}
export const documentsApi = {
    create(accessToken, payload) {
        return apiFetch(url('/documents'), {
            method: 'POST',
            accessToken,
            body: payload,
        });
    },
    list(accessToken) {
        return apiFetch(url('/documents'), { accessToken });
    },
    get(accessToken, documentId) {
        return apiFetch(url(`/documents/${documentId}`), { accessToken });
    },
    update(accessToken, documentId, patch) {
        return apiFetch(url(`/documents/${documentId}`), {
            method: 'PATCH',
            accessToken,
            body: patch,
        });
    },
    getSnapshot(accessToken, documentId) {
        return apiFetch(url(`/documents/${documentId}/snapshot`), {
            accessToken,
        });
    },
    putSnapshot(accessToken, documentId, snapshot) {
        return apiFetch(url(`/documents/${documentId}/snapshot`), {
            method: 'PUT',
            accessToken,
            body: { snapshot },
        });
    },
    getUpdates(accessToken, documentId, afterClock) {
        return apiFetch(url(`/documents/${documentId}/updates?afterClock=${afterClock}`), {
            accessToken,
        });
    },
    postUpdates(accessToken, documentId, updates) {
        return apiFetch(url(`/documents/${documentId}/updates/batch`), {
            method: 'POST',
            accessToken,
            body: { updates },
        });
    },
};
//# sourceMappingURL=documents-api.js.map