/**
 * PersistedVectorIndex — A VectorIndex implementation backed by IndexedDB
 * via Dexie, providing persistence across browser sessions.
 *
 * Uses BruteForceIndex from @editor-narrativo/rag as the in-memory search
 * engine, with automatic serialization/deserialization to the `vectors` table.
 *
 * When hnswlib-wasm becomes available, this can be swapped to wrap HNSWIndex
 * while keeping the same persistence layer.
 */

import type { VectorIndex, SearchResult } from '@editor-narrativo/rag';
import { cosineSimilarity } from '@editor-narrativo/rag';
import type { HNSWConfig } from '@editor-narrativo/shared';
import { editorDb, type StoredVectorRecord } from './storage';

function vectorToBase64(vec: Float32Array): string {
  const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToVector(base64: string, dim: number): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, 0, dim);
}

export class PersistedVectorIndex implements VectorIndex {
  private vectors = new Map<number, Float32Array>();
  private idToKey = new Map<number, string>();
  private keyToId = new Map<string, number>();
  private dim = 0;
  private nextNumericId = 0;
  private documentId: string;

  constructor(documentId: string) {
    this.documentId = documentId;
  }

  async init(config: HNSWConfig): Promise<void> {
    this.dim = config.dim;
    this.vectors.clear();
    this.idToKey.clear();
    this.keyToId.clear();
    this.nextNumericId = 0;
  }

  async addVector(id: number, vector: Float32Array): Promise<void> {
    if (vector.length !== this.dim) {
      throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${vector.length}`);
    }
    this.vectors.set(id, vector);
  }

  /**
   * Add a vector with a string composite key for persistence.
   * The key format is `${blockId}:${chunkIndex}`.
   */
  async addVectorWithKey(
    key: string,
    vector: Float32Array,
    text: string,
  ): Promise<number> {
    const fullKey = `${this.documentId}:${key}`;
    let numericId = this.keyToId.get(fullKey);
    if (numericId === undefined) {
      numericId = this.nextNumericId++;
      this.keyToId.set(fullKey, numericId);
      this.idToKey.set(numericId, fullKey);
    }

    this.vectors.set(numericId, vector);

    // Parse blockId and chunkIndex from key
    const parts = key.split(':');
    const blockId = parts[0] ?? key;
    const chunkIndex = parseInt(parts[1] ?? '0', 10);

    await editorDb.vectors.put({
      id: fullKey,
      documentId: this.documentId,
      blockId,
      chunkIndex,
      vector: vectorToBase64(vector),
      text,
      updatedAt: new Date().toISOString(),
    });

    return numericId;
  }

  async search(queryVector: Float32Array, k: number): Promise<SearchResult> {
    if (queryVector.length !== this.dim) {
      throw new Error(`Query dimension mismatch: expected ${this.dim}, got ${queryVector.length}`);
    }

    const scored: Array<{ id: number; distance: number }> = [];

    for (const [id, vec] of this.vectors) {
      const similarity = cosineSimilarity(queryVector, vec);
      scored.push({ id, distance: 1 - similarity });
    }

    scored.sort((a, b) => a.distance - b.distance);
    const topK = scored.slice(0, k);

    return {
      ids: topK.map((s) => s.id),
      distances: topK.map((s) => s.distance),
    };
  }

  /**
   * Search and return text passages directly.
   */
  async searchWithText(
    queryVector: Float32Array,
    k: number,
    threshold = 0.3,
  ): Promise<Array<{ text: string; distance: number; blockId: string }>> {
    const result = await this.search(queryVector, k);
    const entries: Array<{ text: string; distance: number; blockId: string }> = [];

    for (let i = 0; i < result.ids.length; i++) {
      const distance = result.distances[i]!;
      if (distance > threshold) continue;

      const fullKey = this.idToKey.get(result.ids[i]!);
      if (!fullKey) continue;

      const record = await editorDb.vectors.get(fullKey);
      if (record) {
        entries.push({ text: record.text, distance, blockId: record.blockId });
      }
    }

    return entries;
  }

  async removeVector(id: number): Promise<void> {
    this.vectors.delete(id);
    const key = this.idToKey.get(id);
    if (key) {
      this.idToKey.delete(id);
      this.keyToId.delete(key);
      await editorDb.vectors.delete(key);
    }
  }

  /**
   * Remove all vectors for a given block ID.
   */
  async removeBlockVectors(blockId: string): Promise<void> {
    const records = await editorDb.vectors
      .where('blockId')
      .equals(blockId)
      .and((r) => r.documentId === this.documentId)
      .toArray();

    for (const record of records) {
      const numericId = this.keyToId.get(record.id);
      if (numericId !== undefined) {
        this.vectors.delete(numericId);
        this.idToKey.delete(numericId);
      }
      this.keyToId.delete(record.id);
    }

    await editorDb.vectors
      .where('blockId')
      .equals(blockId)
      .and((r) => r.documentId === this.documentId)
      .delete();
  }

  async persist(): Promise<void> {
    // Already persisted on addVectorWithKey, this is a no-op for bulk flush
  }

  async load(): Promise<void> {
    const records = await editorDb.vectors
      .where('documentId')
      .equals(this.documentId)
      .toArray();

    this.vectors.clear();
    this.idToKey.clear();
    this.keyToId.clear();
    this.nextNumericId = 0;

    for (const record of records) {
      const numericId = this.nextNumericId++;
      const vector = base64ToVector(record.vector, this.dim);
      this.vectors.set(numericId, vector);
      this.keyToId.set(record.id, numericId);
      this.idToKey.set(numericId, record.id);
    }
  }

  /**
   * Remove all vectors for this document from IndexedDB and memory.
   */
  async clear(): Promise<void> {
    this.vectors.clear();
    this.idToKey.clear();
    this.keyToId.clear();
    this.nextNumericId = 0;

    await editorDb.vectors
      .where('documentId')
      .equals(this.documentId)
      .delete();
  }

  get size(): number {
    return this.vectors.size;
  }

  get dimension(): number {
    return this.dim;
  }
}
