import { describe, it, expect, beforeEach } from 'vitest';
import { IVFIndex } from '../src/ivf-index.js';
import type { HNSWConfig } from '@editor-narrativo/shared';

function randomVec(dim: number): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() - 0.5;
    norm += v[i]! * v[i]!;
  }
  // L2 normalize
  const invNorm = 1 / Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i]! *= invNorm;
  return v;
}

function makeConfig(dim: number): HNSWConfig {
  return { space: 'cosine', dim, maxElements: 100_000, m: 16, efConstruction: 200 };
}

describe('IVFIndex', () => {
  let idx: IVFIndex;
  const dim = 32; // small dim for fast tests

  beforeEach(async () => {
    idx = new IVFIndex({ nClusters: 4, nProbe: 2 });
    await idx.init(makeConfig(dim));
  });

  it('should start with size 0', () => {
    expect(idx.size).toBe(0);
  });

  it('should add and count vectors', async () => {
    await idx.addVector(1, randomVec(dim));
    await idx.addVector(2, randomVec(dim));
    expect(idx.size).toBe(2);
  });

  it('should remove vectors', async () => {
    await idx.addVector(1, randomVec(dim));
    await idx.addVector(2, randomVec(dim));
    await idx.removeVector(1);
    expect(idx.size).toBe(1);
  });

  it('should reject dimension mismatch on add', async () => {
    await expect(idx.addVector(1, new Float32Array(dim + 1))).rejects.toThrow('dimension mismatch');
  });

  it('should reject dimension mismatch on search', async () => {
    await expect(idx.search(new Float32Array(dim + 1), 5)).rejects.toThrow('dimension mismatch');
  });

  it('should find the exact vector as top-1 result (brute-force fallback for small n)', async () => {
    const target = randomVec(dim);
    await idx.addVector(10, target);
    await idx.addVector(20, randomVec(dim));

    const result = await idx.search(target, 1);
    expect(result.ids).toEqual([10]);
    expect(result.distances[0]).toBeCloseTo(0, 4);
  });

  it('should return at most k results', async () => {
    for (let i = 0; i < 5; i++) {
      await idx.addVector(i, randomVec(dim));
    }
    const result = await idx.search(randomVec(dim), 3);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.distances.length).toBeLessThanOrEqual(3);
  });

  describe('with clustering', () => {
    const n = 100; // enough to trigger clustering (nClusters*2 = 8)
    let targetVec: Float32Array;

    beforeEach(async () => {
      targetVec = randomVec(dim);
      await idx.addVector(0, targetVec);
      for (let i = 1; i < n; i++) {
        await idx.addVector(i, randomVec(dim));
      }
    });

    it('should build index and find the target vector', async () => {
      // First search triggers buildIndex
      const result = await idx.search(targetVec, 5);
      // The exact vector should be in the top-5 with distance ~0
      expect(result.ids).toContain(0);
      const targetIdx = result.ids.indexOf(0);
      expect(result.distances[targetIdx]).toBeCloseTo(0, 3);
    });

    it('should return results sorted by ascending distance', async () => {
      const result = await idx.search(randomVec(dim), 10);
      for (let i = 1; i < result.distances.length; i++) {
        expect(result.distances[i]!).toBeGreaterThanOrEqual(result.distances[i - 1]!);
      }
    });

    it('should handle removal after clustering', async () => {
      // Trigger clustering
      await idx.search(randomVec(dim), 1);
      // Remove half
      for (let i = 0; i < 50; i++) {
        await idx.removeVector(i);
      }
      expect(idx.size).toBe(50);
      const result = await idx.search(randomVec(dim), 5);
      expect(result.ids.length).toBeLessThanOrEqual(5);
      // None of the removed IDs should appear
      for (const id of result.ids) {
        expect(id).toBeGreaterThanOrEqual(50);
      }
    });
  });

  it('buildIndex should be callable explicitly', async () => {
    for (let i = 0; i < 20; i++) {
      await idx.addVector(i, randomVec(dim));
    }
    // Should not throw
    idx.buildIndex();
    expect(idx.size).toBe(20);
  });
});
