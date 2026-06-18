import { LruCache } from './lib/lru-cache';
import { SingleFlight } from './lib/single-flight';
import { AsyncQueue } from './lib/async-queue';
import { SlidingWindowRateLimiter } from './lib/rate-limiter';
import { MockUserRepository, SEED_USERS } from './services/user-repository';
import { UserService } from './services/user-service';
import { Metrics } from './metrics/registry';
import type { AppConfig } from './config/env';
import type { Logger } from './logger';
import type { User } from './types';

export interface Services {
  cache: LruCache<User>;
  singleFlight: SingleFlight<User>;
  queue: AsyncQueue;
  userService: UserService;
  rateLimiter: SlidingWindowRateLimiter;
  metrics: Metrics;
}

/** Composition root: constructs and wires every singleton from configuration. */
export function createServices(config: AppConfig): Services {
  const cache = new LruCache<User>({
    maxEntries: config.cache.maxEntries,
    ttlMs: config.cache.ttlMs,
  });
  const singleFlight = new SingleFlight<User>();
  const queue = new AsyncQueue({ concurrency: config.queueConcurrency });
  const repo = new MockUserRepository(SEED_USERS, config.dbDelayMs);
  const userService = new UserService({ repo, cache, singleFlight, queue });
  const rateLimiter = new SlidingWindowRateLimiter({ ...config.rateLimit });
  const metrics = new Metrics({
    getCacheStats: () => cache.stats(),
    getQueue: () => ({ active: queue.active, pending: queue.pending, size: queue.size }),
    getSingleFlightInFlight: () => singleFlight.inFlightCount,
  });

  return { cache, singleFlight, queue, userService, rateLimiter, metrics };
}

/**
 * Starts the periodic maintenance tasks (TTL sweep + idle-client pruning).
 * Timers are `unref`'d so they never keep the process alive on their own.
 * Returns a stop function for graceful shutdown / test teardown.
 */
export function startBackgroundTasks(
  services: Services,
  config: AppConfig,
  logger: Logger,
): () => void {
  const sweeper = setInterval(() => {
    const removed = services.cache.sweepExpired();
    if (removed > 0) {
      logger.debug({ removed }, 'swept expired cache entries');
    }
  }, config.cache.sweepIntervalMs);
  sweeper.unref();

  const pruner = setInterval(() => {
    services.rateLimiter.prune();
  }, config.rateLimit.windowMs);
  pruner.unref();

  return () => {
    clearInterval(sweeper);
    clearInterval(pruner);
  };
}
