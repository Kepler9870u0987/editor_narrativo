/**
 * Ed25519 Digital Signatures via libsodium.
 *
 * Used to sign every CRDT Update and Snapshot before sending to the server,
 * ensuring non-repudiation and MITM protection.
 */

import sodium from 'libsodium-wrappers-sumo';
import type { SigningKeyPair } from '@editor-narrativo/shared';

let sodiumReady = false;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
}

/**
 * Generate a new Ed25519 signing key pair.
 * The secretKey should be wrapped (encrypted) before persistence.
 */
export async function generateSigningKeyPair(): Promise<SigningKeyPair> {
  await ensureSodium();
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: kp.publicKey,
    secretKey: kp.privateKey,
  };
}

/**
 * Sign a payload with the Ed25519 secret key.
 * Returns 64-byte detached signature.
 */
export async function signPayload(
  secretKey: Uint8Array,
  payload: Uint8Array,
): Promise<Uint8Array> {
  await ensureSodium();
  return sodium.crypto_sign_detached(payload, secretKey);
}

/**
 * Verify a detached Ed25519 signature.
 */
export async function verifySignature(
  publicKey: Uint8Array,
  payload: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  await ensureSodium();
  try {
    return sodium.crypto_sign_verify_detached(signature, payload, publicKey);
  } catch {
    return false;
  }
}
