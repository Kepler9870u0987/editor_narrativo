/**
 * Key Management: DEK generation, wrapping/unwrapping with KEK, and HKDF sub-key derivation.
 *
 * - The DEK (Data Encryption Key) is generated randomly (256-bit).
 * - The DEK is wrapped (AES-KW) with the KEK before persistence.
 * - Sub-keys for text, vectors and CRDT are derived via HKDF-SHA256.
 */

import { HKDF_INFO, KEY_LENGTH_BYTES } from '@editor-narrativo/shared';

const encoder = new TextEncoder();

// ── DEK Generation ─────────────────────────────────────────────

/**
 * Generate a random 256-bit Data Encryption Key as a CryptoKey usable for
 * AES-GCM encryption and HKDF derivation.
 */
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable — needed for wrap/unwrap and HKDF import
    ['encrypt', 'decrypt'],
  );
}

// ── Key Wrapping (AES-KW) ─────────────────────────────────────

/**
 * Import a raw KEK buffer as a CryptoKey usable for AES-KW wrapping.
 */
export async function importKEK(rawKek: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKek,
    { name: 'AES-KW' },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Wrap the DEK with the KEK using AES-KW. The result is safe to persist.
 */
export async function wrapDEK(
  kek: CryptoKey,
  dek: CryptoKey,
): Promise<ArrayBuffer> {
  return crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' });
}

/**
 * Unwrap a previously wrapped DEK using the KEK.
 */
export async function unwrapDEK(
  kek: CryptoKey,
  wrappedDek: ArrayBuffer,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedDek,
    kek,
    { name: 'AES-KW' },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

// ── HKDF Sub-Key Derivation ───────────────────────────────────

/**
 * Derive a sub-key from the master DEK via HKDF-SHA256.
 *
 * Each info string produces a cryptographically independent key.
 */
async function deriveSubKey(
  dekRaw: ArrayBuffer,
  info: string,
): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    dekRaw,
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(KEY_LENGTH_BYTES), // fixed zero-salt; entropy is in the DEK
      info: encoder.encode(info),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface DerivedSubKeys {
  textEncryptionKey: CryptoKey;
  vectorEncryptionKey: CryptoKey;
  crdtEncryptionKey: CryptoKey;
}

/**
 * Derive three independent sub-keys for text, vectors and CRDT from the master DEK.
 */
export async function deriveSubKeys(
  dek: CryptoKey,
): Promise<DerivedSubKeys> {
  const dekRaw = await crypto.subtle.exportKey('raw', dek);
  const dekRawBytes = new Uint8Array(dekRaw);

  try {
    const [textEncryptionKey, vectorEncryptionKey, crdtEncryptionKey] =
      await Promise.all([
        deriveSubKey(dekRaw, HKDF_INFO.TEXT_ENCRYPTION),
        deriveSubKey(dekRaw, HKDF_INFO.VECTOR_ENCRYPTION),
        deriveSubKey(dekRaw, HKDF_INFO.CRDT_ENCRYPTION),
      ]);

    return { textEncryptionKey, vectorEncryptionKey, crdtEncryptionKey };
  } finally {
    dekRawBytes.fill(0);
  }
}
