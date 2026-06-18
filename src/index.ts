import { loadConfig } from './config/env';
import { createLogger } from './logger';
import { createApp } from './app';
import { createServices, startBackgroundTasks } from './container';

/** Loads a local `.env` file if present; otherwise relies on the real environment. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file — fine, defaults + real env vars cover everything.
  }
}

loadDotEnv();

const config = loadConfig();
const logger = createLogger(config.logLevel);
const services = createServices(config);
const app = createApp({
  userService: services.userService,
  cache: services.cache,
  metrics: services.metrics,
  rateLimiter: services.rateLimiter,
  logger,
  trustProxy: config.trustProxy,
});
const stopBackgroundTasks = startBackgroundTasks(services, config, logger);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'user-data-cache-api listening');
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down gracefully');
  stopBackgroundTasks();
  server.close(() => {
    logger.info('server closed');
    process.exit(0);
  });
  // Force-exit if connections do not drain promptly.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
