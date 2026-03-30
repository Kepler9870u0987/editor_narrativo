function trimTrailingSlash(value) {
    return value.replace(/\/+$/, '');
}
export const appEnv = {
    accountBasePath: trimTrailingSlash(import.meta.env.VITE_ACCOUNT_BASE_URL ?? '/account'),
    documentsBasePath: trimTrailingSlash(import.meta.env.VITE_DOCUMENTS_BASE_URL ?? '/documents'),
    proxyBasePath: trimTrailingSlash(import.meta.env.VITE_PROXY_BASE_URL ?? '/proxy'),
    appOrigin: trimTrailingSlash(import.meta.env.VITE_APP_ORIGIN ?? window.location.origin),
    enableCognitiveAssist: import.meta.env.VITE_ENABLE_COGNITIVE_ASSIST === 'true',
    enableStreamingLogicCheck: import.meta.env.VITE_ENABLE_STREAMING_LOGIC_CHECK !== 'false',
};
//# sourceMappingURL=env.js.map