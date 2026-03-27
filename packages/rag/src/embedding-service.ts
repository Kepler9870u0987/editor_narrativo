/**
 * EmbeddingService — Abstraction over ONNX Runtime Web for in-browser
 * semantic embedding using nomic-embed-text-v1.5.
 *
 * This module provides the interface and a concrete implementation
 * that will run inside a Web Worker with WebGPU acceleration.
 *
 * Runtime dependencies (onnxruntime-web, tokenizer) are injected at init
 * to keep this module testable without heavy WASM/GPU deps in unit tests.
 */

export interface EmbeddingModel {
  /** Run inference on tokenized inputs, returning normalized embedding vectors */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** Dimension of the output vectors */
  readonly dim: number;
  /** Maximum context window in tokens */
  readonly maxTokens: number;
}

export interface EmbeddingModelConfig {
  /** Path to the ONNX model file */
  modelPath: string;
  /** Execution providers in order of preference */
  executionProviders: string[];
  /** Embedding dimension (768 for nomic-embed-text-v1.5) */
  dim: number;
  /** Max tokens (8192 for nomic-embed-text-v1.5) */
  maxTokens: number;
}

/**
 * Chunk a long text into overlapping segments that fit within maxTokens.
 *
 * Uses a simple word-boundary split. The overlap ensures context continuity
 * at chunk boundaries.
 *
 * @param text Input text
 * @param maxTokens Approx max tokens per chunk (word ≈ 1.3 tokens)
 * @param overlapTokens Number of overlapping tokens between chunks
 * @returns Array of text chunks
 */
export function chunkText(
  text: string,
  maxTokens = 8192,
  overlapTokens = 200,
): string[] {
  // Rough estimate: 1 word ≈ 1.3 tokens
  const maxWords = Math.floor(maxTokens / 1.3);
  const overlapWords = Math.floor(overlapTokens / 1.3);

  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = end - overlapWords;
  }

  return chunks;
}

/**
 * Normalize a vector to unit length (L2 normalization).
 */
export function normalizeVector(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i]! * vec[i]!;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;

  const normalized = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    normalized[i] = vec[i]! / norm;
  }
  return normalized;
}

/**
 * Cosine similarity between two unit vectors.
 * If vectors are already L2-normalized, this is just the dot product.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}
