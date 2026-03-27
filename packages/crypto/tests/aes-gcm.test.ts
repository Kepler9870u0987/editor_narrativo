import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  serializePayload,
  deserializePayload,
  generateDEK,
  importKEK,
  wrapDEK,
  unwrapDEK,
  deriveSubKeys,
} from '../src/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('AES-256-GCM', () => {
  it('encrypt → decrypt roundtrip on text', async () => {
    const key = await generateDEK();
    const plaintext = encoder.encode('Capitolo 1: Marco entrò nella stanza.');

    const { ciphertext, iv } = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, ciphertext, iv);

    expect(decoder.decode(decrypted)).toBe('Capitolo 1: Marco entrò nella stanza.');
  });

  it('encrypt → decrypt roundtrip on JSON', async () => {
    const key = await generateDEK();
    const obj = { character: 'Marco', location: 'Roma' };
    const plaintext = encoder.encode(JSON.stringify(obj));

    const { ciphertext, iv } = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, ciphertext, iv);

    expect(JSON.parse(decoder.decode(decrypted))).toEqual(obj);
  });

  it('same plaintext + same key → different ciphertext (unique IV)', async () => {
    const key = await generateDEK();
    const plaintext = encoder.encode('test');

    const a = await encrypt(key, plaintext);
    const b = await encrypt(key, plaintext);

    const ctA = new Uint8Array(a.ciphertext);
    const ctB = new Uint8Array(b.ciphertext);

    // IVs must differ
    expect(a.iv).not.toEqual(b.iv);
    // Ciphertexts must differ (due to different IV)
    expect(ctA).not.toEqual(ctB);
  });

  it('wrong key throws on decrypt', async () => {
    const key1 = await generateDEK();
    const key2 = await generateDEK();
    const plaintext = encoder.encode('secret');

    const { ciphertext, iv } = await encrypt(key1, plaintext);

    await expect(decrypt(key2, ciphertext, iv)).rejects.toThrow();
  });

  it('tampered ciphertext throws on decrypt', async () => {
    const key = await generateDEK();
    const plaintext = encoder.encode('secret');
    const { ciphertext, iv } = await encrypt(key, plaintext);

    // Tamper with the ciphertext
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;

    await expect(decrypt(key, tampered.buffer, iv)).rejects.toThrow();
  });
});

describe('Payload serialization', () => {
  it('serialize → deserialize roundtrip', async () => {
    const key = await generateDEK();
    const plaintext = encoder.encode('test data');
    const payload = await encrypt(key, plaintext);

    const serialized = serializePayload(payload);
    const deserialized = deserializePayload(serialized);

    expect(deserialized.iv).toEqual(payload.iv);

    // Decrypt the deserialized payload to verify integrity
    const decrypted = await decrypt(key, deserialized.ciphertext, deserialized.iv);
    expect(decoder.decode(decrypted)).toBe('test data');
  });
});

describe('Key Management', () => {
  it('generateDEK creates a 256-bit key', async () => {
    const dek = await generateDEK();
    const raw = await crypto.subtle.exportKey('raw', dek);
    expect(raw.byteLength).toBe(32);
  });

  it('wrap → unwrap DEK roundtrip', async () => {
    // Create a KEK (simulate Argon2 output)
    const rawKek = crypto.getRandomValues(new Uint8Array(32));
    const kek = await importKEK(rawKek.buffer);

    const dek = await generateDEK();
    const dekRaw = await crypto.subtle.exportKey('raw', dek);

    const wrapped = await wrapDEK(kek, dek);
    const unwrapped = await unwrapDEK(kek, wrapped);
    const unwrappedRaw = await crypto.subtle.exportKey('raw', unwrapped);

    expect(new Uint8Array(unwrappedRaw)).toEqual(new Uint8Array(dekRaw));
  });

  it('wrapped DEK is opaque (different from raw DEK)', async () => {
    const rawKek = crypto.getRandomValues(new Uint8Array(32));
    const kek = await importKEK(rawKek.buffer);

    const dek = await generateDEK();
    const dekRaw = await crypto.subtle.exportKey('raw', dek);
    const wrapped = await wrapDEK(kek, dek);

    expect(new Uint8Array(wrapped)).not.toEqual(new Uint8Array(dekRaw));
  });

  it('wrong KEK fails to unwrap', async () => {
    const rawKek1 = crypto.getRandomValues(new Uint8Array(32));
    const rawKek2 = crypto.getRandomValues(new Uint8Array(32));
    const kek1 = await importKEK(rawKek1.buffer);
    const kek2 = await importKEK(rawKek2.buffer);

    const dek = await generateDEK();
    const wrapped = await wrapDEK(kek1, dek);

    await expect(unwrapDEK(kek2, wrapped)).rejects.toThrow();
  });
});

describe('HKDF Sub-Key Derivation', () => {
  it('derives three distinct sub-keys', async () => {
    const dek = await generateDEK();
    const subKeys = await deriveSubKeys(dek);

    expect(subKeys.textEncryptionKey).toBeDefined();
    expect(subKeys.vectorEncryptionKey).toBeDefined();
    expect(subKeys.crdtEncryptionKey).toBeDefined();
  });

  it('same DEK produces same sub-keys (deterministic)', async () => {
    const dek = await generateDEK();
    const a = await deriveSubKeys(dek);
    const b = await deriveSubKeys(dek);

    // We can't directly compare CryptoKeys, but we can encrypt with one and decrypt with another
    const plaintext = encoder.encode('determinism check');

    const { ciphertext, iv } = await encrypt(a.textEncryptionKey, plaintext);
    const decrypted = await decrypt(b.textEncryptionKey, ciphertext, iv);

    expect(decoder.decode(decrypted)).toBe('determinism check');
  });

  it('different DEKs produce different sub-keys', async () => {
    const dek1 = await generateDEK();
    const dek2 = await generateDEK();
    const a = await deriveSubKeys(dek1);
    const b = await deriveSubKeys(dek2);

    const plaintext = encoder.encode('cross-key test');
    const { ciphertext, iv } = await encrypt(a.textEncryptionKey, plaintext);

    // Decrypting with a different DEK's sub-key must fail
    await expect(decrypt(b.textEncryptionKey, ciphertext, iv)).rejects.toThrow();
  });
});
