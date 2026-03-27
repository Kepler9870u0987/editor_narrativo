import { describe, it, expect } from 'vitest';
import { chunkText, normalizeVector, cosineSimilarity } from '../src/embedding-service.js';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const result = chunkText('Hello world', 8192);
    expect(result).toEqual(['Hello world']);
  });

  it('splits long text into overlapping chunks', () => {
    // Create a text with 100 words
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`);
    const text = words.join(' ');

    // With very small maxTokens to force chunking
    const chunks = chunkText(text, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);

    // Verify overlap: end of chunk N should overlap with start of chunk N+1
    if (chunks.length >= 2) {
      const words0 = chunks[0]!.split(' ');
      const words1 = chunks[1]!.split(' ');
      // Last words of chunk 0 should appear in chunk 1
      const lastWordsOf0 = words0.slice(-5);
      const firstWordsOf1 = words1.slice(0, 10);
      const overlap = lastWordsOf0.filter((w) => firstWordsOf1.includes(w));
      expect(overlap.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeVector', () => {
  it('normalizes to unit length', () => {
    const vec = new Float32Array([3, 4]);
    const norm = normalizeVector(vec);
    const length = Math.sqrt(norm[0]! ** 2 + norm[1]! ** 2);
    expect(length).toBeCloseTo(1.0, 5);
  });

  it('handles zero vector', () => {
    const vec = new Float32Array([0, 0, 0]);
    const norm = normalizeVector(vec);
    expect(norm).toEqual(new Float32Array([0, 0, 0]));
  });
});

describe('cosineSimilarity', () => {
  it('identical normalized vectors have similarity 1', () => {
    const a = normalizeVector(new Float32Array([1, 2, 3]));
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5);
  });

  it('orthogonal vectors have similarity 0', () => {
    const a = normalizeVector(new Float32Array([1, 0]));
    const b = normalizeVector(new Float32Array([0, 1]));
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('opposite vectors have similarity -1', () => {
    const a = normalizeVector(new Float32Array([1, 0]));
    const b = normalizeVector(new Float32Array([-1, 0]));
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => cosineSimilarity(a, b)).toThrow('dimension mismatch');
  });
});
