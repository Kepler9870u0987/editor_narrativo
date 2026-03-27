/**
 * RAG Pipeline — Orchestrates the full RAG flow:
 * 1. Chunk the input text
 * 2. Generate embeddings
 * 3. Search the vector index
 * 4. Return relevant context passages
 */

import type { EmbeddingModel } from './embedding-service.js';
import { chunkText } from './embedding-service.js';
import type { VectorIndex } from './vector-index.js';

export interface RAGPipelineConfig {
  embeddingModel: EmbeddingModel;
  vectorIndex: VectorIndex;
  /** Number of results to return from similarity search */
  topK: number;
}

export interface IndexedDocument {
  id: number;
  text: string;
}

export class RAGPipeline {
  private config: RAGPipelineConfig;
  private documentStore = new Map<number, string>();
  private nextId = 0;

  constructor(config: RAGPipelineConfig) {
    this.config = config;
  }

  /**
   * Index a document: chunk, embed, and store in the vector index.
   * Returns the IDs of the stored vectors.
   */
  async indexDocument(text: string): Promise<number[]> {
    const chunks = chunkText(text, this.config.embeddingModel.maxTokens);
    const vectors = await this.config.embeddingModel.embed(chunks);

    const ids: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const id = this.nextId++;
      this.documentStore.set(id, chunks[i]!);
      await this.config.vectorIndex.addVector(id, vectors[i]!);
      ids.push(id);
    }

    return ids;
  }

  /**
   * Query: embed the query text, search the index, return top-K text passages.
   */
  async query(queryText: string): Promise<string[]> {
    const [queryVector] = await this.config.embeddingModel.embed([queryText]);
    if (!queryVector) return [];

    const results = await this.config.vectorIndex.search(
      queryVector,
      this.config.topK,
    );

    return results.ids
      .map((id) => this.documentStore.get(id))
      .filter((text): text is string => text !== undefined);
  }

  /**
   * Remove a document's vectors from the index.
   */
  async removeDocument(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.config.vectorIndex.removeVector(id);
      this.documentStore.delete(id);
    }
  }

  get indexedDocumentCount(): number {
    return this.documentStore.size;
  }
}
