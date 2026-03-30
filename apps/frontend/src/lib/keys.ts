import type { WrappedKeyMaterialRecord } from '@editor-narrativo/account-shared';
import {
  CryptoWorkerClient,
  decrypt,
  deriveSubKeys,
  encrypt,
  generateDEK,
  generateSalt,
  importKEK,
  serializePayload,
  unwrapDEK,
  wrapDEK,
} from '@editor-narrativo/crypto';
import { arrayBufferToBase64, base64ToArrayBuffer, base64ToBytes, bytesToBase64 } from './base64';

export interface UnlockedKeyMaterial {
  dek: CryptoKey;
  signingPublicKey: Uint8Array;
  signingSecretKey: Uint8Array;
  subKeys: Awaited<ReturnType<typeof deriveSubKeys>>;
}

export interface BootstrapKeyMaterialPayload {
  wrappedDek: string;
  argon2Salt: string;
  wrappedSigningSecretKey: string;
  signingPublicKey: string;
  kekVersion: number;
  recoveryKit: string;
}

async function importAesGcmKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

function createRecoveryKit(payload: BootstrapKeyMaterialPayload): string {
  return JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    ...payload,
  });
}

export async function createBootstrapKeyMaterial(
  unlockSecret: string,
  worker: CryptoWorkerClient,
): Promise<BootstrapKeyMaterialPayload> {
  const salt = await generateSalt();
  const kekRaw = await worker.deriveKEK(unlockSecret, salt);
  const kekWrapKey = await importKEK(kekRaw);
  const kekEncryptKey = await importAesGcmKey(kekRaw);
  const dek = await generateDEK();
  const wrappedDek = await wrapDEK(kekWrapKey, dek);
  const signingKeyPair = await worker.generateSigningKeyPair();
  const encryptedSigningSecret = await encrypt(kekEncryptKey, signingKeyPair.secretKey);

  const payload: BootstrapKeyMaterialPayload = {
    wrappedDek: arrayBufferToBase64(wrappedDek),
    argon2Salt: bytesToBase64(salt),
    wrappedSigningSecretKey: bytesToBase64(serializePayload(encryptedSigningSecret)),
    signingPublicKey: bytesToBase64(signingKeyPair.publicKey),
    kekVersion: 1,
    recoveryKit: '',
  };
  payload.recoveryKit = createRecoveryKit(payload);
  new Uint8Array(kekRaw).fill(0);
  signingKeyPair.secretKey.fill(0);
  return payload;
}

export async function rewrapUnlockedKeyMaterial(
  unlocked: UnlockedKeyMaterial,
  unlockSecret: string,
  worker: CryptoWorkerClient,
): Promise<BootstrapKeyMaterialPayload> {
  const salt = await generateSalt();
  const kekRaw = await worker.deriveKEK(unlockSecret, salt);
  const kekWrapKey = await importKEK(kekRaw);
  const kekEncryptKey = await importAesGcmKey(kekRaw);
  const wrappedDek = await wrapDEK(kekWrapKey, unlocked.dek);
  const encryptedSigningSecret = await encrypt(kekEncryptKey, unlocked.signingSecretKey);

  const payload: BootstrapKeyMaterialPayload = {
    wrappedDek: arrayBufferToBase64(wrappedDek),
    argon2Salt: bytesToBase64(salt),
    wrappedSigningSecretKey: bytesToBase64(serializePayload(encryptedSigningSecret)),
    signingPublicKey: bytesToBase64(unlocked.signingPublicKey),
    kekVersion: 1,
    recoveryKit: '',
  };
  payload.recoveryKit = createRecoveryKit(payload);
  new Uint8Array(kekRaw).fill(0);
  return payload;
}

export async function unlockWrappedKeyMaterial(
  material: WrappedKeyMaterialRecord,
  unlockSecret: string,
  worker: CryptoWorkerClient,
): Promise<UnlockedKeyMaterial> {
  const salt = base64ToBytes(material.argon2Salt);
  const kekRaw = await worker.deriveKEK(unlockSecret, salt);
  const kekWrapKey = await importKEK(kekRaw);
  const kekEncryptKey = await importAesGcmKey(kekRaw);
  const dek = await unwrapDEK(kekWrapKey, base64ToArrayBuffer(material.wrappedDek));
  const wrappedSecretPayload = base64ToBytes(material.wrappedSigningSecretKey);
  const parsedSecretPayload = {
    iv: wrappedSecretPayload.slice(0, 12),
    ciphertext: wrappedSecretPayload.slice(12).buffer,
  };
  const signingSecretKey = new Uint8Array(
    await decrypt(kekEncryptKey, parsedSecretPayload.ciphertext, parsedSecretPayload.iv),
  );
  const signingPublicKey = base64ToBytes(material.signingPublicKey);
  const subKeys = await deriveSubKeys(dek);

  new Uint8Array(kekRaw).fill(0);
  return {
    dek,
    signingPublicKey,
    signingSecretKey,
    subKeys,
  };
}

export async function encryptJsonSnapshot(key: CryptoKey, value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const payload = await encrypt(key, encoded);
  return bytesToBase64(serializePayload(payload));
}

export async function decryptJsonSnapshot<T>(key: CryptoKey, encrypted: string): Promise<T> {
  const serialized = base64ToBytes(encrypted);
  const iv = serialized.slice(0, 12);
  const ciphertext = serialized.slice(12).buffer;
  const plaintext = await decrypt(key, ciphertext, iv);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
