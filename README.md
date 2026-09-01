# Pendelkollen

Punctuality history for Swedish trains, built from Trafikverket `TrainAnnouncement` data.

## What is implemented

- raw JSON landing before parsing
- idempotent natural-key upserts guarded by `ModifiedTime`
- cursor/high-water mark, run log, and dead-letter queue
- the same `ingest(windowStart, windowEnd)` path for polling and backfill
- retry with exponential backoff and jitter
- public `/status`, station departures, and station statistics endpoints
- UTC storage and explicit `Europe/Stockholm` aggregation
- unit tests for missing actual times, late cancellation, older corrections, and DST

## Quick start

Requirements: Node 22+ and Docker.

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm test
```

Add your Trafikverket key to `.env`, then make a reality-check fetch:

```bash
npm run reality-check -- THN
```

Run one historical window or start continuous polling:

```bash
npm run backfill -- 2026-08-31T00:00:00Z 2026-09-01T00:00:00Z
npm run backfill -- 2026-08-31T00:00:00Z 2026-09-01T00:00:00Z THN
npm run worker
npm run api
```

The API is then available at `http://localhost:3001/status`.

## Counting rules

A passage is **cancelled** whenever the newest source version has `Canceled=true`, even if an earlier version had an actual time. A completed, non-cancelled passage is on time when actual arrival/departure is no more than five minutes after advertised time. A missing actual time is classified as:

- `pending` until advertised time plus the configurable grace period (default 6 hours)
- `cancelled` only when Trafikverket explicitly says so
- `data_gap` after the grace period

Data gaps are excluded from punctuality percentages and shown separately. Only advertised locations (`Advertised=true`) are included in passenger-facing statistics. These rules are deliberately explicit and can later become a query option.

The natural key is `(advertised_train_ident, location_signature, advertised_time_at_location, activity_type)`. This is practical rather than metaphysically perfect: split/merged services remain separate if their advertised identity changes.

## API schema version

`TRAFIKVERKET_SCHEMA_VERSION` is configuration, currently defaulted to `1.9`. Verify it in Trafikverket's live data-model portal before first production use; object schema versions are retired independently. The worker fails loudly rather than silently changing versions.

## Deployables

- `src/worker.ts`: long-running ingest worker (Railway/Fly.io)
- `src/api.ts`: independent read API (Railway/Fly.io)
- `web/`: intentionally deferred until real data has accumulated; the API is ready for a Next.js frontend

The frontend is deliberately not fabricated before a live sample has validated the semantics.

## Railway deployment

Create two Railway services from the same GitHub repository. Keep the repository root as the root directory for both.

Shared build command:

```text
npm run build
```

Use these start commands:

| Service | Start command | Public domain |
| --- | --- | --- |
| `train-api` | `npm run start:api` | Yes |
| `train-worker` | `npm run start:worker` | No |

Add the same `DATABASE_URL` to both services. Add `TRAFIKVERKET_API_KEY` and `TRAFIKVERKET_SCHEMA_VERSION=1.9` to the worker. Railway supplies `PORT` to the API automatically, so do not hard-code it.

Configure `/health` as the API healthcheck path. Use restart-on-failure for the API and always-restart for the worker. Do not run database migration as a Railway pre-deploy command: migrations are currently manual and the initial schema has already been applied.
