/**
 * Request coalescing ("single-flight").
 *
 * When several callers ask for the same key while a fetch is already running,
 * they all share the *one* in-flight promise instead of each triggering its own
 * expensive operation (e.g. a database read). This is the classic defence
 * against a cache stampede / thundering herd: the first caller does the work,
 * everyone else awaits the same result.
 *
 * The in-flight slot is cleared as soon as the promise settles — on success or
 * failure — so the next request starts fresh. Failures are deliberately *not*
 * cached: a transient error should not poison subsequent retries.
 */
export class SingleFlight<V> {
  private readonly inFlight = new Map<string, Promise<V>>();

  /** Number of distinct keys currently being fetched. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Runs `fn` for `key`, or joins the existing in-flight call if one is running.
   * All joiners resolve/reject with the same outcome as the single execution.
   */
  do(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }

    // Start the work, then always remove the slot once it settles. We attach the
    // cleanup before exposing the promise so a synchronous rejection still clears.
    const promise = (async () => fn())().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }
}
