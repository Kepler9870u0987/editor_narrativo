import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function ensureTarget(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

const securityHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: http: https: ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; report-uri /proxy/csp-report;",
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: {
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      headers: securityHeaders,
      proxy: {
        '/account': {
          target: ensureTarget(env.VITE_ACCOUNT_BASE_URL, 'http://127.0.0.1:4000'),
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/account/, ''),
        },
        '/proxy': {
          target: ensureTarget(env.VITE_PROXY_BASE_URL, 'http://127.0.0.1:4010'),
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/proxy/, ''),
        },
        '/documents': {
          target: ensureTarget(env.VITE_DOCUMENTS_BASE_URL, 'http://127.0.0.1:4100'),
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/documents/, ''),
        },
      },
    },
    preview: {
      headers: securityHeaders,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      exclude: ['tests-e2e/**', 'node_modules/**'],
    },
  };
});
