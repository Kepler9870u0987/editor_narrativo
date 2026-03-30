export type DocumentKind = 'manuscript' | 'story_bible' | 'notes';

export interface DocumentSummary {
  id: string;
  title: string;
  kind: DocumentKind;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  latestClock: number;
  hasSnapshot: boolean;
}

export interface DocumentClock {
  value: number;
}

export interface EncryptedDocumentSnapshot {
  documentId: string;
  snapshotId: string;
  encryptedData: string;
  iv: string;
  signature: string;
  publicKey: string;
  clock: number;
  createdAt: string;
}

export interface EncryptedDocumentUpdate {
  documentId: string;
  updateId: string;
  encryptedData: string;
  iv: string;
  signature: string;
  publicKey: string;
  clock: number;
  createdAt: string;
}

export interface CreateDocumentRequest {
  title: string;
  kind: DocumentKind;
}

export interface UpdateDocumentRequest {
  title?: string;
  archived?: boolean;
}

export interface PutSnapshotRequest {
  snapshot: EncryptedDocumentSnapshot;
}

export interface PostUpdatesBatchRequest {
  updates: EncryptedDocumentUpdate[];
}

export interface MissingUpdatesResponse {
  documentId: string;
  updates: EncryptedDocumentUpdate[];
}

export type DocumentWSClientMessage =
  | { type: 'AUTH'; token: string }
  | { type: 'SUBSCRIBE_DOCUMENT'; documentId: string }
  | { type: 'PUSH_UPDATE'; update: EncryptedDocumentUpdate }
  | { type: 'REQUEST_MISSING_UPDATES'; documentId: string; afterClock: number }
  | { type: 'PING' };

export type DocumentWSServerMessage =
  | { type: 'AUTH_OK' }
  | { type: 'AUTH_FAIL'; reason: string }
  | { type: 'SNAPSHOT'; snapshot: EncryptedDocumentSnapshot | null }
  | { type: 'REMOTE_UPDATE'; update: EncryptedDocumentUpdate }
  | { type: 'UPDATE_ACK'; documentId: string; updateId: string; clock: number }
  | { type: 'MISSING_UPDATES'; documentId: string; updates: EncryptedDocumentUpdate[] }
  | { type: 'RESYNC_REQUIRED'; documentId: string; reason: string }
  | { type: 'PONG' }
  | { type: 'ERROR'; message: string; documentId?: string };
