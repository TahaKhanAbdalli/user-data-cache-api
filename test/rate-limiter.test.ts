import { beforeEach, describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/lib/rate-limiter';

/**
 * Small, clean numbers keep the windowing arithmetic obvious:
 *   - sustained: at most 4 requests per 1000ms
 *   - burst:     at most 2 requests per 100ms
 * (The production config of 10/60s + 5/10s is wired up and asserted in the
 * middleware/integration tests; here we exercise the algorithm itself.)
 */
const CONFIG = { windowMs: 1000, max: 4, burstWindowMs: 100, burstMax: 2 };

describe('SlidingWindowRateLimiter', () => {
  let clock: { now: number };
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    clock = { now: 0 };
    limiter = new SlidingWindowRateLimiter({ ...CONFIG, now: () => clock.now });
  });

  it('allows up to the burst capacity, then blocks inside the burst window', () => {
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(true);
    const third = limiter.check('ip');
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe('burst');
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it('blocks at the sustained maximum even when the burst window has room', () => {
    // Space requests 200ms apart so each sits alone in its 100ms burst window.
    for (const t of [0, 200, 400, 600]) {
      clock.now = t;
      expect(limiter.check('ip').allowed).toBe(true);
    }
    clock.now = 600;
    const blocked = limiter.check('ip'); // 5th within the 1000ms window
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('sustained');
  });

  it('allows again once the burst window slides forward', () => {
    limiter.check('ip');
    limiter.check('ip');
    expect(limiter.check('ip').allowed).toBe(false); // burst full at t=0

    clock.now = 100; // the two t=0 requests leave the 100ms burst window
    expect(limiter.check('ip').allowed).toBe(true);
  });

  it('reports a retryAfterMs that, once waited out, lets the request through', () => {
    limiter.check('ip');
    limiter.check('ip');
    const blocked = limiter.check('ip');
    expect(blocked.allowed).toBe(false);

    clock.now += blocked.retryAfterMs;
    expect(limiter.check('ip').allowed).toBe(true);
  });

  it('tracks each client key independently', () => {
    limiter.check('a');
    limiter.check('a');
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('reports remaining headroom as the tighter of the two windows', () => {
    const first = limiter.check('ip');
    // After 1 request: sustained leaves 3, burst leaves 1 -> tighter is 1.
    expect(first.remaining).toBe(1);
    expect(first.limit).toBe(4);
  });

  it('reset clears a single key history', () => {
    limiter.check('ip');
    limiter.check('ip');
    expect(limiter.check('ip').allowed).toBe(false);
    limiter.reset('ip');
    expect(limiter.check('ip').allowed).toBe(true);
  });

  it('prune drops keys with no activity in the longest window', () => {
    limiter.check('stale');
    clock.now = 1001; // beyond the 1000ms sustained window
    limiter.check('fresh');
    const removed = limiter.prune();
    expect(removed).toBe(1);
    expect(limiter.activeKeys).toBe(1); // only 'fresh' remains
  });
});
