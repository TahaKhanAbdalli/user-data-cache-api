/**
 * A bounded-concurrency async work queue.
 *
 * The assignment asks for an "asynchronous processing mechanism ... using a
 * queue (e.g. Bull or a simple array-based queue)" so the API can handle many
 * simultaneous requests without blocking. A distributed queue like Bull needs
 * Redis and persistence, which is overkill for a single-process simulation, so
 * we ship a self-contained in-memory queue (see the README trade-off note).
 *
 * It admits up to `concurrency` tasks at a time; further tasks wait FIFO for a
 * slot. `push` returns a promise tied to the task's outcome, and a rejected
 * task never stalls the queue — its slot is always released in a `finally`.
 */

export interface AsyncQueueOptions {
  /** Maximum number of tasks allowed to run simultaneously. */
  concurrency: number;
}

export class AsyncQueue {
  private readonly concurrency: number;
  private activeCount = 0;
  /** Resolvers for tasks waiting on a free slot, in FIFO order. */
  private readonly waiting: Array<() => void> = [];

  constructor(options: AsyncQueueOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new RangeError('AsyncQueue: concurrency must be a positive integer');
    }
    this.concurrency = options.concurrency;
  }

  /** Tasks currently executing (or holding a reserved slot). */
  get active(): number {
    return this.activeCount;
  }

  /** Tasks waiting for a free slot. */
  get size(): number {
    return this.waiting.length;
  }

  /** Total tasks not yet finished (running + waiting). */
  get pending(): number {
    return this.activeCount + this.waiting.length;
  }

  /** Enqueues `task`, resolving/rejecting with its result once it runs. */
  async push<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  /** Resolves immediately if a slot is free, otherwise queues for one. */
  private acquireSlot(): Promise<void> {
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  /** Frees a slot and promotes the next waiter, if any. */
  private releaseSlot(): void {
    this.activeCount -= 1;
    const next = this.waiting.shift();
    if (next !== undefined) {
      next();
    }
  }
}
