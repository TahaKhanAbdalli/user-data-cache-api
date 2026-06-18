import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Creates a structured JSON logger. JSON (rather than pretty-printed) output is
 * the right default for production: it is trivially ingested by log shippers
 * and aggregators. In tests we run at `silent` to keep output pristine.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'user-data-cache-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
