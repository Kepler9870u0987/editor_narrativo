/**
 * CryptoWorkerClient — typed interface for communicating with the
 * crypto Web Worker from the main thread.
 */

import {
  CRYPTO_WORKER_TIMEOUT_MS,
  type CryptoWorkerRequest,
  type CryptoWorkerResponse,
} from '@editor-narrativo/shared';

type CryptoWorkerClientRequest =
  | { type: 'DERIVE_KEK'; password: string; salt: Uint8Array }
  | { type: 'GENERATE_SIGNING_KEYPAIR' };

export class CryptoWorkerClient {
  private worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<number, {
    resolve: (result: CryptoWorkerResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  private handleMessage = (e: MessageEvent<CryptoWorkerResponse>) => {
    const pending = this.pending.get(e.data.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(e.data.requestId);

    if (e.data.type === 'ERROR') {
      pending.reject(new Error(e.data.message));
    } else {
      pending.resolve(e.data);
    }
  };

  private handleError = (e: ErrorEvent) => {
    const error = new Error(e.message || 'Crypto worker error');
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  };

  private send(
    request: CryptoWorkerClientRequest,
    timeoutMs = CRYPTO_WORKER_TIMEOUT_MS,
  ): Promise<CryptoWorkerResponse> {
    return new Promise((resolve, reject) => {
      const requestId = this.nextRequestId++;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Crypto worker timeout'));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      const requestWithId = { ...request, requestId } as CryptoWorkerRequest;
      this.worker.postMessage(requestWithId);
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
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Crypto worker terminated'));
      this.pending.delete(requestId);
    }
    this.worker.terminate();
  }
}
