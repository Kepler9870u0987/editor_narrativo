export interface AppEnv {
  accountBasePath: string;
  documentsBasePath: string;
  proxyBasePath: string;
  appOrigin: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export const appEnv: AppEnv = {
  accountBasePath: trimTrailingSlash(import.meta.env.VITE_ACCOUNT_BASE_URL ?? '/account'),
  documentsBasePath: trimTrailingSlash(import.meta.env.VITE_DOCUMENTS_BASE_URL ?? '/documents'),
  proxyBasePath: trimTrailingSlash(import.meta.env.VITE_PROXY_BASE_URL ?? '/proxy'),
  appOrigin: trimTrailingSlash(import.meta.env.VITE_APP_ORIGIN ?? window.location.origin),
};
