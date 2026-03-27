import { describe, it, expect } from 'vitest';
import {
  generateSigningKeyPair,
  signPayload,
  verifySignature,
} from '../src/index.js';

describe('Ed25519 Digital Signatures', () => {
  it('sign → verify roundtrip', async () => {
    const { publicKey, secretKey } = await generateSigningKeyPair();
    const payload = new Uint8Array([1, 2, 3, 4, 5]);

    const signature = await signPayload(secretKey, payload);
    expect(signature.byteLength).toBe(64);

    const valid = await verifySignature(publicKey, payload, signature);
    expect(valid).toBe(true);
  });

  it('altered payload → verification fails', async () => {
    const { publicKey, secretKey } = await generateSigningKeyPair();
    const payload = new Uint8Array([10, 20, 30]);

    const signature = await signPayload(secretKey, payload);

    // Tamper with payload
    const tampered = new Uint8Array([10, 20, 31]);
    const valid = await verifySignature(publicKey, tampered, signature);
    expect(valid).toBe(false);
  });

  it('wrong public key → verification fails', async () => {
    const kp1 = await generateSigningKeyPair();
    const kp2 = await generateSigningKeyPair();
    const payload = new Uint8Array([42]);

    const signature = await signPayload(kp1.secretKey, payload);
    const valid = await verifySignature(kp2.publicKey, payload, signature);
    expect(valid).toBe(false);
  });

  it('generates unique key pairs', async () => {
    const kp1 = await generateSigningKeyPair();
    const kp2 = await generateSigningKeyPair();

    expect(kp1.publicKey).not.toEqual(kp2.publicKey);
    expect(kp1.secretKey).not.toEqual(kp2.secretKey);
  });
});
