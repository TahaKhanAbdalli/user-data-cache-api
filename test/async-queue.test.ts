import { describe, expect, it } from 'vitest';
import { AsyncQueue } from '../src/lib/async-queue';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AsyncQueue', () => {
  it('runs tasks and resolves with their results', async () => {
    const queue = new AsyncQueue({ concurrency: 2 });
    const results = await Promise.all([
      queue.push(() => Promise.resolve(1)),
      queue.push(() => Promise.resolve(2)),
      queue.push(() => Promise.resolve(3)),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('never runs more tasks at once than the configured concurrency', async () => {
    const queue = new AsyncQueue({ concurrency: 2 });
    let running = 0;
    let maxRunning = 0;
    const gates = [deferred(), deferred(), deferred(), deferred()];

    const tasks = gates.map((g) => () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      return g.promise.finally(() => {
        running -= 1;
      });
    });
    const all = Promise.all(tasks.map((t) => queue.push(t)));

    await tick();
    expect(queue.active).toBe(2);
    expect(queue.size).toBe(2); // two waiting

    gates[0]!.resolve();
    gates[1]!.resolve();
    await tick();
    expect(queue.active).toBe(2); // the next two started

    gates[2]!.resolve();
    gates[3]!.resolve();
    await all;
    expect(maxRunning).toBe(2);
    expect(queue.pending).toBe(0);
  });

  it('isolates a failing task and keeps processing the rest', async () => {
    const queue = new AsyncQueue({ concurrency: 1 });
    const failed = queue.push(() => Promise.reject(new Error('boom')));
    const after = queue.push(() => Promise.resolve('ok'));

    await expect(failed).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
    expect(queue.pending).toBe(0);
  });

  it('processes far more tasks than the concurrency allows', async () => {
    const queue = new AsyncQueue({ concurrency: 3 });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => queue.push(() => Promise.resolve(i))),
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('rejects an invalid concurrency', () => {
    expect(() => new AsyncQueue({ concurrency: 0 })).toThrow();
  });
});
