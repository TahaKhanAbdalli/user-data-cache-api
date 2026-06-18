import type { Request, RequestHandler } from 'express';
import type { Metrics } from '../metrics/registry';

/** A low-cardinality label for the matched route (never the raw URL). */
function routeLabel(req: Request): string {
  if (req.route !== undefined) {
    return `${req.baseUrl}${(req.route as { path: string }).path}`;
  }
  // Matched a mounted router but no specific route (e.g. a rate-limited request).
  if (req.baseUrl) return req.baseUrl;
  return 'unmatched';
}

/**
 * Measures wall-clock duration for every request and feeds it to the metrics
 * layer on response completion. Mounted first so it captures the full lifecycle
 * including rate-limit rejections and errors.
 */
export function requestMetrics(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      metrics.recordHttp(req.method, routeLabel(req), res.statusCode, durationMs);
    });
    next();
  };
}
