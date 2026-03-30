import { create } from 'zustand';
export const useEditorStore = create((set) => ({
    activeDocumentId: null,
    activeDocument: null,
    syncState: 'idle',
    logicCheckResult: null,
    setActiveDocument: (document) => set({
        activeDocumentId: document?.id ?? null,
        activeDocument: document,
    }),
    setSyncState: (syncState) => set({ syncState }),
    setLogicCheckResult: (logicCheckResult) => set({ logicCheckResult }),
}));
//# sourceMappingURL=editor-store.js.map