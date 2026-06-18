/**
 * Sliding-window rate limiter enforcing two limits at once.
 *
 * The assignment asks for "a maximum of 10 requests per minute, with a burst
 * capacity of 5 requests in a 10-second window". A single token bucket cannot
 * express both a hard per-minute ceiling *and* a tighter short-term burst cap
 * without drifting, so we enforce two sliding windows simultaneously:
 *
 *   - sustained: at most `max` requests in the trailing `windowMs`
 *   - burst:     at most `burstMax` requests in the trailing `burstWindowMs`
 *
 * A request is allowed only if it satisfies *both*. Per key we keep the
 * timestamps of recent allowed requests (ascending); each check prunes anything
 * older than the larger window, then counts within each window. This is exact
 * (no approximation) and `O(k)` in the number of recent requests per key.
 */

export interface RateLimiterOptions {
  /** Sustained window length in ms. */
  windowMs: number;
  /** Max allowed requests within the sustained window. */
  max: number;
  /** Burst window length in ms. */
  burstWindowMs: number;
  /** Max allowed requests within the burst window. */
  burstMax: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Headroom before the next block, as the tighter of the two windows. */
  remaining: number;
  /** Sustained limit, surfaced for `X-RateLimit-Limit` style headers. */
  limit: number;
  /** Milliseconds until the caller may retry (0 when allowed). */
  retryAfterMs: number;
  /** Which window blocked the request, when blocked. */
  reason?: 'sustained' | 'burst';
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly burstWindowMs: number;
  private readonly burstMax: number;
  private readonly now: () => number;
  private readonly longestWindowMs: number;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.burstWindowMs = options.burstWindowMs;
    this.burstMax = options.burstMax;
    this.now = options.now ?? Date.now;
    this.longestWindowMs = Math.max(this.windowMs, this.burstWindowMs);
  }

  /** Number of keys currently being tracked. */
  get activeKeys(): number {
    return this.hits.size;
  }

  /**
   * Evaluates a request for `key`. When allowed, the request is recorded.
   * When blocked, nothing is recorded and `retryAfterMs`/`reason` are populated.
   */
  check(key: string): RateLimitResult {
    const now = this.now();
    const timestamps = this.pruned(key, now);

    const sustainedCount = timestamps.length;
    const burstStart = now - this.burstWindowMs;
    const burstTimestamps = timestamps.filter((ts) => ts > burstStart);
    const burstCount = burstTimestamps.length;

    // Burst is the shorter, tighter window, so check it first.
    if (burstCount >= this.burstMax) {
      const oldestInBurst = burstTimestamps[0] ?? now;
      return this.blocked('burst', oldestInBurst + this.burstWindowMs - now);
    }
    if (sustainedCount >= this.max) {
      const oldestInWindow = timestamps[0] ?? now;
      return this.blocked('sustained', oldestInWindow + this.windowMs - now);
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    const remaining = Math.min(this.max - (sustainedCount + 1), this.burstMax - (burstCount + 1));
    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      limit: this.max,
      retryAfterMs: 0,
    };
  }

  /** Clears history for one key, or all keys when no key is given. */
  reset(key?: string): void {
    if (key === undefined) {
      this.hits.clear();
    } else {
      this.hits.delete(key);
    }
  }

  /**
   * Drops keys that have had no activity within the longest window. Intended to
   * be called periodically so memory does not grow with one-off clients.
   * Returns the number of keys removed.
   */
  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [key] of this.hits) {
      const remaining = this.pruned(key, now);
      if (remaining.length === 0) {
        this.hits.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Returns `key`'s timestamps with anything older than the longest window removed. */
  private pruned(key: string, now: number): number[] {
    const existing = this.hits.get(key) ?? [];
    const cutoff = now - this.longestWindowMs;
    const fresh = existing.filter((ts) => ts > cutoff);
    if (fresh.length !== existing.length) {
      this.hits.set(key, fresh);
    }
    return fresh;
  }

  private blocked(reason: 'sustained' | 'burst', retryAfterMs: number): RateLimitResult {
    return {
      allowed: false,
      remaining: 0,
      limit: this.max,
      retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)),
      reason,
    };
  }
}
