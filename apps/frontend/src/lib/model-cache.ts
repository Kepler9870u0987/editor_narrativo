/**
 * ModelCache — Download and cache ONNX models using the browser Cache API.
 *
 * Flow:
 * 1. Check if the model already exists in the Cache API (keyed by URL).
 * 2. If cached, return the local blob URL.
 * 3. If not cached, download with progress callback, store in cache, return blob URL.
 *
 * The blob URL can be passed to ort.InferenceSession.create().
 */

const CACHE_NAME = 'onnx-models-v1';

export interface DownloadProgress {
  loaded: number;
  total: number;
  /** 0..1 */
  progress: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

/**
 * Get a model URL, downloading and caching if necessary.
 *
 * @param modelUrl The URL to the ONNX model (e.g. "/models/nomic-embed-text-v1.5-q4.onnx")
 * @param onProgress Optional callback for download progress
 * @returns A blob URL that can be used with ort.InferenceSession.create()
 */
export async function getOrDownloadModel(
  modelUrl: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  // Check if Cache API is available
  if (typeof caches === 'undefined') {
    // Fallback: return the original URL (no caching)
    return modelUrl;
  }

  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(modelUrl);

  if (cached) {
    const blob = await cached.blob();
    return URL.createObjectURL(blob);
  }

  // Download with progress tracking
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body || !total) {
    // No streaming support or unknown size — just download directly
    const blob = await response.blob();
    const cacheResponse = new Response(blob, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    await cache.put(modelUrl, cacheResponse);
    onProgress?.({ loaded: blob.size, total: blob.size, progress: 1 });
    return URL.createObjectURL(blob);
  }

  // Stream download with progress
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, progress: loaded / total });
  }

  const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
  const cacheResponse = new Response(blob.slice(0), {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  await cache.put(modelUrl, cacheResponse);
  onProgress?.({ loaded, total, progress: 1 });

  return URL.createObjectURL(blob);
}

/**
 * Remove a specific model from the cache.
 */
export async function removeModelFromCache(modelUrl: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open(CACHE_NAME);
  return cache.delete(modelUrl);
}

/**
 * Clear all cached models.
 */
export async function clearModelCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  return caches.delete(CACHE_NAME);
}
