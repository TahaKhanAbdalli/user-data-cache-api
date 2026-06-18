import { describe, expect, it } from 'vitest';
import { LruCache } from '../src/lib/lru-cache';

/**
 * A controllable clock so TTL behaviour is deterministic and fast to test
 * (no real timers, no sleeping).
 */
function makeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('LruCache', () => {
  it('returns undefined and counts a miss for an unknown key', () => {
    const cache = new LruCache<number>({ maxEntries: 3, ttlMs: 1000 });
    expect(cache.get('nope')).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().hits).toBe(0);
  });

  it('returns a stored value and counts a hit', () => {
    const cache = new LruCache<number>({ maxEntries: 3, ttlMs: 1000 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(0);
    expect(cache.size).toBe(1);
  });

  it('evicts the least-recently-used entry when capacity is exceeded', () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // 'a' is the LRU and should be evicted
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.stats().evictions).toBe(1);
  });

  it('treats a get as a use, so recency order updates', () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // 'a' is now most-recently-used
    cache.set('c', 3); // 'b' is now the LRU and should be evicted
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('updates an existing key in place without growing the size', () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('a', 99);
    expect(cache.get('a')).toBe(99);
    expect(cache.size).toBe(1);
  });

  it('expires an entry after its TTL elapses (lazy expiry on read)', () => {
    const clock = makeClock();
    const cache = new LruCache<number>({ maxEntries: 3, ttlMs: 1000, now: clock.now });
    cache.set('a', 1);
    clock.advance(999);
    expect(cache.get('a')).toBe(1); // still fresh
    clock.advance(2); // now 1001ms old -> expired
    expect(cache.get('a')).toBeUndefined();
    expect(cache.stats().expirations).toBe(1);
    expect(cache.size).toBe(0);
  });

  it('sweepExpired removes all stale entries and reports the count', () => {
    const clock = makeClock();
    const cache = new LruCache<number>({ maxEntries: 5, ttlMs: 1000, now: clock.now });
    cache.set('a', 1);
    cache.set('b', 2);
    clock.advance(500);
    cache.set('c', 3); // newer than a, b
    clock.advance(600); // a, b are 1100ms old (expired); c is 600ms old (fresh)
    const removed = cache.sweepExpired();
    expect(removed).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.has('c')).toBe(true);
    expect(cache.stats().expirations).toBe(2);
  });

  it('has() peeks without affecting hit/miss statistics', () => {
    const cache = new LruCache<number>({ maxEntries: 3, ttlMs: 1000 });
    cache.set('a', 1);
    cache.has('a');
    cache.has('missing');
    expect(cache.stats().hits).toBe(0);
    expect(cache.stats().misses).toBe(0);
  });

  it('delete removes an entry and reports whether it existed', () => {
    const cache = new LruCache<number>({ maxEntries: 3, ttlMs: 1000 });
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('clear empties entries but preserves cumulative statistics', () => {
    const cache = new LruCache<number>({ maxEntries: 3, ttlMs: 1000 });
    cache.set('a', 1);
    cache.get('a');
    cache.get('missing');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2); // one from before clear, one after
  });

  it('rejects an invalid capacity', () => {
    expect(() => new LruCache<number>({ maxEntries: 0, ttlMs: 1000 })).toThrow();
  });
});
