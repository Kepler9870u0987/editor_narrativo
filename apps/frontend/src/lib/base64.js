export function bytesToBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
}
export function base64ToBytes(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
export function arrayBufferToBase64(buffer) {
    return bytesToBase64(new Uint8Array(buffer));
}
export function base64ToArrayBuffer(value) {
    return base64ToBytes(value).buffer;
}
export function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function base64UrlToBytes(value) {
    const normalized = value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=');
    return base64ToBytes(normalized);
}
export function stringToBase64Url(value) {
    return bytesToBase64Url(new TextEncoder().encode(value));
}
//# sourceMappingURL=base64.js.map