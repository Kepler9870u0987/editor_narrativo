import { create } from 'zustand';
import type { DocumentSummary } from '@editor-narrativo/documents-shared';
import type { LogicCheckResponse } from '@editor-narrativo/shared';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'resync_required';

interface EditorState {
  activeDocumentId: string | null;
  activeDocument: DocumentSummary | null;
  syncState: SyncState;
  logicCheckResult: LogicCheckResponse | null;
  setActiveDocument(document: DocumentSummary | null): void;
  setSyncState(syncState: SyncState): void;
  setLogicCheckResult(result: LogicCheckResponse | null): void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeDocumentId: null,
  activeDocument: null,
  syncState: 'idle',
  logicCheckResult: null,
  setActiveDocument: (document) =>
    set({
      activeDocumentId: document?.id ?? null,
      activeDocument: document,
    }),
  setSyncState: (syncState) => set({ syncState }),
  setLogicCheckResult: (logicCheckResult) => set({ logicCheckResult }),
}));
