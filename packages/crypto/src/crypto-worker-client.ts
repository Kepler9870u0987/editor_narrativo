/**
 * CryptoWorkerClient — typed interface for communicating with the
 * crypto Web Worker from the main thread.
 */

import {
  CRYPTO_WORKER_TIMEOUT_MS,
  type CryptoWorkerRequest,
  type CryptoWorkerResponse,
} from '@editor-narrativo/shared';

export class CryptoWorkerClient {
  private worker: Worker;

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl, { type: 'module' });
  }

  private send(
    request: CryptoWorkerRequest,
    timeoutMs = CRYPTO_WORKER_TIMEOUT_MS,
  ): Promise<CryptoWorkerResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Crypto worker timeout'));
      }, timeoutMs);

      const handler = (e: MessageEvent<CryptoWorkerResponse>) => {
        clearTimeout(timer);
        this.worker.removeEventListener('message', handler);
        if (e.data.type === 'ERROR') {
          reject(new Error(e.data.message));
        } else {
          resolve(e.data);
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage(request);
    });
  }

  /**
   * Derive KEK from master password. Runs Argon2id in the worker.
   */
  async deriveKEK(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
    const result = await this.send({ type: 'DERIVE_KEK', password, salt });
    if (result.type !== 'KEK_DERIVED') {
      throw new Error('Unexpected response from crypto worker');
    }
    return result.kek;
  }

  /**
   * Generate an Ed25519 signing key pair in the worker.
   */
  async generateSigningKeyPair(): Promise<{
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }> {
    const result = await this.send({ type: 'GENERATE_SIGNING_KEYPAIR' });
    if (result.type !== 'SIGNING_KEYPAIR_GENERATED') {
      throw new Error('Unexpected response from crypto worker');
    }
    return { publicKey: result.publicKey, secretKey: result.secretKey };
  }

  terminate(): void {
    this.worker.terminate();
  }
}
