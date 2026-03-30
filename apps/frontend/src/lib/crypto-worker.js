import { CryptoWorkerClient } from '@editor-narrativo/crypto';
export function createCryptoWorkerClient() {
    return new CryptoWorkerClient(new URL('../workers/crypto-worker.ts', import.meta.url));
}
//# sourceMappingURL=crypto-worker.js.map