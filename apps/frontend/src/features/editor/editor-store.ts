import { create } from 'zustand';
import type { DocumentSummary } from '@editor-narrativo/documents-shared';
import type { LogicCheckResponse } from '@editor-narrativo/shared';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'resync_required';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RagChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  citations: string[];
}

function loadPressureLevel(): number {
  try {
    const stored = localStorage.getItem('editor-pressure-level');
    if (stored) {
      const level = Number(stored);
      if (level >= 1 && level <= 5) return level;
    }
  } catch { /* ignore */ }
  return 2;
}

interface EditorState {
  activeDocumentId: string | null;
  activeDocument: DocumentSummary | null;
  syncState: SyncState;
  logicCheckResult: LogicCheckResponse | null;

  // Pressure control
  pressureLevel: number;
  setPressureLevel(level: number): void;

  // RAG chat
  ragChatMessages: RagChatMessage[];
  ragChatOpen: boolean;
  addRagChatMessage(message: RagChatMessage): void;
  clearRagChatMessages(): void;
  toggleRagChat(): void;

  // Model status
  modelStatus: ModelStatus;
  modelDownloadProgress: number;
  setModelStatus(status: ModelStatus): void;
  setModelDownloadProgress(progress: number): void;

  setActiveDocument(document: DocumentSummary | null): void;
  setSyncState(syncState: SyncState): void;
  setLogicCheckResult(result: LogicCheckResponse | null): void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeDocumentId: null,
  activeDocument: null,
  syncState: 'idle',
  logicCheckResult: null,

  // Pressure control
  pressureLevel: loadPressureLevel(),
  setPressureLevel: (level) => {
    localStorage.setItem('editor-pressure-level', String(level));
    set({ pressureLevel: level });
  },

  // RAG chat
  ragChatMessages: [],
  ragChatOpen: false,
  addRagChatMessage: (message) =>
    set((state) => ({ ragChatMessages: [...state.ragChatMessages, message] })),
  clearRagChatMessages: () => set({ ragChatMessages: [] }),
  toggleRagChat: () => set((state) => ({ ragChatOpen: !state.ragChatOpen })),

  // Model status
  modelStatus: 'idle',
  modelDownloadProgress: 0,
  setModelStatus: (modelStatus) => set({ modelStatus }),
  setModelDownloadProgress: (modelDownloadProgress) => set({ modelDownloadProgress }),

  setActiveDocument: (document) =>
    set({
      activeDocumentId: document?.id ?? null,
      activeDocument: document,
    }),
  setSyncState: (syncState) => set({ syncState }),
  setLogicCheckResult: (logicCheckResult) => set({ logicCheckResult }),
}));
