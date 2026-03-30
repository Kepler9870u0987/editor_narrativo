export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export async function apiFetch(input, options = {}) {
    const headers = new Headers();
    if (options.body !== undefined) {
        headers.set('Content-Type', 'application/json');
    }
    if (options.accessToken) {
        headers.set('Authorization', `Bearer ${options.accessToken}`);
    }
    const response = await fetch(input, {
        method: options.method ?? 'GET',
        headers,
        credentials: options.credentials ?? 'include',
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
        throw new ApiError(response.status, typeof payload.error === 'string' ? payload.error : 'Request failed');
    }
    return payload;
}
//# sourceMappingURL=http.js.map