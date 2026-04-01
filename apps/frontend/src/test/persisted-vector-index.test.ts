import { describe, it, expect, beforeEach } from 'vitest';
import { PersistedVectorIndex } from '../lib/persisted-vector-index';
import { editorDb } from '../lib/storage';
import type { HNSWConfig } from '@editor-narrativo/shared';

const DIM = 4;
const testConfig: HNSWConfig = {
  space: 'cosine',
  dim: DIM,
  maxElements: 100,
  M: 16,
  efConstruction: 200,
};

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('PersistedVectorIndex', () => {
  beforeEach(async () => {
    // Clear all previous data
    await editorDb.vectors.clear();
  });

  it('init sets dimension and clears state', async () => {
    const index = new PersistedVectorIndex('doc-1');
    await index.init(testConfig);
    expect(index.dimension).toBe(DIM);
    expect(index.size).toBe(0);
  });

  it('addVectorWithKey stores and searches vectors', async () => {
    const index = new PersistedVectorIndex('doc-1');
    await index.init(testConfig);

    const v1 = vec(1, 0, 0, 0);
    const v2 = vec(0, 1, 0, 0);
    await index.addVectorWithKey('block-a:0', v1, 'First block text');
    await index.addVectorWithKey('block-b:0', v2, 'Second block text');

    expect(index.size).toBe(2);

    // Search for something similar to v1
    const query = vec(0.9, 0.1, 0, 0);
    const result = await index.search(query, 2);

    expect(result.ids).toHaveLength(2);
    // The first result should be closest to the query (v1)
    expect(result.distances[0]).toBeLessThan(result.distances[1]!);
  });

  it('searchWithText returns text and blockId', async () => {
    const index = new PersistedVectorIndex('doc-1');
    await index.init(testConfig);

    await index.addVectorWithKey('block-x:0', vec(1, 0, 0, 0), 'Testo del blocco X');
    await index.addVectorWithKey('block-y:0', vec(0, 1, 0, 0), 'Testo del blocco Y');

    const entries = await index.searchWithText(vec(1, 0, 0, 0), 2, 0.5);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.text).toBe('Testo del blocco X');
    expect(entries[0]!.blockId).toBe('block-x');
  });

  it('persists to IndexedDB and reloads', async () => {
    const index1 = new PersistedVectorIndex('doc-persist');
    await index1.init(testConfig);
    await index1.addVectorWithKey('b1:0', vec(1, 0, 0, 0), 'Persisted text');
    expect(index1.size).toBe(1);

    // Create a new index and load from DB
    const index2 = new PersistedVectorIndex('doc-persist');
    await index2.init(testConfig);
    expect(index2.size).toBe(0);

    await index2.load();
    expect(index2.size).toBe(1);

    const entries = await index2.searchWithText(vec(1, 0, 0, 0), 1, 0.5);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe('Persisted text');
  });

  it('removeBlockVectors removes all block vectors', async () => {
    const index = new PersistedVectorIndex('doc-remove');
    await index.init(testConfig);

    await index.addVectorWithKey('block-rm:0', vec(1, 0, 0, 0), 'Chunk 0');
    await index.addVectorWithKey('block-rm:1', vec(0, 1, 0, 0), 'Chunk 1');
    await index.addVectorWithKey('other:0', vec(0, 0, 1, 0), 'Other block');

    expect(index.size).toBe(3);

    await index.removeBlockVectors('block-rm');
    expect(index.size).toBe(1);

    // Verify DB also cleaned up
    const records = await editorDb.vectors
      .where('blockId')
      .equals('block-rm')
      .count();
    expect(records).toBe(0);
  });

  it('clear removes all vectors for the document', async () => {
    const index = new PersistedVectorIndex('doc-clear');
    await index.init(testConfig);

    await index.addVectorWithKey('b1:0', vec(1, 0, 0, 0), 'Text 1');
    await index.addVectorWithKey('b2:0', vec(0, 1, 0, 0), 'Text 2');
    expect(index.size).toBe(2);

    await index.clear();
    expect(index.size).toBe(0);

    const count = await editorDb.vectors
      .where('documentId')
      .equals('doc-clear')
      .count();
    expect(count).toBe(0);
  });

  it('throws on dimension mismatch', async () => {
    const index = new PersistedVectorIndex('doc-err');
    await index.init(testConfig);

    await expect(
      index.addVector(0, new Float32Array([1, 2, 3])),
    ).rejects.toThrow('dimension mismatch');
  });
});
