/**
 * WorkerPool — manages a pool of Web Workers for off-main-thread computation.
 *
 * Provides typed message passing and automatic queue-based scheduling.
 * Workers are reused and tasks are dispatched round-robin.
 */

export interface WorkerTask<TReq, TRes> {
  request: TReq;
  resolve: (result: TRes) => void;
  reject: (error: Error) => void;
}

export class WorkerPool<TReq = unknown, TRes = unknown> {
  private workers: Worker[] = [];
  private queue: WorkerTask<TReq, TRes>[] = [];
  private busyFlags: boolean[] = [];
  private readonly size: number;

  /**
   * @param workerUrl URL/path of the worker script
   * @param size Number of workers (defaults to hardwareConcurrency - 1, min 1, max 4)
   */
  constructor(workerUrl: URL, size?: number) {
    const maxConcurrency =
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2;
    this.size = size ?? Math.min(4, Math.max(1, maxConcurrency - 1));

    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(workerUrl, { type: 'module' });
      this.workers.push(worker);
      this.busyFlags.push(false);
    }
  }

  /**
   * Execute a task on the next available worker. Queues if all are busy.
   */
  execute(request: TReq): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
      const task: WorkerTask<TReq, TRes> = { request, resolve, reject };
      const freeIdx = this.busyFlags.indexOf(false);

      if (freeIdx !== -1) {
        this.dispatch(freeIdx, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  private dispatch(workerIdx: number, task: WorkerTask<TReq, TRes>): void {
    this.busyFlags[workerIdx] = true;
    const worker = this.workers[workerIdx]!;

    const handleMessage = (e: MessageEvent<TRes>) => {
      cleanup();
      this.busyFlags[workerIdx] = false;
      task.resolve(e.data);
      this.processQueue();
    };

    const handleError = (e: ErrorEvent) => {
      cleanup();
      this.busyFlags[workerIdx] = false;
      task.reject(new Error(e.message));
      this.processQueue();
    };

    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage(task.request);
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;
    const freeIdx = this.busyFlags.indexOf(false);
    if (freeIdx !== -1) {
      const next = this.queue.shift()!;
      this.dispatch(freeIdx, next);
    }
  }

  /** Terminate all workers */
  terminate(): void {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.busyFlags = [];

    // Reject pending tasks
    for (const task of this.queue) {
      task.reject(new Error('WorkerPool terminated'));
    }
    this.queue = [];
  }

  get poolSize(): number {
    return this.size;
  }

  get pendingTasks(): number {
    return this.queue.length;
  }

  get busyWorkers(): number {
    return this.busyFlags.filter(Boolean).length;
  }
}
