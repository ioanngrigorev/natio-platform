# Deploying NATIO

This describes how to run NATIO in production. It assumes you have a PostgreSQL 16 database, a Redis instance, a place to run containers, and a TLS-terminating proxy. The stack is deliberately small: two Node processes (API and worker), one Next.js process, Postgres and Redis.

## What runs where

NATIO is a modular monolith, so a full deployment is four containers plus two managed services:

| Component | Image | Role | Scaling |
|---|---|---|---|
| `api` | `apps/api/Dockerfile` | HTTP: `/v1`, `/dashboard`, `/admin`, `/health` | Stateless, scale horizontally |
| `worker` | same image, `NATIO_PROCESS_ROLE=worker` | Webhook delivery, provider status sync, idempotency-key purge | Scale by queue depth |
| `web` | `apps/web/Dockerfile` | Public site, developer portal, merchant dashboard, admin UI | Stateless, scale horizontally |
| `proxy` | Caddy (or your ALB/nginx) | TLS, routing, HSTS | — |
| PostgreSQL 16 | managed | System of record | Primary + replica |
| Redis 7 | managed | BullMQ queues, rate-limit counters | Single primary is enough at MVP volume |

The API and the worker are the same image with a different `NATIO_PROCESS_ROLE`. Running `all` in one process is supported and is what the development setup uses, but production should separate them so a slow webhook endpoint cannot compete with request handling for the event loop.

## Domains

The brief's target layout is `natio.me` for the site, `app.natio.me` for the dashboard, `api.natio.me` for the API and `docs.natio.me` for the developer portal. `deploy/Caddyfile` ships with both layouts: a single-domain configuration that is active by default, and the subdomain configuration commented out at the bottom.

Single domain (works immediately, no extra DNS):

```
natio.me/            website, /dashboard, /admin, /docs   → web:3000
natio.me/v1/*        Universal Payment API                 → api:4000
natio.me/health      health probe                          → api:4000
natio.me/openapi.json, /providers/webhooks/*, /sandbox/*   → api:4000
```

Subdomains (preferred once DNS is in place): point `natio.me`, `app.natio.me` and `docs.natio.me` at the `web` container and `api.natio.me` at the `api` container, then set `CORS_ORIGINS=https://natio.me,https://app.natio.me` and `COOKIE_DOMAIN=.natio.me`.

One routing detail matters. The dashboard and admin UIs call the API through `/api/*` on their **own** origin; `apps/web/next.config.mjs` rewrites that to `API_INTERNAL_URL` server-side. This keeps session cookies first-party and means the browser never needs a cross-origin credentialed request. Do not "simplify" this by pointing the browser directly at `api.natio.me` — you would then need `SameSite=None` cookies and a wider CORS policy.

## First deployment

```bash
git clone <repo> natio && cd natio
cp .env.example .env
```

Generate the two secrets — they must be different from each other, and `NATIO_ENCRYPTION_KEY` must never change after provider credentials have been written, or those credentials become undecryptable:

```bash
echo "NATIO_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "NATIO_SESSION_SECRET=$(openssl rand -hex 32)"
```

Set at minimum:

```ini
NODE_ENV=production
DATABASE_URL=postgres://natio_app:...@db-host:5432/natio
DATABASE_SSL=require
REDIS_URL=rediss://...
QUEUE_DRIVER=redis
NATIO_ENCRYPTION_KEY=<64 hex>
NATIO_SESSION_SECRET=<64 hex, different>
COOKIE_SECURE=true
COOKIE_DOMAIN=.natio.me
CORS_ORIGINS=https://natio.me,https://app.natio.me
PUBLIC_WEB_URL=https://natio.me
PUBLIC_API_URL=https://api.natio.me
WEBHOOK_ALLOW_PRIVATE_URLS=false
TRUST_PROXY=10.0.0.0/8      # the address or CIDR of YOUR proxy — never "true"
```

`apps/api/src/config.ts` refuses to start in production if `COOKIE_SECURE` is false, `QUEUE_DRIVER=memory`, `WEBHOOK_ALLOW_PRIVATE_URLS` is true, `DATABASE_SSL` is not `require`, `CORS_ORIGINS` contains `*` or an `http://` origin, the two secrets are equal, or `TRUST_PROXY=true`. These are startup errors, not warnings — a misconfigured deployment fails loudly instead of running insecurely.

Then bring the stack up and initialise the database:

```bash
docker compose up -d --build
docker compose --profile tools run --rm migrate
```

`migrate` is idempotent and safe to run on every deploy. Do **not** run `seed` against production: it creates demo accounts with a known password. Seed only sandbox and staging environments.

Create the first real admin user by running the seed once in a throwaway environment to learn the shape, or insert directly with a scrypt hash produced by `apps/api/src/lib/crypto.ts`. After that, further admin users are created through the admin UI (Users → Create admin user), which is the audited path.

## Deploy pipeline

A deploy is: build images → run migrations → roll the API and worker → roll the web app.

```bash
docker compose build
docker compose --profile tools run --rm migrate    # additive migrations only
docker compose up -d --no-deps api worker
docker compose up -d --no-deps web
```

Migrations must be backward compatible with the currently running code, because during a rolling deploy both versions are live. The practical rule: add columns nullable or with defaults, never rename or drop in the same release as the code change. Do a column removal in two releases — stop writing it, then drop it.

The append-only triggers in `0001_immutability.sql` mean a migration can never rewrite history in `audit_logs`, `state_transitions`, `payment_events`, `events` or the financial fields of `transactions`. If a data correction is genuinely needed, insert a compensating `adjustment` transaction rather than editing the original.

## Database roles

Before production, split the database roles. The application must not connect as the table owner, because an owner can drop the immutability triggers — this is finding I-1 in `docs/SECURITY.md`. `deploy/postgres-init/10-least-privilege.sql.example` creates a `natio_app` role with DML only; migrations run as a separate owner role from the deploy job. Point `DATABASE_URL` at `natio_app`.

Connection pooling: the API uses `pg.Pool` with `DATABASE_POOL_MAX` (default 10) per process. Size it as `max_connections` on the database divided by the number of API + worker processes, leaving headroom for migrations and operators. Behind PgBouncer use session pooling — NATIO uses transactions and `SELECT … FOR UPDATE`, which transaction pooling handles, but prepared-statement caching does not survive statement pooling.

## Health, logging and monitoring

`GET /health` returns `200` with a per-dependency breakdown, `503` when a dependency is down:

```json
{"status":"ok","version":"0.1.0","role":"api","checks":{"database":"ok","queue":"ok"},"time":"..."}
```

Use it as both the container healthcheck and the load-balancer target check. It touches the database, so do not poll it more often than every 10–30 seconds.

Logs are structured JSON on stdout (pino). `src/lib/logger.ts` redacts `authorization`, `cookie`, and any key matching password / secret / credential / token before serialisation. Ship stdout to your log platform; do not add a file sink inside the container. Every response carries `x-request-id`, and the same id is written to `audit_logs.request_id`, so a support ticket quoting a request id can be traced from the HTTP log to the audit record to the payment timeline.

What to alert on, in rough priority order:

- `/health` failing on any instance, or `checks.database != "ok"`.
- Payment success rate dropping — `GET /admin/overview` exposes it, or query `payments` directly. A provider outage shows up here first.
- `system_events` rows with `level = 'error'`, especially `type = 'attempt.unresolved'`: a payment attempt whose status could not be resolved with the provider after retries. These need a human.
- `webhook_deliveries` with `status = 'exhausted'` — the merchant is no longer receiving events.
- Queue depth in Redis and worker liveness. A stalled worker stops webhooks and provider sync silently.
- Payments stuck in `processing` for more than a few minutes.

## Backups

`deploy/backup.sh` takes a compressed custom-format `pg_dump`, verifies the dump can be listed, prunes by `RETENTION_DAYS` (default 30) and optionally copies to S3. Run it from cron on a host with network access to the database:

```cron
17 * * * *  BACKUP_DIR=/var/backups/natio DATABASE_URL=postgres://... BACKUP_S3_URI=s3://natio-backups/db /opt/natio/deploy/backup.sh >> /var/log/natio-backup.log 2>&1
```

Hourly dumps give at most one hour of loss. For a payments system that is the floor, not the target: enable managed point-in-time recovery (WAL archiving) on the database as well, and treat the dumps as the portable, off-provider copy. Keep `BACKUP_S3_URI` set — a backup on the database host is not a backup.

`deploy/restore.sh` restores into an empty database and requires typing `RESTORE` to proceed. Restore drill, which should be rehearsed quarterly rather than discovered during an incident: restore the newest dump into a scratch database, run `migrate`, point a staging API at it, and confirm a payment detail page renders with its timeline intact.

The one thing a database restore does not recover is `NATIO_ENCRYPTION_KEY`. Provider credentials and webhook signing secrets are encrypted with it, so it must be backed up separately in your secrets manager. A restored database with a lost key means re-entering every provider credential and rotating every webhook secret.

## Scaling notes

The first bottleneck at growth is not the API but provider latency, and the design already accounts for it: each attempt is a separate row and the orchestrator holds no long transaction across a provider call. The second is webhook delivery, which is why the worker is separate and horizontally scalable.

When a single Postgres primary is no longer enough, the read-heavy surfaces to move to a replica first are the analytics queries (`src/modules/analytics/service.ts`) and the transaction/payment list endpoints. Do not move the orchestrator's reads — it relies on read-your-writes.

The domains are already separated into `src/modules/*` with explicit service boundaries, so payments, routing, providers, risk, reconciliation and webhooks can each be extracted into their own service when the team and traffic justify it. Nothing in the code reaches across a module boundary except through the exported service functions, and the only shared state is the database and the queue.

## Rollback

Images are immutable and the app is stateless, so a rollback is redeploying the previous image tag for `api`, `worker` and `web`. The database is the constraint: because migrations are additive and backward compatible, the previous application version runs against the newer schema. Do not roll the schema back — roll the code back and fix forward.
