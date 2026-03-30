export function toWebSocketUrl(path) {
    const url = new URL(path, window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
}
//# sourceMappingURL=ws-url.js.map