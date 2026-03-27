/**
 * VectorIndex — In-memory HNSW vector search index.
 *
 * In production this wraps hnswlib-wasm running inside a Web Worker.
 * This module provides the abstract interface and an in-memory brute-force
 * reference implementation for testing.
 *
 * The production WASM implementation is loaded at runtime.
 */

import { HNSW_DEFAULTS } from '@editor-narrativo/shared';
import type { HNSWConfig } from '@editor-narrativo/shared';
import { cosineSimilarity } from './embedding-service.js';

// ── Abstract interface ─────────────────────────────────────────

export interface VectorIndex {
  /** Initialize the index with the given config */
  init(config: HNSWConfig): Promise<void>;
  /** Add a vector with the given ID */
  addVector(id: number, vector: Float32Array): Promise<void>;
  /** Search for the k nearest neighbours to the query vector */
  search(queryVector: Float32Array, k: number): Promise<SearchResult>;
  /** Mark a vector as deleted */
  removeVector(id: number): Promise<void>;
  /** Persist the index to storage */
  persist(): Promise<void>;
  /** Load the index from storage */
  load(): Promise<void>;
  /** Number of vectors currently stored */
  readonly size: number;
}

export interface SearchResult {
  ids: number[];
  distances: number[];
}

// ── Brute-force reference implementation (for testing) ─────────

export class BruteForceIndex implements VectorIndex {
  private vectors = new Map<number, Float32Array>();
  private dim = 0;

  async init(config: HNSWConfig): Promise<void> {
    this.dim = config.dim;
    this.vectors.clear();
  }

  async addVector(id: number, vector: Float32Array): Promise<void> {
    if (vector.length !== this.dim) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dim}, got ${vector.length}`,
      );
    }
    this.vectors.set(id, vector);
  }

  async search(queryVector: Float32Array, k: number): Promise<SearchResult> {
    if (queryVector.length !== this.dim) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dim}, got ${queryVector.length}`,
      );
    }

    const scored: Array<{ id: number; distance: number }> = [];

    for (const [id, vec] of this.vectors) {
      // Cosine distance = 1 - cosine_similarity
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

  async removeVector(id: number): Promise<void> {
    this.vectors.delete(id);
  }

  async persist(): Promise<void> {
    // No-op in brute-force reference implementation
  }

  async load(): Promise<void> {
    // No-op in brute-force reference implementation
  }

  get size(): number {
    return this.vectors.size;
  }
}

/**
 * Default HNSW config from shared constants.
 */
export function defaultHNSWConfig(dim?: number): HNSWConfig {
  return {
    space: HNSW_DEFAULTS.SPACE,
    dim: dim ?? HNSW_DEFAULTS.DIM,
    maxElements: HNSW_DEFAULTS.MAX_ELEMENTS,
    M: HNSW_DEFAULTS.M,
    efConstruction: HNSW_DEFAULTS.EF_CONSTRUCTION,
  };
}
