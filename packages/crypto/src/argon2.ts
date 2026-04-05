/**
 * Argon2id KEK Derivation via libsodium WASM.
 *
 * This module is designed to run inside a dedicated Web Worker so that
 * the heavy Argon2id computation (46 MiB RAM) does not block the UI thread.
 *
 * Usage from main thread:
 *   const worker = new Worker(new URL('./crypto-worker.ts', import.meta.url));
 *   worker.postMessage({ requestId: 1, type: 'DERIVE_KEK', password, salt });
 */

import sodium from 'libsodium-wrappers-sumo';
import {
  ARGON2_MEMORY_LIMIT,
  ARGON2_OPS_LIMIT,
  KEY_LENGTH_BYTES,
  type CryptoWorkerRequest,
  type CryptoWorkerResponse,
} from '@editor-narrativo/shared';

let sodiumReady = false;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
}

/**
 * Derive a 256-bit KEK from a master password using Argon2id.
 * The password string is wiped from the buffer after derivation.
 */
export async function deriveKEK(
  password: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  await ensureSodium();

  if (salt.byteLength !== sodium.crypto_pwhash_SALTBYTES) {
    throw new Error(
      `Salt must be ${sodium.crypto_pwhash_SALTBYTES} bytes, got ${salt.byteLength}`,
    );
  }

  const passwordBytes = sodium.from_string(password);
  try {
    const kek = sodium.crypto_pwhash(
      KEY_LENGTH_BYTES,
      passwordBytes,
      salt,
      ARGON2_OPS_LIMIT,
      ARGON2_MEMORY_LIMIT,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );

    // Copy out of WASM heap — kek.buffer may be a SharedArrayBuffer
    // when COOP/COEP headers are active, which cannot be transferred.
    const result = new ArrayBuffer(kek.byteLength);
    new Uint8Array(result).set(kek);
    return result;
  } finally {
    passwordBytes.fill(0);
  }
}

/**
 * Generate a random salt suitable for Argon2id.
 */
export async function generateSalt(): Promise<Uint8Array> {
  await ensureSodium();
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
}

// ── Web Worker entrypoint ──────────────────────────────────────

const isWorker =
  typeof globalThis.WorkerGlobalScope !== 'undefined' &&
  globalThis instanceof globalThis.WorkerGlobalScope;

if (isWorker) {
  globalThis.onmessage = async (e: MessageEvent<CryptoWorkerRequest>) => {
    try {
      const msg = e.data;
      if (msg.type === 'DERIVE_KEK') {
        const kek = await deriveKEK(msg.password, msg.salt);
        const response: CryptoWorkerResponse = {
          requestId: msg.requestId,
          type: 'KEK_DERIVED',
          kek,
        };
        globalThis.postMessage(response, [kek]);
      } else if (msg.type === 'GENERATE_SIGNING_KEYPAIR') {
        await ensureSodium();
        const kp = sodium.crypto_sign_keypair();
        const response: CryptoWorkerResponse = {
          requestId: msg.requestId,
          type: 'SIGNING_KEYPAIR_GENERATED',
          publicKey: kp.publicKey,
          secretKey: kp.privateKey,
        };
        globalThis.postMessage(response);
      }
    } catch (err) {
      const response: CryptoWorkerResponse = {
        requestId: e.data.requestId,
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'Unknown crypto worker error',
      };
      globalThis.postMessage(response);
    }
  };
}
