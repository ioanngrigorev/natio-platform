# Backend, frontend and resilience review — 23 October 2026

This review covers the API, worker, browser transport, server rendering, deployment
configuration and the automated regression suite. All destructive/failure-injection
tests use synthetic fixtures, a loopback `natio_test` database and disposable Redis.
No live payment or external support message is part of these tests.

## Defects corrected

| Boundary | Failure before this change | Result after this change |
|---|---|---|
| Payment idempotency | An exception or a lock older than 60 seconds could delete the reservation, allowing a retry to repeat a committed operation. | Unknown outcomes retain their reservation, even beyond TTL. Stable 4xx errors replay; stale unknown outcomes return a reconciliation-required error. |
| Transaction → queue | Redis failure after the database commit surfaced as payment failure; an unscheduled delivery could remain pending forever. | PostgreSQL outbox remains authoritative. A worker scans due deliveries every 30 seconds in batches of 100 and republishes missing jobs. |
| Webhook worker | A crashed worker left `delivering` rows stuck; a manual resend could race an active send. | A five-minute lease, monotonic attempt reservations, fenced completion and transactional attempt/result persistence permit bounded recovery. Active resends return 409. |
| Retry scheduling | A stale queued job could bypass `next_attempt_at` and the retry budget. | Atomic claims enforce due time, status and remaining attempts. Manual resend intent is stored durably. |
| Redis connection | One unlimited-retry connection served both workers and HTTP producers. | Separate connections: workers reconnect; producers have a 2.5-second publication deadline. Late publication is possible and safe because consumers claim database state. |
| Database restart | An idle pool connection error could be an unhandled EventEmitter error. | The pool handles idle errors and reconnects; connection acquisition is bounded. |
| Readiness | Queue health always reported `ok`; the probe itself depended on Redis rate limiting. | `/health` checks PostgreSQL and Redis concurrently, returns 503 when degraded, is not rate limited, and does not cache results. |
| Browser / SSR API client | Fetch/body waits were unbounded and HTTP 200 HTML could become `null`. | One deadline covers headers and body. Cancellation, malformed responses, request IDs and Retry-After are explicit. Mutations are never automatically retried. |
| Test / Live | `?mode=live` overrode an explicit `X-Natio-Mode: test`. | An explicit valid header wins. |
| Session logout | A logged-in session could be revoked without a CSRF token. | Both admin and merchant logout validate CSRF before revocation. |
| Error display | A layout failure could bypass the page boundary, and exception text could be rendered directly. | Parent boundaries cover session loading. Shared localized recovery UI shows a correlation reference, not arbitrary internal exception text. |
| Production image | The web image built `/api/*` rewrites with a localhost default; an install failure could silently abandon the lockfile. | The build explicitly targets the internal API service. Docker dependency installs require the committed lockfile. |
| Dependencies | The production dependency audit reported known advisories in the old framework and transitive packages. | Next.js 15.5.28, React 19, Fastify 5.12.6 and parser/source-map fixes are pinned by the lockfile. The request API migration uses awaited cookies, headers and route parameters, without unsafe compatibility casts. |

## Invariants reviewers should preserve

1. **A timeout is not proof of rollback.** Do not clear unknown idempotency
   reservations or automatically retry a payment with another key. Reconcile the
   PSP reference, payment timeline and ledger first. The raw key/body is not logged.
2. **Webhook delivery is at least once.** A receiver may acknowledge a request just
   before our worker crashes. It must deduplicate `natio-event-id` (and verify its
   signature). A lease/fence protects NATIO's database; it cannot undo a remote HTTP
   side effect. There is no exactly-once claim across the network.
3. **Persist financial state and its outbox in one transaction.** Queue publication
   is a delivery optimization after commit, not evidence that the payment failed.
4. **Do not steal a live worker's result.** Completion writes match status, reserved
   attempt number and lease timestamp. Changing only the status check loses fencing.
5. **Unknown PSP outcomes do not cascade.** Existing provider polling is bounded and
   eventually requires manual review. Redis AOF protects queued sync jobs, but a
   provider-sync enqueue failure/process crash still requires operational reconciliation;
   the new database recovery scan covers webhook deliveries, not PSP polling jobs.
6. **Readiness is not high availability.** A healthy API can still have a stopped
   worker. The worker heartbeat is checked separately. The current single host is
   a failure domain; this patch does not add replicas or cross-region failover.
7. **No shared user cache.** SSR forwards request-local cookies/mode with `no-store`.
   React cache for session/locale is request scoped. Do not move session results into
   a global TTL cache.

## Automated checks

- Existing financial/domain regression: ledger immutability, payment/refund/payout
  flows, routing/cascading, pricing, risk, webhook signatures, receipts, plans and
  usage billing, development workflows, crypto/chain watch, analytics and exports.
- New integration cases: concurrent idempotency requests; crash after side effect;
  stale/expired unknown reservations; deterministic error replay; queue-publication
  failure; concurrent webhook claims; backoff/budget enforcement; crashed and resumed
  workers; fenced stale completion; bounded response previews; durable manual resend;
  database readiness failure/recovery; malformed JSON and correlation IDs.
- A real disposable Redis process is stopped and restarted. The suite checks degraded
  readiness, bounded producer failure, worker reconnection and resumed processing.
- A real Next.js server proxies requests to a real Fastify server on loopback. Tests
  cover login cookies, mode precedence, CSRF, multipart validation, admin pages,
  merchant pages and plan gates, Arabic RTL, microphone policy and logout revocation.
- Frontend tests cover request cancellation/timeouts, transport error contracts,
  JSON/multipart bodies, legacy Gantt rows, phase durations, safe error UI and BPMN
  semantics/geometry. These are not a substitute for browser interaction checks.
- Type checking and production builds include both applications. Dependency audit
  is separate from functional testing; a clean advisory report is not a penetration test.

Run on Node 22 with the pinned package manager:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
NATIO_E2E_DATABASE_URL=postgres://natio:natio@127.0.0.1:5432/natio_test corepack pnpm test
API_INTERNAL_URL=http://api:4000 corepack pnpm build
corepack pnpm audit --prod
```

`redis-server` must be on PATH, or set `NATIO_TEST_REDIS_BIN`. Integration tests refuse
non-loopback URLs and any database name other than `natio_test`; they reset its schema.
The new GitHub Actions workflow uses PostgreSQL 16 and a disposable Redis process,
runs types/tests/builds on each PR and on `main`, and needs no production secrets.
Configure the resulting workflow check as a required branch-protection check if the
repository's plan supports it; adding a workflow alone does not enforce merge policy.

## Deployment and incident notes

Migration `0015_webhook_recovery` is additive: one boolean and two partial indexes.
Old binaries ignore the new column, so rollback keeps the migration installed.
Create and verify a database backup, retain the previous images, apply migration
under the migrator role, then roll API/worker/web. Runtime remains the app role.
For very large outboxes, create the indexes concurrently in a separately controlled
migration; the transactional migration is appropriate only after checking table size.

Check `/health`, the worker heartbeat, container restarts, outbox age, exhausted
webhooks, unknown PSP attempts and `idempotency_recovery_required`. Do not infer that
HTTP 200 alone proves every dashboard widget or third-party integration is healthy.

Operational reconciliation of a stuck payment must inspect the original PSP and
ledger evidence before resolving the reservation. Keep a record of the actor,
reason, PSP result and linked payment; do not delete unknown keys as a retry shortcut.
There is deliberately no new public API for force-unlocking a payment.

Further infrastructure work: independent backup/restore drills, alert delivery,
redundant hosts/databases/Redis, durable PSP-poll scheduling, load tests against
realistic concurrent traffic and certification against each live PSP. Real-money
failover, physical microphone capture and third-party outages are not simulated on
production during this review.

Migration reference: [Next.js 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15).
