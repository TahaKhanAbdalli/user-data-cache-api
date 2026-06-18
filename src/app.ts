import express, { type Express } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type { Logger } from './logger';
import type { UserService } from './services/user-service';
import type { LruCache } from './lib/lru-cache';
import type { Metrics } from './metrics/registry';
import type { SlidingWindowRateLimiter } from './lib/rate-limiter';
import type { User } from './types';
import { requestMetrics } from './middleware/request-metrics';
import { rateLimit } from './middleware/rate-limit';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { usersRouter } from './routes/users';
import { cacheRouter } from './routes/cache';
import { systemRouter } from './routes/system';

export interface AppDeps {
  userService: UserService;
  cache: LruCache<User>;
  metrics: Metrics;
  rateLimiter: SlidingWindowRateLimiter;
  logger: Logger;
  /** Express "trust proxy" value; defaults to 'loopback'. */
  trustProxy?: boolean | number | string;
}

/**
 * Builds the Express application from injected dependencies. Keeping wiring in a
 * factory (rather than at import time) makes the app trivially testable: each
 * test spins up an isolated instance with its own cache/limiter/services.
 *
 * Middleware order is deliberate:
 *   json/cors → request logging → metrics timer → [routes] → 404 → error handler
 * Rate limiting is applied only to the `/users` data API; operational endpoints
 * (`/health`, `/metrics`, `/cache*`) stay reachable even under load.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // 'loopback' by default (safe locally). Behind a platform proxy, set
  // TRUST_PROXY (e.g. '1') so req.ip is the real client and the rate limiter
  // keys per client rather than per proxy.
  app.set('trust proxy', deps.trustProxy ?? 'loopback');

  app.use(express.json());
  app.use(cors());
  app.use(pinoHttp({ logger: deps.logger }));
  app.use(requestMetrics(deps.metrics));

  app.use('/users', rateLimit(deps.rateLimiter), usersRouter(deps.userService));
  app.use(cacheRouter({ cache: deps.cache, metrics: deps.metrics }));
  app.use(systemRouter({ metrics: deps.metrics }));

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));

  return app;
}
