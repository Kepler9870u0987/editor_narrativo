import { CryptoWorkerClient } from '@editor-narrativo/crypto';

export function createCryptoWorkerClient(): CryptoWorkerClient {
  return new CryptoWorkerClient(new URL('../workers/crypto-worker.ts', import.meta.url));
}
