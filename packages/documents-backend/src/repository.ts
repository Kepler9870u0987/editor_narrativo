import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CreateDocumentRequest,
  DocumentSummary,
  EncryptedDocumentSnapshot,
  EncryptedDocumentUpdate,
  UpdateDocumentRequest,
} from '@editor-narrativo/documents-shared';

type Row = Record<string, unknown>;

function toDate(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new Error('Invalid date value in SQLite row');
  }
  return new Date(value);
}

function toNullableDate(value: unknown): Date | null {
  return value === null ? null : toDate(value);
}

export interface DocumentRecord {
  id: string;
  ownerUserId: string;
  title: string;
  kind: DocumentSummary['kind'];
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  latestClock: number;
}

export class SQLiteDocumentsRepository {
  private readonly database: DatabaseSync;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new DatabaseSync(resolvedPath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT NULL,
        latest_clock INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS document_snapshots (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        snapshot_id TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        iv TEXT NOT NULL,
        signature TEXT NOT NULL,
        public_key TEXT NOT NULL,
        clock INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_updates (
        update_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        encrypted_data TEXT NOT NULL,
        iv TEXT NOT NULL,
        signature TEXT NOT NULL,
        public_key TEXT NOT NULL,
        clock INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_documents_owner_updated
        ON documents(owner_user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_document_updates_clock
        ON document_updates(document_id, clock ASC);
    `);
  }

  close(): void {
    this.database.close();
  }

  private mapDocument(row: Row): DocumentRecord {
    return {
      id: String(row.id),
      ownerUserId: String(row.owner_user_id),
      title: String(row.title),
      kind: String(row.kind) as DocumentSummary['kind'],
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
      archivedAt: toNullableDate(row.archived_at),
      latestClock: Number(row.latest_clock),
    };
  }

  private mapSummary(row: Row): DocumentSummary {
    const record = this.mapDocument(row);
    return {
      id: record.id,
      ownerUserId: record.ownerUserId,
      title: record.title,
      kind: record.kind,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      archivedAt: record.archivedAt?.toISOString() ?? null,
      latestClock: record.latestClock,
      hasSnapshot: Number(row.has_snapshot) === 1,
    };
  }

  createDocument(userId: string, input: CreateDocumentRequest): DocumentSummary {
    const now = new Date();
    const documentId = crypto.randomUUID();
    this.database
      .prepare(`
        INSERT INTO documents (id, owner_user_id, title, kind, created_at, updated_at, archived_at, latest_clock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        documentId,
        userId,
        input.title,
        input.kind,
        now.toISOString(),
        now.toISOString(),
        null,
        0,
      );

    const row = this.database
      .prepare(`
        SELECT d.*, CASE WHEN s.document_id IS NULL THEN 0 ELSE 1 END AS has_snapshot
        FROM documents d
        LEFT JOIN document_snapshots s ON s.document_id = d.id
        WHERE d.id = ?
      `)
      .get(documentId) as Row;
    return this.mapSummary(row);
  }

  listDocumentsForUser(userId: string): DocumentSummary[] {
    const rows = this.database
      .prepare(`
        SELECT d.*, CASE WHEN s.document_id IS NULL THEN 0 ELSE 1 END AS has_snapshot
        FROM documents d
        LEFT JOIN document_snapshots s ON s.document_id = d.id
        WHERE d.owner_user_id = ?
        ORDER BY d.updated_at DESC
      `)
      .all(userId) as Row[];
    return rows.map((row) => this.mapSummary(row));
  }

  getDocument(documentId: string): DocumentSummary | null {
    const row = this.database
      .prepare(`
        SELECT d.*, CASE WHEN s.document_id IS NULL THEN 0 ELSE 1 END AS has_snapshot
        FROM documents d
        LEFT JOIN document_snapshots s ON s.document_id = d.id
        WHERE d.id = ?
      `)
      .get(documentId) as Row | undefined;
    return row ? this.mapSummary(row) : null;
  }

  getDocumentRecord(documentId: string): DocumentRecord | null {
    const row = this.database
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(documentId) as Row | undefined;
    return row ? this.mapDocument(row) : null;
  }

  updateDocument(documentId: string, patch: UpdateDocumentRequest): DocumentSummary | null {
    const current = this.getDocumentRecord(documentId);
    if (!current) {
      return null;
    }

    const updated: DocumentRecord = {
      ...current,
      title: patch.title?.trim() || current.title,
      archivedAt:
        patch.archived === undefined
          ? current.archivedAt
          : patch.archived
            ? current.archivedAt ?? new Date()
            : null,
      updatedAt: new Date(),
    };

    this.database
      .prepare(`
        UPDATE documents
        SET title = ?, kind = ?, updated_at = ?, archived_at = ?, latest_clock = ?
        WHERE id = ?
      `)
      .run(
        updated.title,
        updated.kind,
        updated.updatedAt.toISOString(),
        updated.archivedAt?.toISOString() ?? null,
        updated.latestClock,
        updated.id,
      );

    return this.getDocument(documentId);
  }

  getSnapshot(documentId: string): EncryptedDocumentSnapshot | null {
    const row = this.database
      .prepare('SELECT * FROM document_snapshots WHERE document_id = ?')
      .get(documentId) as Row | undefined;

    if (!row) {
      return null;
    }

    return {
      documentId: String(row.document_id),
      snapshotId: String(row.snapshot_id),
      encryptedData: String(row.encrypted_data),
      iv: String(row.iv),
      signature: String(row.signature),
      publicKey: String(row.public_key),
      clock: Number(row.clock),
      createdAt: String(row.created_at),
    };
  }

  putSnapshot(snapshot: EncryptedDocumentSnapshot): void {
    const existing = this.getDocumentRecord(snapshot.documentId);
    if (!existing) {
      throw new Error('Document not found');
    }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(`
          INSERT INTO document_snapshots (
            document_id, snapshot_id, encrypted_data, iv, signature, public_key, clock, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(document_id) DO UPDATE SET
            snapshot_id = excluded.snapshot_id,
            encrypted_data = excluded.encrypted_data,
            iv = excluded.iv,
            signature = excluded.signature,
            public_key = excluded.public_key,
            clock = excluded.clock,
            created_at = excluded.created_at
        `)
        .run(
          snapshot.documentId,
          snapshot.snapshotId,
          snapshot.encryptedData,
          snapshot.iv,
          snapshot.signature,
          snapshot.publicKey,
          snapshot.clock,
          snapshot.createdAt,
        );
      this.database
        .prepare(`
          UPDATE documents
          SET updated_at = ?, latest_clock = CASE WHEN latest_clock > ? THEN latest_clock ELSE ? END
          WHERE id = ?
        `)
        .run(
          new Date().toISOString(),
          snapshot.clock,
          snapshot.clock,
          snapshot.documentId,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listUpdatesAfter(documentId: string, afterClock: number): EncryptedDocumentUpdate[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM document_updates
        WHERE document_id = ? AND clock > ?
        ORDER BY clock ASC
      `)
      .all(documentId, afterClock) as Row[];

    return rows.map((row) => ({
      documentId: String(row.document_id),
      updateId: String(row.update_id),
      encryptedData: String(row.encrypted_data),
      iv: String(row.iv),
      signature: String(row.signature),
      publicKey: String(row.public_key),
      clock: Number(row.clock),
      createdAt: String(row.created_at),
    }));
  }

  appendUpdates(documentId: string, updates: EncryptedDocumentUpdate[]): { accepted: EncryptedDocumentUpdate[]; latestClock: number } {
    const document = this.getDocumentRecord(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    let latestClock = document.latestClock;
    const accepted: EncryptedDocumentUpdate[] = [];
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const update of updates) {
        if (update.documentId !== documentId) {
          throw new Error('Document ID mismatch in update batch');
        }
        if (update.clock <= latestClock) {
          throw new Error('Out-of-sequence update clock');
        }

        this.database
          .prepare(`
            INSERT INTO document_updates (
              update_id, document_id, encrypted_data, iv, signature, public_key, clock, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            update.updateId,
            update.documentId,
            update.encryptedData,
            update.iv,
            update.signature,
            update.publicKey,
            update.clock,
            update.createdAt,
          );

        latestClock = update.clock;
        accepted.push(update);
      }

      this.database
        .prepare('UPDATE documents SET updated_at = ?, latest_clock = ? WHERE id = ?')
        .run(new Date().toISOString(), latestClock, documentId);

      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return { accepted, latestClock };
  }
}
