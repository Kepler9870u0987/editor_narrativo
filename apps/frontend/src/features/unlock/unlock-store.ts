import { create } from 'zustand';
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

export const useUnlockStore = create<UnlockState>((set) => ({
  status: 'locked',
  material: null,
  unlocked: null,
  setMaterial: (material) => set({ material }),
  setUnlocking: () => set({ status: 'unlocking' }),
  setUnlocked: (unlocked) => set({ status: 'unlocked', unlocked }),
  lock: () => {
    const existing = useUnlockStore.getState().unlocked;
    existing?.signingSecretKey.fill(0);
    set({ status: 'locked', material: null, unlocked: null });
  },
}));
