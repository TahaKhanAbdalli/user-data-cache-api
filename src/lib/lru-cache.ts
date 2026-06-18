/**
 * A fixed-capacity, TTL-aware Least-Recently-Used cache.
 *
 * Design notes
 * ------------
 * - Recency is tracked using a native `Map`, which preserves insertion order.
 *   On every read/write of an existing key we delete and re-insert it so the
 *   most-recently-used key is always last; the LRU victim is therefore the
 *   first key returned by `map.keys()`. All operations are O(1) amortised.
 * - TTL is enforced lazily on read (an expired entry is dropped when accessed)
 *   and proactively via {@link LruCache.sweepExpired}, which a background task
 *   calls on an interval so memory does not grow with abandoned keys.
 * - The clock is injectable (`now`) to keep TTL behaviour deterministic in
 *   tests without real timers.
 */

export interface LruCacheOptions {
  /** Maximum number of entries before the least-recently-used one is evicted. */
  maxEntries: number;
  /** Time-to-live for each entry, in milliseconds. */
  ttlMs: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  /** Entries removed because the capacity was exceeded. */
  evictions: number;
  /** Entries removed because their TTL elapsed. */
  expirations: number;
}

interface Entry<V> {
  value: V;
  /** Wall-clock time (per the injected clock) at which this entry expires. */
  expiresAt: number;
}

export class LruCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expirations = 0;

  constructor(options: LruCacheOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new RangeError('LruCache: maxEntries must be a positive integer');
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new RangeError('LruCache: ttlMs must be a positive number');
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  /** Number of live entries currently held (may include not-yet-swept stale ones). */
  get size(): number {
    return this.store.size;
  }

  /**
   * Returns the value for `key`, or `undefined` if absent/expired.
   * Counts a hit or miss, refreshes recency on a hit, and drops expired entries.
   */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.expirations += 1;
      this.misses += 1;
      return undefined;
    }
    // Refresh recency: re-insert so this key becomes most-recently-used.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /**
   * Inserts or updates `key`. Updating an existing key refreshes both its value
   * and recency without growing the cache. Inserting past capacity evicts the LRU.
   */
  set(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    if (this.store.size > this.maxEntries) {
      this.evictLeastRecentlyUsed();
    }
  }

  /** Presence check that respects TTL but does not affect hit/miss statistics. */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (entry === undefined) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.expirations += 1;
      return false;
    }
    return true;
  }

  /** Removes `key`; returns whether it existed. */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Removes all entries. Cumulative statistics are preserved. */
  clear(): void {
    this.store.clear();
  }

  /**
   * Removes every expired entry. Intended to be driven by a background task.
   * Returns the number of entries removed.
   */
  sweepExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        this.expirations += 1;
        removed += 1;
      }
    }
    return removed;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }

  private isExpired(entry: Entry<V>): boolean {
    return entry.expiresAt <= this.now();
  }

  private evictLeastRecentlyUsed(): void {
    const lruKey = this.store.keys().next().value;
    if (lruKey !== undefined) {
      this.store.delete(lruKey);
      this.evictions += 1;
    }
  }
}
