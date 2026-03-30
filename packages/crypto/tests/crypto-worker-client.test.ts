import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoWorkerClient } from '../src/crypto-worker-client.js';
import type { CryptoWorkerResponse } from '@editor-narrativo/shared';

class MockWorker {
  static latest: MockWorker | null = null;

  private messageListeners = new Set<(event: MessageEvent<CryptoWorkerResponse>) => void>();
  private errorListeners = new Set<(event: ErrorEvent) => void>();
  requests: unknown[] = [];

  constructor(_url: URL, _options: WorkerOptions) {
    MockWorker.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent<CryptoWorkerResponse>) => void);
    } else if (type === 'error') {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent<CryptoWorkerResponse>) => void);
    } else if (type === 'error') {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }

  postMessage(message: unknown): void {
    this.requests.push(message);
  }

  terminate(): void {}

  emitMessage(data: CryptoWorkerResponse): void {
    const event = { data } as MessageEvent<CryptoWorkerResponse>;
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }
}

describe('CryptoWorkerClient', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MockWorker.latest = null;
  });

  it('routes concurrent responses by request id', async () => {
    const client = new CryptoWorkerClient(new URL('file:///crypto-worker.js'));
    const worker = MockWorker.latest!;

    const kekPromise = client.deriveKEK('password', new Uint8Array(16));
    const keyPairPromise = client.generateSigningKeyPair();

    worker.emitMessage({
      requestId: 2,
      type: 'SIGNING_KEYPAIR_GENERATED',
      publicKey: new Uint8Array([1, 2]),
      secretKey: new Uint8Array([3, 4]),
    });
    worker.emitMessage({
      requestId: 1,
      type: 'KEK_DERIVED',
      kek: new Uint8Array([9, 9, 9]).buffer,
    });

    await expect(keyPairPromise).resolves.toEqual({
      publicKey: new Uint8Array([1, 2]),
      secretKey: new Uint8Array([3, 4]),
    });
    await expect(kekPromise).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('rejects pending requests when terminated', async () => {
    const client = new CryptoWorkerClient(new URL('file:///crypto-worker.js'));
    const promise = client.generateSigningKeyPair();

    client.terminate();

    await expect(promise).rejects.toThrow('Crypto worker terminated');
  });
});
