/**
 * DocumentIndexer — Incremental document indexing for the RAG pipeline.
 *
 * Tracks which blocks have changed (by UUID) and re-embeds only the
 * modified blocks, keeping the vector index in sync with the document.
 *
 * Integrates with:
 *   - OnnxEmbeddingModel for generating embeddings
 *   - PersistedVectorIndex for storage and search
 *   - BlockNote's block structure (NarrativeBlockLike)
 */

import { chunkText } from '@editor-narrativo/rag';
import type { EmbeddingModel } from '@editor-narrativo/rag';
import type { HNSWConfig } from '@editor-narrativo/shared';
import { HNSW_DEFAULTS } from '@editor-narrativo/shared';
import { PersistedVectorIndex } from '../../lib/persisted-vector-index';
import {
  blocksToPlainText,
  type NarrativeBlockLike,
} from './blocknote-schema';

/** Hash of block content for change detection */
function blockContentHash(block: NarrativeBlockLike): string {
  const content = readBlockText(block);
  // Simple fast hash for change detection
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function readBlockText(block: NarrativeBlockLike): string {
  const parts: string[] = [];

  // Props text (for characterSheet etc.)
  if (block.props) {
    for (const value of Object.values(block.props)) {
      if (typeof value === 'string' && value.length > 0) {
        parts.push(value);
      }
    }
  }

  // Inline content
  if (block.content) {
    if (typeof block.content === 'string') {
      parts.push(block.content);
    } else if (Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item.type === 'text' && typeof item.text === 'string') {
          parts.push(item.text);
        } else if (item.type === 'entityMention' && item.props) {
          const label = (item.props as Record<string, unknown>).label;
          if (typeof label === 'string') parts.push(label);
        }
      }
    }
  }

  // Children
  if (block.children?.length) {
    parts.push(blocksToPlainText(block.children));
  }

  return parts.join(' ');
}

export interface DocumentIndexerConfig {
  documentId: string;
  embeddingModel: EmbeddingModel;
  /** Max tokens per chunk (default 1200 for chapter-level) */
  chunkMaxTokens?: number;
  /** Overlap tokens between chunks (default 80) */
  chunkOverlapTokens?: number;
  /** Minimum text length to index a block (default 20 chars) */
  minBlockTextLength?: number;
}

export class DocumentIndexer {
  private vectorIndex: PersistedVectorIndex;
  private embeddingModel: EmbeddingModel;
  private documentId: string;
  private chunkMaxTokens: number;
  private chunkOverlapTokens: number;
  private minBlockTextLength: number;

  /** Tracks content hash per block ID for incremental updates */
  private blockHashes = new Map<string, string>();

  /** Whether the indexer is currently processing */
  private indexing = false;

  /** Pending re-index request (coalesced) */
  private pendingBlocks: NarrativeBlockLike[] | null = null;

  constructor(config: DocumentIndexerConfig) {
    this.documentId = config.documentId;
    this.embeddingModel = config.embeddingModel;
    this.chunkMaxTokens = config.chunkMaxTokens ?? 1200;
    this.chunkOverlapTokens = config.chunkOverlapTokens ?? 80;
    this.minBlockTextLength = config.minBlockTextLength ?? 20;

    this.vectorIndex = new PersistedVectorIndex(this.documentId);
  }

  /**
   * Initialize the index: load persisted vectors and set up dimensions.
   */
  async init(): Promise<void> {
    const config: HNSWConfig = {
      space: HNSW_DEFAULTS.SPACE,
      dim: this.embeddingModel.dim,
      maxElements: HNSW_DEFAULTS.MAX_ELEMENTS,
      M: HNSW_DEFAULTS.M,
      efConstruction: HNSW_DEFAULTS.EF_CONSTRUCTION,
    };
    await this.vectorIndex.init(config);
    await this.vectorIndex.load();
  }

  /**
   * Update the index with the current document blocks.
   * Only re-embeds blocks that have changed since last call.
   *
   * Uses debouncing: if called while already indexing, the latest
   * blocks are queued and processed when the current run finishes.
   */
  async updateIndex(blocks: NarrativeBlockLike[]): Promise<void> {
    if (this.indexing) {
      this.pendingBlocks = blocks;
      return;
    }

    this.indexing = true;
    try {
      await this.processBlocks(blocks);
    } finally {
      this.indexing = false;

      // Process any queued update
      if (this.pendingBlocks) {
        const queued = this.pendingBlocks;
        this.pendingBlocks = null;
        await this.updateIndex(queued);
      }
    }
  }

  /**
   * Search the index for the most relevant passages.
   */
  async search(
    queryText: string,
    topK = 6,
    threshold = 0.3,
  ): Promise<Array<{ text: string; distance: number; blockId: string }>> {
    const [queryVector] = await this.embeddingModel.embed([queryText]);
    if (!queryVector) return [];
    return this.vectorIndex.searchWithText(queryVector, topK, threshold);
  }

  /**
   * Clear all indexed data for this document.
   */
  async clear(): Promise<void> {
    this.blockHashes.clear();
    await this.vectorIndex.clear();
  }

  get indexSize(): number {
    return this.vectorIndex.size;
  }

  get isIndexing(): boolean {
    return this.indexing;
  }

  private async processBlocks(blocks: NarrativeBlockLike[]): Promise<void> {
    const currentBlockIds = new Set<string>();
    const changedBlocks: Array<{ id: string; text: string }> = [];

    // Flatten all blocks (including children) to find changes
    const flatBlocks = this.flattenBlocks(blocks);

    for (const block of flatBlocks) {
      const blockId = block.id;
      if (!blockId) continue;

      currentBlockIds.add(blockId);
      const text = readBlockText(block);

      if (text.length < this.minBlockTextLength) continue;

      const hash = blockContentHash(block);
      const previousHash = this.blockHashes.get(blockId);

      if (previousHash !== hash) {
        changedBlocks.push({ id: blockId, text });
        this.blockHashes.set(blockId, hash);
      }
    }

    // Remove vectors for deleted blocks
    const deletedBlockIds: string[] = [];
    for (const [blockId] of this.blockHashes) {
      if (!currentBlockIds.has(blockId)) {
        deletedBlockIds.push(blockId);
      }
    }
    for (const blockId of deletedBlockIds) {
      this.blockHashes.delete(blockId);
      await this.vectorIndex.removeBlockVectors(blockId);
    }

    // Re-embed changed blocks
    if (changedBlocks.length === 0) return;

    for (const { id: blockId, text } of changedBlocks) {
      // Remove old vectors for this block
      await this.vectorIndex.removeBlockVectors(blockId);

      // Chunk the text
      const chunks = chunkText(text, this.chunkMaxTokens, this.chunkOverlapTokens);

      // Embed all chunks for this block
      const vectors = await this.embeddingModel.embed(chunks);

      // Store each chunk vector
      for (let i = 0; i < chunks.length; i++) {
        const key = `${blockId}:${i}`;
        await this.vectorIndex.addVectorWithKey(key, vectors[i]!, chunks[i]!);
      }
    }
  }

  private flattenBlocks(blocks: NarrativeBlockLike[]): NarrativeBlockLike[] {
    const result: NarrativeBlockLike[] = [];
    for (const block of blocks) {
      result.push(block);
      if (block.children?.length) {
        result.push(...this.flattenBlocks(block.children));
      }
    }
    return result;
  }
}
