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

export class EditorDatabase extends Dexie {
  documents!: Table<LocalDocumentRecord, string>;
  snapshots!: Table<LocalEncryptedSnapshotRecord, string>;
  pendingUpdates!: Table<PendingRemoteUpdateRecord, string>;

  constructor() {
    super('editor-narrativo');
    this.version(1).stores({
      documents: '&id, updatedAt, kind, syncState',
      snapshots: '&documentId, updatedAt',
      pendingUpdates: '&updateId, documentId, clock',
    });
  }
}

export const editorDb = new EditorDatabase();
