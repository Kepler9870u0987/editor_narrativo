import Dexie, { type Table } from 'dexie';
import type { DocumentKind } from '@editor-narrativo/documents-shared';
export interface LocalDocumentRecord {
    id: string;
    title: string;
    kind: DocumentKind;
    updatedAt: string;
    lastOpenedAt: string;
    archivedAt: string | null;
    latestClock: number;
    syncState: 'idle' | 'syncing' | 'offline' | 'resync_required';
}
export interface LocalEncryptedSnapshotRecord {
    documentId: string;
    encryptedBlob: string;
    updatedAt: string;
}
export interface PendingRemoteUpdateRecord {
    updateId: string;
    documentId: string;
    payload: string;
    clock: number;
    createdAt: string;
}
export declare class EditorDatabase extends Dexie {
    documents: Table<LocalDocumentRecord, string>;
    snapshots: Table<LocalEncryptedSnapshotRecord, string>;
    pendingUpdates: Table<PendingRemoteUpdateRecord, string>;
    constructor();
}
export declare const editorDb: EditorDatabase;
//# sourceMappingURL=storage.d.ts.map