import { decrypt, deriveSubKeys, encrypt, generateDEK, generateSalt, importKEK, serializePayload, unwrapDEK, wrapDEK, } from '@editor-narrativo/crypto';
import { arrayBufferToBase64, base64ToArrayBuffer, base64ToBytes, bytesToBase64 } from './base64';
async function importAesGcmKey(rawKey) {
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
function createRecoveryKit(payload) {
    return JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        ...payload,
    });
}
export async function createBootstrapKeyMaterial(unlockSecret, worker) {
    const salt = await generateSalt();
    const kekRaw = await worker.deriveKEK(unlockSecret, salt);
    const kekWrapKey = await importKEK(kekRaw);
    const kekEncryptKey = await importAesGcmKey(kekRaw);
    const dek = await generateDEK();
    const wrappedDek = await wrapDEK(kekWrapKey, dek);
    const signingKeyPair = await worker.generateSigningKeyPair();
    const encryptedSigningSecret = await encrypt(kekEncryptKey, signingKeyPair.secretKey);
    const payload = {
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
export async function rewrapUnlockedKeyMaterial(unlocked, unlockSecret, worker) {
    const salt = await generateSalt();
    const kekRaw = await worker.deriveKEK(unlockSecret, salt);
    const kekWrapKey = await importKEK(kekRaw);
    const kekEncryptKey = await importAesGcmKey(kekRaw);
    const wrappedDek = await wrapDEK(kekWrapKey, unlocked.dek);
    const encryptedSigningSecret = await encrypt(kekEncryptKey, unlocked.signingSecretKey);
    const payload = {
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
export async function unlockWrappedKeyMaterial(material, unlockSecret, worker) {
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
    const signingSecretKey = new Uint8Array(await decrypt(kekEncryptKey, parsedSecretPayload.ciphertext, parsedSecretPayload.iv));
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
export async function encryptJsonSnapshot(key, value) {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const payload = await encrypt(key, encoded);
    return bytesToBase64(serializePayload(payload));
}
export async function decryptJsonSnapshot(key, encrypted) {
    const serialized = base64ToBytes(encrypted);
    const iv = serialized.slice(0, 12);
    const ciphertext = serialized.slice(12).buffer;
    const plaintext = await decrypt(key, ciphertext, iv);
    return JSON.parse(new TextDecoder().decode(plaintext));
}
//# sourceMappingURL=keys.js.map