import { describe, it, expect } from 'vitest';
import { BruteForceIndex, defaultHNSWConfig } from '../src/vector-index.js';
import { normalizeVector } from '../src/embedding-service.js';

describe('BruteForceIndex', () => {
  const dim = 4;
  const config = { ...defaultHNSWConfig(dim), dim };

  function randVec(): Float32Array {
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) v[i] = Math.random() - 0.5;
    return normalizeVector(v);
  }

  it('initializes and reports size 0', async () => {
    const idx = new BruteForceIndex();
    await idx.init(config);
    expect(idx.size).toBe(0);
  });

  it('adds vectors and searches correctly', async () => {
    const idx = new BruteForceIndex();
    await idx.init(config);

    const v0 = normalizeVector(new Float32Array([1, 0, 0, 0]));
    const v1 = normalizeVector(new Float32Array([0, 1, 0, 0]));
    const v2 = normalizeVector(new Float32Array([0.9, 0.1, 0, 0]));

    await idx.addVector(0, v0);
    await idx.addVector(1, v1);
    await idx.addVector(2, v2);

    expect(idx.size).toBe(3);

    // Search for something close to v0
    const query = normalizeVector(new Float32Array([0.95, 0.05, 0, 0]));
    const result = await idx.search(query, 2);

    expect(result.ids.length).toBe(2);
    // v2 and v0 should be the closest
    expect(result.ids).toContain(0);
    expect(result.ids).toContain(2);
    // Distances should be sorted ascending
    expect(result.distances[0]).toBeLessThanOrEqual(result.distances[1]!);
  });

  it('removes vectors', async () => {
    const idx = new BruteForceIndex();
    await idx.init(config);

    await idx.addVector(0, randVec());
    await idx.addVector(1, randVec());
    expect(idx.size).toBe(2);

    await idx.removeVector(0);
    expect(idx.size).toBe(1);
  });

  it('throws on dimension mismatch', async () => {
    const idx = new BruteForceIndex();
    await idx.init(config);

    const wrongDim = new Float32Array(dim + 1);
    await expect(idx.addVector(0, wrongDim)).rejects.toThrow('dimension mismatch');
  });

  it('search returns up to k results', async () => {
    const idx = new BruteForceIndex();
    await idx.init(config);

    for (let i = 0; i < 20; i++) {
      await idx.addVector(i, randVec());
    }

    const result = await idx.search(randVec(), 5);
    expect(result.ids.length).toBe(5);
  });
});
