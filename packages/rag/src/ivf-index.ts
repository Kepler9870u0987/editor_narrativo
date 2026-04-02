/**
 * IVFIndex — Inverted File Index for approximate nearest neighbor search.
 *
 * Clusters vectors into `nClusters` partitions via k-means, then at search
 * time probes only the `nProbe` nearest clusters. This reduces search
 * complexity from O(n) to O(n/nClusters * nProbe).
 *
 * Suitable for in-browser use without WASM dependencies.
 * Trade-off: slight recall loss for significant speed gain on >1000 vectors.
 */

import type { HNSWConfig } from '@editor-narrativo/shared';
import { cosineSimilarity } from './embedding-service.js';
import type { VectorIndex, SearchResult } from './vector-index.js';

const DEFAULT_N_CLUSTERS = 32;
const DEFAULT_N_PROBE = 4;
const KMEANS_MAX_ITERATIONS = 20;

export interface IVFConfig {
  nClusters?: number;
  nProbe?: number;
}

export class IVFIndex implements VectorIndex {
  private dim = 0;
  private vectors = new Map<number, Float32Array>();
  private centroids: Float32Array[] = [];
  private clusters = new Map<number, Set<number>>(); // centroidIdx -> vectorIds
  private vectorCluster = new Map<number, number>(); // vectorId -> centroidIdx
  private nClusters: number;
  private nProbe: number;
  private dirty = false;

  constructor(config: IVFConfig = {}) {
    this.nClusters = config.nClusters ?? DEFAULT_N_CLUSTERS;
    this.nProbe = config.nProbe ?? DEFAULT_N_PROBE;
  }

  async init(hnswConfig: HNSWConfig): Promise<void> {
    this.dim = hnswConfig.dim;
    this.vectors.clear();
    this.centroids = [];
    this.clusters.clear();
    this.vectorCluster.clear();
    this.dirty = false;
  }

  async addVector(id: number, vector: Float32Array): Promise<void> {
    if (vector.length !== this.dim) {
      throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${vector.length}`);
    }
    this.vectors.set(id, vector);
    this.dirty = true;

    // If centroids exist, assign to nearest cluster immediately
    if (this.centroids.length > 0) {
      const nearest = this.findNearestCentroid(vector);
      this.vectorCluster.set(id, nearest);
      const cluster = this.clusters.get(nearest);
      if (cluster) cluster.add(id);
    }
  }

  async search(queryVector: Float32Array, k: number): Promise<SearchResult> {
    if (queryVector.length !== this.dim) {
      throw new Error(`Query dimension mismatch: expected ${this.dim}, got ${queryVector.length}`);
    }

    // Rebuild clusters if needed and enough vectors
    if (this.dirty && this.vectors.size >= this.nClusters * 2) {
      this.buildIndex();
    }

    // If not enough vectors for clustering, fall back to brute force
    if (this.centroids.length === 0) {
      return this.bruteForceSearch(queryVector, k);
    }

    // Find nearest centroids
    const centroidScores: Array<{ idx: number; sim: number }> = [];
    for (let i = 0; i < this.centroids.length; i++) {
      centroidScores.push({ idx: i, sim: cosineSimilarity(queryVector, this.centroids[i]!) });
    }
    centroidScores.sort((a, b) => b.sim - a.sim);

    // Search only in the nProbe nearest clusters
    const probeCount = Math.min(this.nProbe, centroidScores.length);
    const candidates: Array<{ id: number; distance: number }> = [];

    for (let p = 0; p < probeCount; p++) {
      const cluster = this.clusters.get(centroidScores[p]!.idx);
      if (!cluster) continue;
      for (const vecId of cluster) {
        const vec = this.vectors.get(vecId);
        if (!vec) continue;
        candidates.push({ id: vecId, distance: 1 - cosineSimilarity(queryVector, vec) });
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    const topK = candidates.slice(0, k);

    return {
      ids: topK.map((c) => c.id),
      distances: topK.map((c) => c.distance),
    };
  }

  async removeVector(id: number): Promise<void> {
    this.vectors.delete(id);
    const clusterIdx = this.vectorCluster.get(id);
    if (clusterIdx !== undefined) {
      this.clusters.get(clusterIdx)?.delete(id);
      this.vectorCluster.delete(id);
    }
  }

  async persist(): Promise<void> {
    // No-op — persistence is handled by PersistedVectorIndex wrapper
  }

  async load(): Promise<void> {
    // After loading, mark dirty to trigger rebuild
    if (this.vectors.size > 0) {
      this.dirty = true;
    }
  }

  get size(): number {
    return this.vectors.size;
  }

  /**
   * Force rebuild of the IVF index (k-means clustering).
   * Called automatically on first search after addVector.
   */
  buildIndex(): void {
    const allVectors = Array.from(this.vectors.entries());
    if (allVectors.length < this.nClusters) {
      // Not enough vectors for clustering
      this.dirty = false;
      return;
    }

    // Initialize centroids via k-means++
    this.centroids = this.initCentroids(allVectors);

    // Run k-means iterations
    for (let iter = 0; iter < KMEANS_MAX_ITERATIONS; iter++) {
      // Assign vectors to nearest centroid
      this.clusters.clear();
      for (let i = 0; i < this.centroids.length; i++) {
        this.clusters.set(i, new Set());
      }

      for (const [id, vec] of allVectors) {
        const nearest = this.findNearestCentroid(vec);
        this.vectorCluster.set(id, nearest);
        this.clusters.get(nearest)!.add(id);
      }

      // Recompute centroids
      let converged = true;
      for (let i = 0; i < this.centroids.length; i++) {
        const cluster = this.clusters.get(i)!;
        if (cluster.size === 0) continue;

        const newCentroid = new Float32Array(this.dim);
        for (const vecId of cluster) {
          const vec = this.vectors.get(vecId)!;
          for (let d = 0; d < this.dim; d++) {
            newCentroid[d]! += vec[d]!;
          }
        }
        for (let d = 0; d < this.dim; d++) {
          newCentroid[d]! /= cluster.size;
        }

        // Check convergence
        const sim = cosineSimilarity(this.centroids[i]!, newCentroid);
        if (sim < 0.9999) converged = false;
        this.centroids[i] = newCentroid;
      }

      if (converged) break;
    }

    this.dirty = false;
  }

  private bruteForceSearch(queryVector: Float32Array, k: number): SearchResult {
    const scored: Array<{ id: number; distance: number }> = [];
    for (const [id, vec] of this.vectors) {
      scored.push({ id, distance: 1 - cosineSimilarity(queryVector, vec) });
    }
    scored.sort((a, b) => a.distance - b.distance);
    const topK = scored.slice(0, k);
    return {
      ids: topK.map((s) => s.id),
      distances: topK.map((s) => s.distance),
    };
  }

  private findNearestCentroid(vec: Float32Array): number {
    let bestIdx = 0;
    let bestSim = -Infinity;
    for (let i = 0; i < this.centroids.length; i++) {
      const sim = cosineSimilarity(vec, this.centroids[i]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * k-means++ initialization: pick centroids that are well spread out.
   */
  private initCentroids(allVectors: Array<[number, Float32Array]>): Float32Array[] {
    const centroids: Float32Array[] = [];
    const n = allVectors.length;

    // Pick first centroid randomly
    const firstIdx = Math.floor(Math.random() * n);
    centroids.push(new Float32Array(allVectors[firstIdx]![1]));

    for (let c = 1; c < this.nClusters; c++) {
      // Compute distances to nearest centroid for each point
      const distances = new Float64Array(n);
      let totalDist = 0;

      for (let i = 0; i < n; i++) {
        let minDist = Infinity;
        for (const centroid of centroids) {
          const dist = 1 - cosineSimilarity(allVectors[i]![1], centroid);
          if (dist < minDist) minDist = dist;
        }
        distances[i] = minDist * minDist; // Square for weighted probability
        totalDist += distances[i]!;
      }

      // Pick next centroid proportional to squared distance
      let target = Math.random() * totalDist;
      let picked = 0;
      for (let i = 0; i < n; i++) {
        target -= distances[i]!;
        if (target <= 0) {
          picked = i;
          break;
        }
      }
      centroids.push(new Float32Array(allVectors[picked]![1]));
    }

    return centroids;
  }
}
