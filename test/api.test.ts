import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createServices } from '../src/container';
import { createLogger } from '../src/logger';
import type { AppConfig } from '../src/config/env';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    dbDelayMs: 10,
    queueConcurrency: 4,
    cache: { ttlMs: 60_000, maxEntries: 100, sweepIntervalMs: 10_000 },
    // Effectively unlimited unless a test overrides it.
    rateLimit: { windowMs: 60_000, max: 10_000, burstWindowMs: 10_000, burstMax: 10_000 },
    ...overrides,
  };
}

function buildApp(overrides: Partial<AppConfig> = {}) {
  const config = makeConfig(overrides);
  const services = createServices(config);
  const app = createApp({
    userService: services.userService,
    cache: services.cache,
    metrics: services.metrics,
    rateLimiter: services.rateLimiter,
    logger: createLogger('silent'),
  });
  return { app, services };
}

describe('GET /users/:id', () => {
  it('returns the seeded user', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/users/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, name: 'John Doe', email: 'john@example.com' });
  });

  it('serves a repeat request from cache (hit recorded, single stored entry)', async () => {
    const { app } = buildApp();
    await request(app).get('/users/2');
    await request(app).get('/users/2');

    const status = await request(app).get('/cache-status');
    expect(status.body.hits).toBeGreaterThanOrEqual(1);
    expect(status.body.misses).toBeGreaterThanOrEqual(1);
    expect(status.body.size).toBe(1);
  });

  it('returns 404 with a meaningful error for an unknown id', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/users/999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('999');
  });

  it('returns 400 for a non-numeric id', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/users/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sets rate-limit headers on allowed requests', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/users/1');
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('coalesces concurrent requests for the same id (all succeed identically)', async () => {
    const { app } = buildApp({ dbDelayMs: 50 });
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).get('/users/3')),
    );
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 3, name: 'Alice Johnson', email: 'alice@example.com' });
    }
  });
});

describe('POST /users', () => {
  it('creates a user and caches it for immediate retrieval', async () => {
    const { app } = buildApp();
    const created = await request(app)
      .post('/users')
      .send({ name: 'Grace Hopper', email: 'grace@example.com' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Grace Hopper', email: 'grace@example.com' });
    expect(typeof created.body.id).toBe('number');

    const fetched = await request(app).get(`/users/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
  });

  it('rejects an invalid payload with 400', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/users').send({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate id with 409', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/users')
      .send({ id: 1, name: 'Clashing', email: 'clash@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 (not 500) for a malformed JSON body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/users')
      .set('Content-Type', 'application/json')
      .send('{ "name": "broken" ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});

describe('cache management', () => {
  it('DELETE /cache empties the cache', async () => {
    const { app } = buildApp();
    await request(app).get('/users/1');
    const cleared = await request(app).delete('/cache');
    expect(cleared.status).toBe(200);
    expect(cleared.body.message).toMatch(/cleared/i);

    const status = await request(app).get('/cache-status');
    expect(status.body.size).toBe(0);
  });

  it('GET /cache-status reports the documented fields', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/cache-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        size: expect.any(Number),
        hits: expect.any(Number),
        misses: expect.any(Number),
        hitRatio: expect.any(Number),
        averageResponseTimeMs: expect.any(Number),
        totalRequests: expect.any(Number),
      }),
    );
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the burst capacity is exceeded', async () => {
    const { app } = buildApp({
      rateLimit: { windowMs: 60_000, max: 10, burstWindowMs: 10_000, burstMax: 2 },
    });

    expect((await request(app).get('/users/1')).status).toBe(200);
    expect((await request(app).get('/users/1')).status).toBe(200);

    const limited = await request(app).get('/users/1');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('operational endpoints', () => {
  it('GET /health returns ok', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /metrics exposes Prometheus text', async () => {
    const { app } = buildApp();
    await request(app).get('/users/1'); // generate some data
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('cache_entries');
  });

  it('returns 404 for an unknown route', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
