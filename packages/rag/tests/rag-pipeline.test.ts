import { describe, it, expect } from 'vitest';
import { RAGPipeline } from '../src/rag-pipeline.js';
import { BruteForceIndex, defaultHNSWConfig } from '../src/vector-index.js';
import { normalizeVector, type EmbeddingModel } from '../src/embedding-service.js';

/**
 * Fake embedding model for testing:
 * Maps text to a simple hash-based vector for deterministic results.
 */
function createFakeEmbeddingModel(dim = 8): EmbeddingModel {
  return {
    dim,
    maxTokens: 8192,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const vec = new Float32Array(dim);
        for (let i = 0; i < text.length && i < dim; i++) {
          vec[i % dim] += text.charCodeAt(i) / 255;
        }
        return normalizeVector(vec);
      });
    },
  };
}

describe('RAGPipeline', () => {
  async function createPipeline() {
    const model = createFakeEmbeddingModel();
    const index = new BruteForceIndex();
    await index.init(defaultHNSWConfig(model.dim));

    const pipeline = new RAGPipeline({
      embeddingModel: model,
      vectorIndex: index,
      topK: 3,
    });

    return pipeline;
  }

  it('indexes a document and searches', async () => {
    const pipeline = await createPipeline();

    await pipeline.indexDocument('Marco entrò nella stanza buia.');
    await pipeline.indexDocument('Il castello si trovava in cima alla collina.');
    await pipeline.indexDocument('La spada era nascosta sotto il letto.');

    expect(pipeline.indexedDocumentCount).toBe(3);

    const results = await pipeline.query('Marco e la stanza');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('removes documents', async () => {
    const pipeline = await createPipeline();

    const ids = await pipeline.indexDocument('Testo da rimuovere');
    expect(pipeline.indexedDocumentCount).toBe(1);

    await pipeline.removeDocument(ids);
    expect(pipeline.indexedDocumentCount).toBe(0);
  });

  it('handles empty index query', async () => {
    const pipeline = await createPipeline();
    const results = await pipeline.query('qualsiasi cosa');
    expect(results).toEqual([]);
  });
});
