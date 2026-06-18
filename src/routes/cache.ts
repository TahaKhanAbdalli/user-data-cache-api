import { Router } from 'express';
import type { LruCache } from '../lib/lru-cache';
import type { Metrics } from '../metrics/registry';
import type { User } from '../types';

export interface CacheRouterDeps {
  cache: LruCache<User>;
  metrics: Metrics;
}

/**
 * Cache management endpoints:
 *  - `DELETE /cache`        clears every entry
 *  - `GET /cache-status`    reports size, hits, misses, hit ratio, and the
 *                           average response time across all requests
 */
export function cacheRouter(deps: CacheRouterDeps): Router {
  const router = Router();

  router.delete('/cache', (_req, res) => {
    const clearedEntries = deps.cache.size;
    deps.cache.clear();
    res.json({ message: 'Cache cleared', clearedEntries });
  });

  router.get('/cache-status', (_req, res) => {
    const stats = deps.cache.stats();
    const lookups = stats.hits + stats.misses;
    res.json({
      size: stats.size,
      hits: stats.hits,
      misses: stats.misses,
      hitRatio: lookups === 0 ? 0 : Number((stats.hits / lookups).toFixed(4)),
      evictions: stats.evictions,
      expirations: stats.expirations,
      averageResponseTimeMs: Number(deps.metrics.averageResponseTimeMs.toFixed(3)),
      totalRequests: deps.metrics.totalRequests,
    });
  });

  return router;
}
