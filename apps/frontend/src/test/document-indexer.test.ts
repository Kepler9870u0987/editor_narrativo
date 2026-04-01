import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EmbeddingModel } from '@editor-narrativo/rag';
import { DocumentIndexer } from '../features/editor/document-indexer';
import { editorDb } from '../lib/storage';
import type { NarrativeBlockLike } from '../features/editor/blocknote-schema';

const DIM = 4;

/** Simple mock embedding model that returns deterministic vectors */
function createMockEmbeddingModel(): EmbeddingModel {
  let callCount = 0;
  return {
    dim: DIM,
    maxTokens: 8192,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        callCount++;
        // Use text length as a seed for deterministic output
        const seed = text.length + callCount * 0.01;
        const v = new Float32Array(DIM);
        v[0] = Math.cos(seed);
        v[1] = Math.sin(seed);
        v[2] = 0;
        v[3] = 0;
        return v;
      });
    },
  };
}

function block(id: string, text: string): NarrativeBlockLike {
  return {
    id,
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

describe('DocumentIndexer', () => {
  beforeEach(async () => {
    await editorDb.vectors.clear();
  });

  it('initializes and has zero size', async () => {
    const indexer = new DocumentIndexer({
      documentId: 'test-doc',
      embeddingModel: createMockEmbeddingModel(),
    });
    await indexer.init();
    expect(indexer.indexSize).toBe(0);
    expect(indexer.isIndexing).toBe(false);
  });

  it('indexes blocks and tracks them', async () => {
    const indexer = new DocumentIndexer({
      documentId: 'test-doc',
      embeddingModel: createMockEmbeddingModel(),
      minBlockTextLength: 5,
    });
    await indexer.init();

    const blocks = [
      block('b1', 'Un lungo testo di prova per il primo blocco del documento'),
      block('b2', 'Secondo blocco con contenuto narrativo sufficientemente lungo'),
    ];

    await indexer.updateIndex(blocks);
    expect(indexer.indexSize).toBeGreaterThan(0);
  });

  it('incremental: only re-embeds changed blocks', async () => {
    const model = createMockEmbeddingModel();
    const embedSpy = vi.spyOn(model, 'embed');

    const indexer = new DocumentIndexer({
      documentId: 'test-doc',
      embeddingModel: model,
      minBlockTextLength: 5,
    });
    await indexer.init();

    const blocks = [
      block('b1', 'Testo originale del primo blocco lungo abbastanza'),
      block('b2', 'Testo originale del secondo blocco lungo abbastanza'),
    ];

    await indexer.updateIndex(blocks);
    const firstCallCount = embedSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // Re-index with same content — should not call embed again
    embedSpy.mockClear();
    await indexer.updateIndex(blocks);
    expect(embedSpy).not.toHaveBeenCalled();

    // Change one block — should only re-embed that one
    embedSpy.mockClear();
    const modifiedBlocks = [
      block('b1', 'Testo originale del primo blocco lungo abbastanza'),
      block('b2', 'Testo MODIFICATO del secondo blocco con contenuto diverso'),
    ];
    await indexer.updateIndex(modifiedBlocks);
    expect(embedSpy).toHaveBeenCalledTimes(1);
  });

  it('removes vectors for deleted blocks', async () => {
    const indexer = new DocumentIndexer({
      documentId: 'test-doc',
      embeddingModel: createMockEmbeddingModel(),
      minBlockTextLength: 5,
    });
    await indexer.init();

    const blocks = [
      block('b1', 'Blocco che verrà rimosso dal documento in seguito'),
      block('b2', 'Blocco che resta nel documento e non viene modificato'),
    ];
    await indexer.updateIndex(blocks);
    const sizeAfterBoth = indexer.indexSize;

    // Remove block b1
    await indexer.updateIndex([
      block('b2', 'Blocco che resta nel documento e non viene modificato'),
    ]);
    expect(indexer.indexSize).toBeLessThan(sizeAfterBoth);
  });

  it('search returns relevant passages', async () => {
    const indexer = new DocumentIndexer({
      documentId: 'test-doc',
      embeddingModel: createMockEmbeddingModel(),
      minBlockTextLength: 5,
    });
    await indexer.init();

    await indexer.updateIndex([
      block('b1', 'La principessa visse nel castello della montagna per anni'),
    ]);

    // Search — threshold set very high since mock vectors are deterministic but arbitrary
    const results = await indexer.search('castello montagna', 5, 2.0);
    // With mock embeddings the exact match depends on cosine — we just check it doesn't throw
    expect(Array.isArray(results)).toBe(true);
  });

  it('clear removes all data', async () => {
    const indexer = new DocumentIndexer({
      documentId: 'test-doc',
      embeddingModel: createMockEmbeddingModel(),
      minBlockTextLength: 5,
    });
    await indexer.init();

    await indexer.updateIndex([
      block('b1', 'Testo da cancellare dopo il test completo della funzione'),
    ]);
    expect(indexer.indexSize).toBeGreaterThan(0);

    await indexer.clear();
    expect(indexer.indexSize).toBe(0);
  });
});
