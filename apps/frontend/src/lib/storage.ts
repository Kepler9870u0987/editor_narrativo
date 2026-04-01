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

export interface StoredVectorRecord {
  /** Composite key: `${documentId}:${blockId}:${chunkIndex}` */
  id: string;
  documentId: string;
  blockId: string;
  chunkIndex: number;
  /** Serialized Float32Array as base64 */
  vector: string;
  /** Source text of this chunk (for retrieval) */
  text: string;
  updatedAt: string;
}

export class EditorDatabase extends Dexie {
  documents!: Table<LocalDocumentRecord, string>;
  snapshots!: Table<LocalEncryptedSnapshotRecord, string>;
  pendingUpdates!: Table<PendingRemoteUpdateRecord, string>;
  vectors!: Table<StoredVectorRecord, string>;

  constructor() {
    super('editor-narrativo');
    this.version(1).stores({
      documents: '&id, updatedAt, kind, syncState',
      snapshots: '&documentId, updatedAt',
      pendingUpdates: '&updateId, documentId, clock',
    });
    this.version(2).stores({
      documents: '&id, updatedAt, kind, syncState',
      snapshots: '&documentId, updatedAt',
      pendingUpdates: '&updateId, documentId, clock',
      vectors: '&id, documentId, blockId, updatedAt',
    });
  }
}

export const editorDb = new EditorDatabase();
