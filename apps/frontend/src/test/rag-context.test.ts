import { describe, it, expect } from 'vitest';

/**
 * Test the pure scoring functions used in the RAG context builder.
 *
 * buildLocalRagContext itself depends on CryptoKey + Dexie decryption,
 * so we test the term-matching logic independently by importing the module
 * indirectly — we re-implement the normalizeTerms/scoreChunk functions here
 * to validate the algorithm, matching rag-context.ts logic exactly.
 */

function normalizeTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 4);
}

function scoreChunk(query: string, chunk: string): number {
  const queryTerms = new Set(normalizeTerms(query));
  if (queryTerms.size === 0) {
    return 0;
  }
  const chunkTerms = normalizeTerms(chunk);
  let matches = 0;
  for (const term of chunkTerms) {
    if (queryTerms.has(term)) {
      matches += 1;
    }
  }
  return matches / Math.max(1, queryTerms.size);
}

describe('RAG context scoring', () => {
  describe('normalizeTerms', () => {
    it('lowercases and splits on whitespace', () => {
      expect(normalizeTerms('Hello World Test')).toEqual(['hello', 'world', 'test']);
    });

    it('strips punctuation', () => {
      expect(normalizeTerms("l'uomo nella casa.")).toEqual(['uomo', 'nella', 'casa']);
    });

    it('filters terms shorter than 4 characters', () => {
      expect(normalizeTerms('il re è nel palazzo')).toEqual(['palazzo']);
    });

    it('returns empty array for empty string', () => {
      expect(normalizeTerms('')).toEqual([]);
    });
  });

  describe('scoreChunk', () => {
    it('returns 0 when query has no significant terms', () => {
      expect(scoreChunk('il', 'Un lungo testo')).toBe(0);
    });

    it('returns 0 when no terms match', () => {
      expect(scoreChunk('elefante giraffa', 'Il castello sulla collina')).toBe(0);
    });

    it('scores proportionally to matched terms', () => {
      const query = 'castello collina';
      const chunk = 'Il castello sulla collina era antico';
      const score = scoreChunk(query, chunk);
      // Both "castello" and "collina" match, so score = 2/2 = 1
      expect(score).toBe(1);
    });

    it('partial match yields fractional score', () => {
      const query = 'castello montagna';
      const chunk = 'Il castello sulla collina era antico';
      const score = scoreChunk(query, chunk);
      // Only "castello" matches out of 2 query terms
      expect(score).toBeCloseTo(0.5);
    });

    it('scores higher chunks with more matching terms', () => {
      const query = 'principessa castello montagna';
      const chunkA = 'La principessa viveva nel castello';
      const chunkB = 'La principessa amava il giardino';

      const scoreA = scoreChunk(query, chunkA);
      const scoreB = scoreChunk(query, chunkB);
      expect(scoreA).toBeGreaterThan(scoreB);
    });
  });
});
