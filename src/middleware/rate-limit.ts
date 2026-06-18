import type { RequestHandler } from 'express';
import type { SlidingWindowRateLimiter } from '../lib/rate-limiter';
import { RateLimitError } from '../errors/app-error';

/**
 * Express adapter for the sliding-window rate limiter. Keys by client IP, sets
 * informative `X-RateLimit-*` headers, and on rejection sets `Retry-After` and
 * forwards a {@link RateLimitError} so the response shape stays consistent with
 * every other error.
 */
export function rateLimit(limiter: SlidingWindowRateLimiter): RequestHandler {
  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const result = limiter.check(key);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(
        new RateLimitError(
          `Rate limit exceeded (${result.reason ?? 'limit'}). Retry in ${retryAfterSeconds}s.`,
          retryAfterSeconds,
          { reason: result.reason },
        ),
      );
      return;
    }

    next();
  };
}
