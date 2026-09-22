# NATIO

**Payments. Orchestrated.** One API, multiple payment rails, intelligent routing.

NATIO is a payment orchestration platform. A merchant integrates once; NATIO connects to acquirers, PSPs, banks and local payment methods, routes each transaction to the best provider, fails over safely when one is down, and gives one view of payments, payouts, settlements and reconciliation across all of them.

NATIO is a technology layer, not a financial institution. Funds move between the merchant and licensed payment providers, which settle directly to the merchant. NATIO never holds customer funds and never touches card data — card payments are completed on a PCI-compliant provider's hosted page or with a provider token, keeping NATIO at SAQ A scope.

## Quick start

Requirements: Node 20+, pnpm 10, PostgreSQL 16, Redis 7. (Or just Docker — see below.)

```bash
pnpm install
cp .env.example .env                      # generate the two secrets it asks for
pnpm db:migrate
pnpm db:seed -- --demo-traffic=80         # demo merchant, 3 mock providers, sample traffic
pnpm dev                                  # API on :4000, web on :3000
```

With Docker:

```bash
cp .env.example .env
docker compose up -d --build
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed
# http://localhost:8080
```

The seed writes credentials to `apps/api/.sandbox-credentials.json` (git-ignored). Defaults: merchant `owner@demo-merchant.local`, admin `admin@natio.local`, password from `SEED_DEMO_PASSWORD`.

## The end-to-end flow

One request demonstrates the whole platform — routing, a provider failure, automatic failover to a second provider, a recorded transaction and a signed webhook:

```bash
curl -X POST http://localhost:4000/v1/payments \
  -H "Authorization: Bearer natio_sk_test_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-001" \
  -d '{"amount":10000,"currency":"USD","payment_method":"card",
       "country":"US","test_scenario":"failover"}'
```

```
Payment created → Risk evaluated: ALLOW → Routing rule evaluated: Cards → Acquirer A,
fallback Acquirer B → Acquirer A selected → Request sent → Provider technical error →
Fallback initiated → Acquirer B selected → Request sent → Payment successful →
Webhook queued for merchant
```

`GET /v1/payments/{id}/timeline` returns exactly that, and the merchant dashboard renders it on the payment page. Other scenarios (`GET /v1/test/scenarios`) cover soft/hard declines, timeouts, recovered timeouts, provider outages, total failure, risk review and risk block.

## What is in the box

**Merchant-facing** — Universal Payment API (payments, capture, cancel, refund, payouts, transactions, balances, settlements, payment methods, webhook testing) with idempotency, API versioning, structured errors, rate limiting and request ids. Dashboard with overview, payments and per-payment timeline, transactions, payouts, settlements, reconciliation, analytics, developer tools, API keys, webhooks, team and settings. Developer portal with quickstart, guides and an API reference rendered live from the OpenAPI spec.

**Platform-facing** — Internal admin for merchants, KYB, payments (including manual review and orchestration resume), providers with health and outage simulation, a routing rule builder with a live route simulator, risk rules, settlements, reconciliation, system events, webhook deliveries, users and a full audit log.

**Engine** — Deterministic routing (ordered / weighted / score strategies), retry and failover with double-charge protection, a strict payment state machine with append-only history, a rule-based risk engine, a reconciliation engine, and a provider adapter architecture with three functional mock providers.

## Repository layout

```
apps/api/           Fastify API + workers (modular monolith)
  src/modules/      payments, routing, providers, risk, reconciliation,
                    webhooks, settlements, payouts, merchants, auth, audit, …
  src/providers/    adapter interface, registry, mock providers, failure dictionary
  src/db/           Drizzle schema, SQL migrations, sandbox seed
  test/             209 tests (unit + end-to-end against real PostgreSQL)
  openapi/          OpenAPI 3.1 document
apps/web/           Next.js 14: natio.me, /docs, /dashboard, /admin
deploy/             Caddyfile, backup/restore scripts, DB role hardening
docs/               SPECIFICATION.md, ARCHITECTURE.md, DEPLOYMENT.md, SECURITY.md
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API and web with hot reload |
| `pnpm build` | Build both apps |
| `pnpm test` | Full test suite |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm db:migrate` | Apply migrations (idempotent) |
| `pnpm db:seed` | Sandbox data; `-- --demo-traffic=N` for sample payments |
| `pnpm --filter @natio/api run db:reset` | Drop, migrate, seed (development only) |

## Adding a payment provider

Implement the `ProviderAdapter` interface (`apps/api/src/providers/types.ts`), register it in `src/providers/registry.ts`, then create a `providers` row pointing at that adapter key and a `provider_accounts` row with credentials (encrypted at rest). Map the provider's decline codes onto the shared failure dictionary so the retry policy classifies them correctly. No changes to the orchestration engine are required.

The architecture is prepared for global and local providers alike. NATIO is not affiliated with, endorsed by, or a partner of any payment provider unless and until such an agreement is signed and disclosed.

## Documentation

- [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) — **normative**: invariants, contracts, the state machine, what is deliberately not built. A change to any contract updates it in the same commit.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, the payment path, failover safety, data model
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production deployment, domains, migrations, backups, monitoring
- [`docs/SECURITY.md`](docs/SECURITY.md) — security model, controls, review findings, known gaps
- `/docs` in the running app — developer portal and live API reference

## Status

MVP. Phase 1 (authentication, merchants, dashboard, payments, transactions, provider adapters, three mock providers, routing engine, retry/failover, webhooks, API keys, developer API, admin, audit log) is complete and tested, as is Phase 2 (payouts, reconciliation, settlements, analytics, risk engine, provider monitoring). Phase 3 — real PSP integrations, ML-assisted routing, multi-region — requires commercial agreements and is not implemented.

Before production: complete the database role separation in `deploy/postgres-init/`, move secrets into a managed secrets manager, and read the "not yet implemented" section of `docs/SECURITY.md`.
