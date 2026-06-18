import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler';
import type { Metrics } from '../metrics/registry';

export interface SystemRouterDeps {
  metrics: Metrics;
  /** Injectable clock, primarily for deterministic uptime in tests. */
  now?: () => number;
}

/** Operational endpoints (excluded from rate limiting): `GET /health`, `GET /metrics`. */
export function systemRouter(deps: SystemRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const startedAt = now();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      timestamp: new Date(now()).toISOString(),
    });
  });

  router.get(
    '/metrics',
    asyncHandler(async (_req, res) => {
      res.setHeader('Content-Type', deps.metrics.contentType);
      res.send(await deps.metrics.expose());
    }),
  );

  return router;
}
