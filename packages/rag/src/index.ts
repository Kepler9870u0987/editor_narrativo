export { WorkerPool, type WorkerTask } from './worker-pool.js';
export {
  chunkText,
  normalizeVector,
  cosineSimilarity,
  type EmbeddingModel,
  type EmbeddingModelConfig,
} from './embedding-service.js';
export {
  BruteForceIndex,
  defaultHNSWConfig,
  type VectorIndex,
  type SearchResult,
} from './vector-index.js';
export { IVFIndex, type IVFConfig } from './ivf-index.js';
export { RAGPipeline, type RAGPipelineConfig, type IndexedDocument } from './rag-pipeline.js';
