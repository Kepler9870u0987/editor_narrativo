/**
 * AES-256-GCM Encryption/Decryption Pipeline.
 *
 * Every encrypt call generates a fresh 12-byte IV via crypto.getRandomValues.
 * The output payload serialises IV ‖ Ciphertext so they travel together.
 */

import {
  AES_GCM_IV_LENGTH,
  type EncryptedPayload,
} from '@editor-narrativo/shared';

// ── Internal helpers ───────────────────────────────────────────

function getIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Encrypt arbitrary data with AES-256-GCM.
 * Returns the ciphertext (with appended 16-byte auth tag) and the IV.
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: BufferSource,
): Promise<EncryptedPayload> {
  const iv = getIV();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
    key,
    plaintext,
  );
  return { ciphertext, iv };
}

/**
 * Decrypt AES-256-GCM ciphertext. Throws on tampered data or wrong key.
 */
export async function decrypt(
  key: CryptoKey,
  ciphertext: BufferSource,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, ciphertext);
}

/**
 * Serialise IV ‖ Ciphertext into a single Uint8Array for storage/transport.
 */
export function serializePayload(payload: EncryptedPayload): Uint8Array {
  const ct = new Uint8Array(payload.ciphertext);
  const out = new Uint8Array(AES_GCM_IV_LENGTH + ct.byteLength);
  out.set(payload.iv, 0);
  out.set(ct, AES_GCM_IV_LENGTH);
  return out;
}

/**
 * Deserialise a buffer produced by `serializePayload` back into IV + Ciphertext.
 */
export function deserializePayload(buffer: Uint8Array): EncryptedPayload {
  const iv = buffer.slice(0, AES_GCM_IV_LENGTH);
  const ciphertext = buffer.slice(AES_GCM_IV_LENGTH).buffer;
  return { iv, ciphertext };
}
