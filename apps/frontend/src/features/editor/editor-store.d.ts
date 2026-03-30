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
export declare const useEditorStore: import("zustand").UseBoundStore<import("zustand").StoreApi<EditorState>>;
export {};
//# sourceMappingURL=editor-store.d.ts.map