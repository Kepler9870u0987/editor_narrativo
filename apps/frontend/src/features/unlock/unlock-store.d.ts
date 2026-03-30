import type { WrappedKeyMaterialRecord } from '@editor-narrativo/account-shared';
import type { UnlockedKeyMaterial } from '../../lib/keys';
export type UnlockStatus = 'locked' | 'unlocking' | 'unlocked';
interface UnlockState {
    status: UnlockStatus;
    material: WrappedKeyMaterialRecord | null;
    unlocked: UnlockedKeyMaterial | null;
    setMaterial(material: WrappedKeyMaterialRecord | null): void;
    setUnlocking(): void;
    setUnlocked(unlocked: UnlockedKeyMaterial): void;
    lock(): void;
}
export declare const useUnlockStore: import("zustand").UseBoundStore<import("zustand").StoreApi<UnlockState>>;
export {};
//# sourceMappingURL=unlock-store.d.ts.map