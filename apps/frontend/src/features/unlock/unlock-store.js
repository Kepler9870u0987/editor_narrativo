import { create } from 'zustand';
export const useUnlockStore = create((set) => ({
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
//# sourceMappingURL=unlock-store.js.map