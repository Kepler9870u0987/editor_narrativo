/**
 * OnnxEmbeddingModel — Concrete EmbeddingModel implementation that
 * delegates ONNX inference to a dedicated Web Worker (rag-worker).
 *
 * Communicates via typed postMessage with request/response tracking.
 * Supports WebGPU acceleration with WASM fallback.
 */

import type { EmbeddingModel, EmbeddingModelConfig } from '@editor-narrativo/rag';

interface WorkerResponse {
  type: 'INIT_DONE' | 'EMBED_DONE' | 'ERROR';
  id: string;
  dim?: number;
  vectors?: ArrayBuffer[];
  message?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class OnnxEmbeddingModel implements EmbeddingModel {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private initialized = false;
  private _dim: number;
  private _maxTokens: number;
  private config: EmbeddingModelConfig;

  constructor(config: EmbeddingModelConfig) {
    this.config = config;
    this._dim = config.dim;
    this._maxTokens = config.maxTokens;
  }

  get dim(): number {
    return this._dim;
  }

  get maxTokens(): number {
    return this._maxTokens;
  }

  /**
   * Initialize the worker and load the ONNX model.
   * Must be called before embed(). Safe to call multiple times.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.worker = new Worker(
      new URL('../workers/rag-worker.ts', import.meta.url),
      { type: 'module' },
    );

    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);

      if (response.type === 'ERROR') {
        pending.reject(new Error(response.message ?? 'Worker error'));
      } else {
        pending.resolve(response);
      }
    });

    this.worker.addEventListener('error', (event) => {
      // Reject all pending on worker crash
      for (const [id, pending] of this.pending) {
        pending.reject(new Error(event.message || 'RAG worker crashed'));
        this.pending.delete(id);
      }
    });

    const result = await this.request<{ dim: number }>({
      type: 'INIT',
      modelPath: this.config.modelPath,
      executionProviders: this.config.executionProviders,
    });

    this._dim = result.dim;
    this.initialized = true;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.initialized || !this.worker) {
      await this.init();
    }

    const result = await this.request<{ vectors: ArrayBuffer[] }>({
      type: 'EMBED',
      texts,
    });

    return result.vectors.map((buffer) => new Float32Array(buffer));
  }

  terminate(): void {
    for (const [, pending] of this.pending) {
      pending.reject(new Error('OnnxEmbeddingModel terminated'));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.initialized = false;
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...payload, id });
    });
  }
}

/**
 * Default config for nomic-embed-text-v1.5, quantized ONNX.
 * The modelPath should point to the ONNX file served from /public or a CDN.
 */
export function defaultOnnxEmbeddingConfig(
  modelPath = '/models/nomic-embed-text-v1.5-q4.onnx',
): EmbeddingModelConfig {
  return {
    modelPath,
    executionProviders: ['webgpu', 'wasm'],
    dim: 768,
    maxTokens: 8192,
  };
}
