import { z } from 'zod';

/**
 * Environment schema. Everything has a sensible default so the server boots
 * with zero configuration, but every value is overridable via env vars and is
 * validated/coerced here — a misconfigured deployment fails fast and loudly
 * rather than misbehaving at runtime.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DB_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(4),

  CACHE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(1000),
  CACHE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_BURST_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  RATE_LIMIT_BURST_MAX: z.coerce.number().int().positive().default(5),
});

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  dbDelayMs: number;
  queueConcurrency: number;
  cache: {
    ttlMs: number;
    maxEntries: number;
    sweepIntervalMs: number;
  };
  rateLimit: {
    windowMs: number;
    max: number;
    burstWindowMs: number;
    burstMax: number;
  };
}

/** Parses and validates configuration from an environment object. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    dbDelayMs: parsed.DB_DELAY_MS,
    queueConcurrency: parsed.QUEUE_CONCURRENCY,
    cache: {
      ttlMs: parsed.CACHE_TTL_MS,
      maxEntries: parsed.CACHE_MAX_ENTRIES,
      sweepIntervalMs: parsed.CACHE_SWEEP_INTERVAL_MS,
    },
    rateLimit: {
      windowMs: parsed.RATE_LIMIT_WINDOW_MS,
      max: parsed.RATE_LIMIT_MAX,
      burstWindowMs: parsed.RATE_LIMIT_BURST_WINDOW_MS,
      burstMax: parsed.RATE_LIMIT_BURST_MAX,
    },
  };
}
