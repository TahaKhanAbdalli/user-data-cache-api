import { describe, expect, it, vi } from 'vitest';
import { SingleFlight } from '../src/lib/single-flight';

/** A promise whose resolution we can trigger manually, to control timing. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  it('invokes the worker once for concurrent calls with the same key', async () => {
    const sf = new SingleFlight<string>();
    const d = deferred<string>();
    const worker = vi.fn(() => d.promise);

    const a = sf.do('user:1', worker);
    const b = sf.do('user:1', worker);
    const c = sf.do('user:1', worker);

    expect(worker).toHaveBeenCalledTimes(1);
    expect(sf.inFlightCount).toBe(1);

    d.resolve('payload');
    await expect(Promise.all([a, b, c])).resolves.toEqual(['payload', 'payload', 'payload']);
    expect(sf.inFlightCount).toBe(0);
  });

  it('runs different keys independently', async () => {
    const sf = new SingleFlight<string>();
    const worker = vi.fn((key: string) => Promise.resolve(`value:${key}`));

    const [one, two] = await Promise.all([
      sf.do('a', () => worker('a')),
      sf.do('b', () => worker('b')),
    ]);

    expect(one).toBe('value:a');
    expect(two).toBe('value:b');
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('re-invokes the worker for a fresh call after the previous one settled', async () => {
    const sf = new SingleFlight<number>();
    const worker = vi.fn(() => Promise.resolve(1));

    await sf.do('k', worker);
    await sf.do('k', worker);

    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('propagates a rejection to all waiters and clears the slot for retry', async () => {
    const sf = new SingleFlight<string>();
    const failing = deferred<string>();
    const worker = vi.fn(() => failing.promise);

    const a = sf.do('k', worker);
    const b = sf.do('k', worker);

    failing.reject(new Error('db down'));

    await expect(a).rejects.toThrow('db down');
    await expect(b).rejects.toThrow('db down');
    expect(sf.inFlightCount).toBe(0);

    // The failed key is no longer in-flight, so a retry runs the worker again.
    const ok = vi.fn(() => Promise.resolve('recovered'));
    await expect(sf.do('k', ok)).resolves.toBe('recovered');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('reports the number of distinct in-flight operations', async () => {
    const sf = new SingleFlight<string>();
    const d1 = deferred<string>();
    const d2 = deferred<string>();

    const a = sf.do('a', () => d1.promise);
    const b = sf.do('b', () => d2.promise);
    expect(sf.inFlightCount).toBe(2);

    d1.resolve('x');
    d2.resolve('y');
    await Promise.all([a, b]);
    expect(sf.inFlightCount).toBe(0);
  });
});
