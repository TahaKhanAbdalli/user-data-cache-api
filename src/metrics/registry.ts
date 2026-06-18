import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { CacheStats } from '../lib/lru-cache';

/**
 * Callbacks that let the metrics layer read live runtime state at scrape time
 * without holding direct references to the cache/queue (keeps the dependency
 * direction one-way: infrastructure depends on nothing concrete).
 */
export interface RuntimeStatsProviders {
  getCacheStats: () => CacheStats;
  getQueue: () => { active: number; pending: number; size: number };
  getSingleFlightInFlight: () => number;
}

const HTTP_LABELS = ['method', 'route', 'status'] as const;

/**
 * Owns a Prometheus registry and exposes both:
 *  - `/metrics` in Prometheus exposition format (HTTP histograms/counters,
 *    cache + queue gauges, and default process metrics), and
 *  - a rolling average response time used by `/cache-status`.
 */
export class Metrics {
  readonly registry = new Registry();

  private readonly httpDuration: Histogram<(typeof HTTP_LABELS)[number]>;
  private readonly httpTotal: Counter<(typeof HTTP_LABELS)[number]>;
  private readonly cacheEntries: Gauge;
  private readonly cacheHits: Gauge;
  private readonly cacheMisses: Gauge;
  private readonly cacheEvictions: Gauge;
  private readonly cacheExpirations: Gauge;
  private readonly queueActive: Gauge;
  private readonly queuePending: Gauge;
  private readonly inFlight: Gauge;

  private totalResponseMs = 0;
  private totalResponses = 0;

  constructor(private readonly providers: RuntimeStatsProviders) {
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_ms',
      help: 'HTTP request duration in milliseconds',
      labelNames: HTTP_LABELS,
      buckets: [1, 5, 10, 25, 50, 100, 200, 350, 500, 1000, 2500],
      registers: [this.registry],
    });
    this.httpTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: HTTP_LABELS,
      registers: [this.registry],
    });

    const gauge = (name: string, help: string): Gauge =>
      new Gauge({ name, help, registers: [this.registry] });

    this.cacheEntries = gauge('cache_entries', 'Current number of entries in the cache');
    this.cacheHits = gauge('cache_hits_total', 'Cumulative cache hits');
    this.cacheMisses = gauge('cache_misses_total', 'Cumulative cache misses');
    this.cacheEvictions = gauge('cache_evictions_total', 'Cumulative LRU evictions');
    this.cacheExpirations = gauge('cache_expirations_total', 'Cumulative TTL expirations');
    this.queueActive = gauge('queue_active', 'Tasks currently running in the async queue');
    this.queuePending = gauge('queue_pending', 'Tasks queued or running in the async queue');
    this.inFlight = gauge('single_flight_in_flight', 'Distinct in-flight coalesced fetches');
  }

  /** Records one completed HTTP request. */
  recordHttp(method: string, route: string, status: number, durationMs: number): void {
    const labels = { method, route, status: String(status) };
    this.httpDuration.observe(labels, durationMs);
    this.httpTotal.inc(labels);
    this.totalResponseMs += durationMs;
    this.totalResponses += 1;
  }

  get averageResponseTimeMs(): number {
    return this.totalResponses === 0 ? 0 : this.totalResponseMs / this.totalResponses;
  }

  get totalRequests(): number {
    return this.totalResponses;
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** Renders the Prometheus exposition text, refreshing live gauges first. */
  async expose(): Promise<string> {
    this.syncRuntimeGauges();
    return this.registry.metrics();
  }

  private syncRuntimeGauges(): void {
    const cache = this.providers.getCacheStats();
    this.cacheEntries.set(cache.size);
    this.cacheHits.set(cache.hits);
    this.cacheMisses.set(cache.misses);
    this.cacheEvictions.set(cache.evictions);
    this.cacheExpirations.set(cache.expirations);

    const queue = this.providers.getQueue();
    this.queueActive.set(queue.active);
    this.queuePending.set(queue.pending);
    this.inFlight.set(this.providers.getSingleFlightInFlight());
  }
}
