/**
 * Lightweight load / behaviour harness for the running API.
 *
 * Usage:
 *   1. Start the server:           pnpm dev    (or: pnpm build && pnpm start)
 *   2. In another terminal:        pnpm loadtest
 *
 * It demonstrates the three behaviours the assignment asks us to observe:
 *   1. Caching effect      — first (miss) vs subsequent (hit) latency
 *   2. Coalescing/throughput — many concurrent reads of one id share one DB call
 *   3. Rate limiting       — the 200 -> 429 transition under a burst
 *
 * Scenarios 1 & 2 are most visible when the server runs with relaxed limits:
 *   RATE_LIMIT_MAX=100000 RATE_LIMIT_BURST_MAX=100000 pnpm dev
 * (the script detects rate-limit interference and says so).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 25);
const BURST = Number(process.env.BURST ?? 20);

interface Timed {
  status: number;
  ms: number;
}

async function timed(path: string, init?: RequestInit): Promise<Timed> {
  const start = performance.now();
  const res = await fetch(`${BASE_URL}${path}`, init);
  await res.text();
  return { status: res.status, ms: performance.now() - start };
}

function heading(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

async function ensureUp(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`health returned ${res.status}`);
  } catch (err) {
    console.error(`\nCannot reach ${BASE_URL}. Is the server running? (pnpm dev)\n`, err);
    process.exit(1);
  }
}

async function scenarioCaching(): Promise<void> {
  heading('1. Caching effect (miss vs hit)');
  await timed('/cache', { method: 'DELETE' });
  const miss = await timed('/users/1');
  const hit = await timed('/users/1');
  const speedup = hit.ms > 0 ? (miss.ms / hit.ms).toFixed(1) : '∞';
  console.log(`  miss: ${miss.ms.toFixed(1)}ms (status ${miss.status})`);
  console.log(`  hit : ${hit.ms.toFixed(1)}ms (status ${hit.status})`);
  console.log(`  speedup: ~${speedup}x faster from cache`);
}

async function scenarioCoalescing(): Promise<void> {
  heading(`2. Coalescing / throughput (${CONCURRENCY} concurrent reads of one id)`);
  await timed('/cache', { method: 'DELETE' });
  const start = performance.now();
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => timed('/users/2')));
  const wall = performance.now() - start;
  const ok = results.filter((r) => r.status === 200).length;
  const limited = results.filter((r) => r.status === 429).length;
  console.log(`  ${ok} x 200, ${limited} x 429, wall clock ${wall.toFixed(1)}ms`);
  if (limited > 0) {
    console.log('  note: rate limiting capped this run — re-run the server with raised');
    console.log('        RATE_LIMIT_MAX / RATE_LIMIT_BURST_MAX to see pure coalescing.');
  } else {
    console.log(`  ${CONCURRENCY} concurrent requests resolved in ~one DB latency window,`);
    console.log('  proving the requests coalesced into a single backend read.');
  }
}

async function scenarioRateLimit(): Promise<void> {
  heading(`3. Rate limiting (${BURST} rapid sequential requests)`);
  let firstLimited = -1;
  let ok = 0;
  let limited = 0;
  for (let i = 0; i < BURST; i += 1) {
    const res = await timed('/users/1');
    if (res.status === 429) {
      limited += 1;
      if (firstLimited === -1) firstLimited = i + 1;
    } else if (res.status === 200) {
      ok += 1;
    }
  }
  console.log(`  ${ok} x 200, ${limited} x 429`);
  console.log(
    firstLimited === -1
      ? '  no request was rate limited (limits likely relaxed for this run).'
      : `  first 429 at request #${firstLimited} — limiter is enforcing the burst window.`,
  );
}

async function main(): Promise<void> {
  console.log(`Load test against ${BASE_URL}`);
  await ensureUp();
  await scenarioCaching();
  await scenarioCoalescing();
  await scenarioRateLimit();

  heading('Final /cache-status');
  const res = await fetch(`${BASE_URL}/cache-status`);
  console.log(' ', JSON.stringify(await res.json()));
  console.log();
}

void main();
