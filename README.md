# User Data Cache API

A high-performance **Express + TypeScript** API that serves user data with an
in-memory **LRU cache**, **request coalescing**, **sliding-window rate
limiting**, **bounded-concurrency async processing**, and **Prometheus
metrics** — built to stay fast and correct under high, bursty traffic.

> Take-home assignment solution. The caching, coalescing, rate-limiting, and
> queue primitives are implemented from scratch (not pulled from a library)
> because that logic is the point of the exercise; each is independently unit
> tested.

---

## Highlights

| Capability              | What it does                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **LRU cache (60s TTL)** | O(1) get/set, capacity-bounded, lazy + background expiry, full hit/miss/eviction/expiration stats |
| **Request coalescing**  | Concurrent misses for the same id share one DB read (no cache stampede)                           |
| **Rate limiting**       | Dual sliding window — 10 req / 60s **and** 5 req / 10s burst — `429` + `Retry-After`              |
| **Async queue**         | Bounded-concurrency worker pool for the simulated DB call; never blocks the event loop            |
| **Observability**       | `/metrics` (Prometheus), `/cache-status` (hits/misses/avg latency), structured `pino` logs        |
| **Production hygiene**  | strict TypeScript, zod-validated config + input, central error handling, graceful shutdown        |

**Measured caching effect** (default 200ms simulated DB latency):

```
GET /users/1   cache MISS → 204 ms
GET /users/1   cache HIT  →   2 ms     (~100x faster)
```

---

## Tech stack

- **Runtime:** Node.js ≥ 20, TypeScript 5 (`strict`, `noUncheckedIndexedAccess`)
- **Web:** Express 5, `cors`
- **Validation:** `zod` (env + request bodies/params)
- **Logging:** `pino` + `pino-http` (structured JSON)
- **Metrics:** `prom-client` (Prometheus exposition format)
- **Tooling:** Vitest + Supertest, ESLint (flat, type-checked) + Prettier, Husky + lint-staged, tsup, tsx

---

## Architecture

### Read path (`GET /users/:id`)

```
        ┌─────────────┐   hit    ┌──────────────────────────────┐
 req ─► │  LRU cache  │ ───────► │ return immediately (≈1–2ms)  │
        └─────────────┘          └──────────────────────────────┘
               │ miss
               ▼
        ┌──────────────────┐  joins existing fetch for same id
        │  SingleFlight    │ ──────────────────────────────────►
        └──────────────────┘
               │ leader only
               ▼
        ┌──────────────────┐  bounded concurrency (default 4)
        │   AsyncQueue     │
        └──────────────────┘
               │
               ▼
        ┌──────────────────┐  simulated 200ms latency
        │  Repository (DB) │ ──► populate cache (single writer) ──► return
        └──────────────────┘
```

### Layers & folder structure

```
src/
├── index.ts            # entrypoint: config, wiring, listen, graceful shutdown
├── app.ts              # Express app factory (middleware order, route mounting)
├── container.ts        # composition root + background tasks (sweeper, pruner)
├── config/env.ts       # zod-validated, fully-defaulted configuration
├── logger.ts           # pino logger factory
├── types.ts            # shared domain types (User, CreateUserInput)
├── lib/                # framework-agnostic, unit-tested primitives
│   ├── lru-cache.ts        #   capacity + TTL + stats + sweep
│   ├── single-flight.ts    #   request coalescing
│   ├── rate-limiter.ts     #   dual sliding-window limiter
│   ├── async-queue.ts      #   bounded-concurrency worker pool
│   ├── delay.ts            #   simulated latency helper
│   └── validation.ts       #   parseOrThrow(schema, data)
├── services/
│   ├── user-repository.ts  # mock DB (seed data + latency)
│   └── user-service.ts     # orchestrates cache + coalescing + queue
├── metrics/registry.ts # Prometheus registry + rolling avg latency
├── middleware/         # async-handler, request-metrics, rate-limit, errors, 404
├── routes/             # users, cache, system (health/metrics)
└── errors/app-error.ts # typed error hierarchy (status + machine code)
```

The framework-agnostic primitives in `lib/` know nothing about Express, which
keeps them trivially testable and reusable; the `services/` layer composes them;
the `routes/` + `middleware/` layers adapt them to HTTP. Dependencies are
injected (the `createApp`/`createServices` factories), so every test spins up an
isolated instance with its own cache, limiter, and clock.

---

## Design decisions

### Caching strategy

A purpose-built `LruCache` (`src/lib/lru-cache.ts`):

- **Recency** is tracked with a native `Map` (insertion-ordered). Reading or
  updating a key deletes and re-inserts it, so the LRU victim is always the
  first key — all operations are O(1) amortised.
- **TTL (60s)** is enforced two ways: **lazily** on read (an expired entry is
  dropped and counted as a miss) and **proactively** by a background sweep
  (`sweepExpired`) on an interval, so memory isn't held by abandoned keys.
- **Stats** (`hits`, `misses`, `size`, `evictions`, `expirations`) back both
  `/cache-status` and `/metrics`.
- The cache is written by a **single writer** inside the coalescing worker, which
  satisfies "update the cache only if the data is not already cached".
- The clock is injectable, so TTL behaviour is tested deterministically without
  real timers.

### Request coalescing (single-flight)

On a cache miss, `SingleFlight` ensures that if N requests for the same id
arrive while a fetch is in progress, only **one** DB read happens and all N
callers await the same promise. This prevents a cache stampede / thundering
herd. Failures are deliberately **not** cached — a transient error must not
poison retries — and `404`s are not stored so a later `POST` can succeed.

### Rate limiting

The spec asks for "10 requests per minute, with a burst capacity of 5 in a
10-second window". A single token bucket can't express a hard per-minute ceiling
**and** a tighter short-term burst cap cleanly, so `SlidingWindowRateLimiter`
enforces **two sliding windows simultaneously** — a request is allowed only if
it satisfies both `≤ max / windowMs` and `≤ burstMax / burstWindowMs`. It is
exact (timestamp-based, no approximation), keyed per client IP, returns
`429` + `Retry-After` + `X-RateLimit-*` headers, and idle keys are pruned
periodically. Rate limiting is applied to the `/users` data API only;
operational endpoints (`/health`, `/metrics`, `/cache*`) stay reachable under
load.

### Asynchronous processing

The simulated DB read runs through `AsyncQueue`, a bounded-concurrency FIFO
worker pool (default 4). It admits up to `concurrency` tasks at once and queues
the rest, so a flood of misses can't exhaust resources or block the event loop,
while a failing task always releases its slot. **Trade-off:** the spec mentions
Bull as an option, but Bull requires Redis and persistence — overkill for a
single-process simulation. The in-memory queue captures the same
non-blocking/back-pressure behaviour with zero infrastructure; a distributed
deployment would swap in Bull/BullMQ behind the same interface.

### Monitoring

`GET /metrics` exposes Prometheus metrics: HTTP request count + duration
histogram (low-cardinality route labels), cache gauges (entries/hits/misses/
evictions/expirations), queue gauges, and default Node process metrics.
`GET /cache-status` returns a human-friendly summary including average response
time. All requests are logged as structured JSON via `pino-http`.

---

## API reference

| Method & path       | Description                                | Success                             | Errors                                          |
| ------------------- | ------------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| `GET /users/:id`    | Fetch a user (cache → coalesced DB read)   | `200` user                          | `400` bad id, `404` unknown, `429` rate limited |
| `POST /users`       | Create a user (cached on write)            | `201` user                          | `400` invalid body, `409` duplicate id, `429`   |
| `DELETE /cache`     | Clear the entire cache                     | `200` `{ message, clearedEntries }` | —                                               |
| `GET /cache-status` | Cache size/hits/misses/ratio + avg latency | `200`                               | —                                               |
| `GET /health`       | Liveness + uptime                          | `200`                               | —                                               |
| `GET /metrics`      | Prometheus exposition                      | `200` text                          | —                                               |

Errors share one shape: `{ "error": { "code", "message", "details?" } }`.

```bash
curl localhost:3000/users/1
# {"id":1,"name":"John Doe","email":"john@example.com"}

curl -X POST localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Grace Hopper","email":"grace@example.com"}'
# 201 {"id":4,"name":"Grace Hopper","email":"grace@example.com"}
```

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- pnpm (`corepack enable` then `corepack prepare pnpm@9 --activate`)

### Install

```bash
pnpm install
```

### Run

```bash
pnpm dev            # watch mode (tsx)
# or
pnpm build && pnpm start
```

The server listens on `http://localhost:3000` (override with `PORT`).

### Environment variables

All are optional — the server boots with sensible defaults. Copy `.env.example`
to `.env` to override. Values are validated at startup (a bad value fails fast).

| Variable                                              | Default        | Description                             |
| ----------------------------------------------------- | -------------- | --------------------------------------- |
| `PORT`                                                | `3000`         | HTTP port                               |
| `NODE_ENV`                                            | `development`  | `development` \| `test` \| `production` |
| `LOG_LEVEL`                                           | `info`         | pino level (`silent`…`trace`)           |
| `DB_DELAY_MS`                                         | `200`          | Simulated DB latency on a cache miss    |
| `QUEUE_CONCURRENCY`                                   | `4`            | Max concurrent simulated DB reads       |
| `CACHE_TTL_MS`                                        | `60000`        | Entry time-to-live                      |
| `CACHE_MAX_ENTRIES`                                   | `1000`         | LRU capacity                            |
| `CACHE_SWEEP_INTERVAL_MS`                             | `10000`        | Background stale-entry sweep cadence    |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`             | `60000` / `10` | Sustained window                        |
| `RATE_LIMIT_BURST_WINDOW_MS` / `RATE_LIMIT_BURST_MAX` | `10000` / `5`  | Burst window                            |

---

## Testing

```bash
pnpm test            # run all unit + integration tests (Vitest)
pnpm test:coverage   # with coverage report
pnpm test:watch      # watch mode
```

49 tests cover the cache (eviction, TTL, stats), coalescing, the dual-window
limiter, the queue's concurrency bound, the service orchestration, and the full
HTTP surface (Supertest): success, 400/404/409/429, headers, and metrics.

### Observing the behaviours live

```bash
pnpm dev                                   # terminal 1
pnpm loadtest                              # terminal 2 — cache effect + rate limiting

# To see pure coalescing/throughput without the rate limiter capping the run:
RATE_LIMIT_MAX=100000 RATE_LIMIT_BURST_MAX=100000 pnpm dev   # terminal 1
pnpm loadtest                                                # terminal 2
```

A Postman collection is in `postman/`.

---

## Quality gate

```bash
pnpm lint            # ESLint (type-checked)
pnpm format:check    # Prettier
pnpm typecheck       # tsc --noEmit
pnpm build           # tsup → dist/
```

CI (GitHub Actions) runs lint → typecheck → format → test → build on every push.
A Husky pre-commit hook runs lint-staged (Prettier + ESLint) on staged files.

---

## Deployment

A multi-stage `Dockerfile` is included (build → bundle → slim production image).
The server reads `PORT` from the environment and binds `0.0.0.0`, so it runs on
any container platform unchanged.

### Google Cloud Run (source deploy — no local Docker needed)

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy user-data-cache-api \
  --source . \
  --region europe-west4 \
  --allow-unauthenticated \
  --min-instances 0           # scale to zero so an idle service costs nothing
```

Cloud Build builds from the `Dockerfile`; Cloud Run injects `PORT`. With
`--min-instances 0`, demo traffic stays within the always-free tier.

### Render (free tier, no card)

A `render.yaml` Blueprint is included. In the Render dashboard: **New + →
Blueprint → connect this repo → Apply**. Render builds the Dockerfile and runs
it on the free plan (it sleeps after ~15 min idle and cold-starts on the next
request).

### Docker (any host)

```bash
docker build -t user-data-cache-api .
docker run -p 8080:8080 user-data-cache-api   # http://localhost:8080/health
```

---

## Trade-offs & assumptions

- **In-memory everything.** Cache, rate-limiter state, and queue live in one
  process — correct for this single-instance simulation. At horizontal scale
  these move to Redis (cache + limiter) and Bull/BullMQ (queue) behind the same
  interfaces.
- **Rate-limit interpretation.** "10/min + burst 5/10s" is read as two windows
  enforced together (documented above).
- **Coalescing vs. rate limiting interact.** Under the default tight limits a
  large concurrent burst is partly rejected before coalescing is visible; the
  load-test script raises limits to isolate each behaviour.
- **Negative results aren't cached.** A `404` is intentionally not stored.

## Future improvements

- Redis-backed cache + limiter and BullMQ queue for multi-instance deployments.
- `stale-while-revalidate` to serve slightly-stale data while refreshing.
- Per-route / per-API-key rate limits and a `RateLimit` (RFC 9239) header set.
- OpenAPI spec + generated client; persistence behind the repository interface.
- Tracing (OpenTelemetry) to complement metrics and logs.

## License

MIT © Muhammad Taha Khan
