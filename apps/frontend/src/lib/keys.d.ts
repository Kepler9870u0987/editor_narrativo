import type { WrappedKeyMaterialRecord } from '@editor-narrativo/account-shared';
import { CryptoWorkerClient, deriveSubKeys } from '@editor-narrativo/crypto';
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
export declare function createBootstrapKeyMaterial(unlockSecret: string, worker: CryptoWorkerClient): Promise<BootstrapKeyMaterialPayload>;
export declare function rewrapUnlockedKeyMaterial(unlocked: UnlockedKeyMaterial, unlockSecret: string, worker: CryptoWorkerClient): Promise<BootstrapKeyMaterialPayload>;
export declare function unlockWrappedKeyMaterial(material: WrappedKeyMaterialRecord, unlockSecret: string, worker: CryptoWorkerClient): Promise<UnlockedKeyMaterial>;
export declare function encryptJsonSnapshot(key: CryptoKey, value: unknown): Promise<string>;
export declare function decryptJsonSnapshot<T>(key: CryptoKey, encrypted: string): Promise<T>;
//# sourceMappingURL=keys.d.ts.map