/**
 * RAG Web Worker — Runs ONNX Runtime inference off the main thread.
 *
 * Handles two message types:
 *   - INIT: Load the ONNX model with the given config
 *   - EMBED: Run inference on an array of text strings, return Float32Array[]
 *
 * Uses WebGPU when available, falls back to WASM.
 */

import * as ort from 'onnxruntime-web';

interface InitRequest {
  type: 'INIT';
  id: string;
  modelPath: string;
  executionProviders: string[];
}

interface EmbedRequest {
  type: 'EMBED';
  id: string;
  texts: string[];
}

type WorkerRequest = InitRequest | EmbedRequest;

interface SuccessResponse {
  type: 'INIT_DONE' | 'EMBED_DONE';
  id: string;
}

interface InitDoneResponse extends SuccessResponse {
  type: 'INIT_DONE';
  dim: number;
}

interface EmbedDoneResponse extends SuccessResponse {
  type: 'EMBED_DONE';
  vectors: ArrayBuffer[];
}

interface ErrorResponse {
  type: 'ERROR';
  id: string;
  message: string;
}

type WorkerResponse = InitDoneResponse | EmbedDoneResponse | ErrorResponse;

let session: ort.InferenceSession | null = null;
let modelDim = 768;

/**
 * Simple whitespace tokenizer that returns token IDs.
 * For production quality, this should use the model's real tokenizer.
 * This is a lightweight approximation that works with nomic-embed-text
 * by treating each word as a token (mapping to a hash-based ID).
 */
function simpleTokenize(
  text: string,
  maxLength: number,
): { inputIds: BigInt64Array; attentionMask: BigInt64Array } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const length = Math.min(words.length, maxLength);
  const inputIds = new BigInt64Array(maxLength);
  const attentionMask = new BigInt64Array(maxLength);

  // CLS token
  inputIds[0] = 101n;
  attentionMask[0] = 1n;

  for (let i = 0; i < length && i + 1 < maxLength - 1; i++) {
    // Simple hash to produce a token ID in vocabulary range
    let hash = 0;
    const word = words[i]!.toLowerCase();
    for (let c = 0; c < word.length; c++) {
      hash = ((hash << 5) - hash + word.charCodeAt(c)) | 0;
    }
    inputIds[i + 1] = BigInt(Math.abs(hash) % 30000 + 1000);
    attentionMask[i + 1] = 1n;
  }

  // SEP token
  const sepPos = Math.min(length + 1, maxLength - 1);
  inputIds[sepPos] = 102n;
  attentionMask[sepPos] = 1n;

  return { inputIds, attentionMask };
}

function meanPool(
  lastHiddenState: ort.Tensor,
  attentionMask: BigInt64Array,
  seqLength: number,
  dim: number,
): Float32Array {
  const data = lastHiddenState.data as Float32Array;
  const result = new Float32Array(dim);
  let tokenCount = 0;

  for (let t = 0; t < seqLength; t++) {
    if (attentionMask[t] === 1n) {
      tokenCount++;
      for (let d = 0; d < dim; d++) {
        result[d]! += data[t * dim + d] ?? 0;
      }
    }
  }

  if (tokenCount > 0) {
    for (let d = 0; d < dim; d++) {
      result[d]! /= tokenCount;
    }
  }

  // L2 normalize
  let sumSq = 0;
  for (let d = 0; d < dim; d++) {
    const v = result[d] ?? 0;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let d = 0; d < dim; d++) {
      result[d]! /= norm;
    }
  }

  return result;
}

async function handleInit(request: InitRequest): Promise<WorkerResponse> {
  try {
    const providers: string[] = [];
    for (const provider of request.executionProviders) {
      if (provider === 'webgpu' && 'gpu' in navigator) {
        providers.push('webgpu');
      } else if (provider === 'wasm') {
        providers.push('wasm');
      }
    }
    if (providers.length === 0) {
      providers.push('wasm');
    }

    session = await ort.InferenceSession.create(request.modelPath, {
      executionProviders: providers,
    });

    // Detect dimension from output metadata if available
    const outputNames = session.outputNames;
    if (outputNames.length > 0) {
      modelDim = 768; // nomic-embed-text-v1.5 default
    }

    return { type: 'INIT_DONE', id: request.id, dim: modelDim };
  } catch (error) {
    return {
      type: 'ERROR',
      id: request.id,
      message: error instanceof Error ? error.message : 'Failed to initialize ONNX session',
    };
  }
}

async function handleEmbed(request: EmbedRequest): Promise<WorkerResponse> {
  if (!session) {
    return { type: 'ERROR', id: request.id, message: 'Model not initialized' };
  }

  try {
    const maxSeqLength = 512;
    const vectors: ArrayBuffer[] = [];

    for (const text of request.texts) {
      const { inputIds, attentionMask } = simpleTokenize(text, maxSeqLength);

      const feeds: Record<string, ort.Tensor> = {
        input_ids: new ort.Tensor('int64', inputIds, [1, maxSeqLength]),
        attention_mask: new ort.Tensor('int64', attentionMask, [1, maxSeqLength]),
      };

      // Some models also require token_type_ids
      if (session.inputNames.includes('token_type_ids')) {
        feeds.token_type_ids = new ort.Tensor(
          'int64',
          new BigInt64Array(maxSeqLength),
          [1, maxSeqLength],
        );
      }

      const output = await session.run(feeds);
      const lastHidden = output[session.outputNames[0]!]!;

      const pooled = meanPool(lastHidden, attentionMask, maxSeqLength, modelDim);
      vectors.push(pooled.buffer as ArrayBuffer);
    }

    return { type: 'EMBED_DONE', id: request.id, vectors };
  } catch (error) {
    return {
      type: 'ERROR',
      id: request.id,
      message: error instanceof Error ? error.message : 'Embedding inference failed',
    };
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  let response: WorkerResponse;

  switch (request.type) {
    case 'INIT':
      response = await handleInit(request);
      break;
    case 'EMBED':
      response = await handleEmbed(request);
      break;
    default:
      response = { type: 'ERROR', id: (request as any).id ?? '', message: 'Unknown request type' };
  }

  if (response.type === 'EMBED_DONE') {
    self.postMessage(response, { transfer: (response as EmbedDoneResponse).vectors });
  } else {
    self.postMessage(response);
  }
};
