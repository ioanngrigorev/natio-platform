# NATIO architecture

## What the system is

NATIO is a payment orchestration layer. A merchant integrates once, against one REST API and one webhook contract; NATIO holds the connections to acquirers, PSPs, banks and local payment methods, decides which of them should process a given transaction, retries elsewhere when one fails, and presents a single view of what happened across all of them.

The boundary that shapes every design decision: **NATIO does not hold or move money**. Funds travel between the merchant and licensed payment providers, which settle directly to the merchant. NATIO records what the providers did. This is why there is no balance ledger that could be drawn against, why settlement rows are labelled with the provider entity that performed them, and why the balances endpoint returns `custodian: false`. The architecture treats a future licensed NATIO entity as simply another provider adapter, so acquiring a licence later does not require rebuilding the core.

The second boundary is card data. NATIO never accepts a PAN or CVV. Card payments are completed on the provider's hosted page or with a provider-issued token, and the schema has nowhere to put a card number — `payment_methods` stores only a provider token plus masked display fields, and validation actively rejects anything that looks like a PAN. This keeps NATIO's PCI DSS scope at SAQ A.

## Shape

A modular monolith in TypeScript, split into two deployables plus Postgres and Redis:

```
                       ┌─────────────────────────────────────────┐
  merchant server ───▶ │ apps/api  (Fastify)                     │
    Bearer sk_…        │   /v1/*         Universal Payment API   │
                       │   /dashboard/*  merchant UI API         │
  browser ───────────▶ │   /admin/*      internal operations API │
    session cookie     │   /health, /openapi.json                │
                       └───────────────┬─────────────────────────┘
                                       │ same codebase, NATIO_PROCESS_ROLE=worker
                       ┌───────────────▼─────────────────────────┐
                       │ worker: webhook delivery, provider sync │
                       └───────────────┬─────────────────────────┘
                                       │
                    PostgreSQL 16 ◀────┴────▶ Redis (BullMQ, rate limits)
                                       │
                       ┌───────────────▼─────────────────────────┐
                       │ provider adapters (src/providers/*)     │
                       │  mock_acquirer · mock_qr · (real PSPs)  │
                       └─────────────────────────────────────────┘

  apps/web (Next.js): natio.me · /docs · /dashboard · /admin
```

Domains live in `apps/api/src/modules/*` — `payments`, `routing`, `providers`, `risk`, `reconciliation`, `webhooks`, `settlements`, `payouts`, `merchants`, `auth`, `audit`, `events`, `transactions`, `analytics`, `idempotency`. Each exposes a service module; nothing reaches into another module's tables directly. The only shared infrastructure is the database and the queue, which is what makes extracting any of them into a separate service later a mechanical change rather than a rewrite.

A monolith was chosen deliberately over microservices for the MVP. A payment that fans out to risk, routing and a provider needs those decisions to be consistent and observable; doing that across five services at this stage buys distributed tracing problems in exchange for nothing.

## The payment path

This is the core flow, and the one the whole design is optimised for.

```
POST /v1/payments
  │
  ├─ API key auth → merchant, project, mode (test|live), optional IP allow-list
  ├─ Idempotency: UNIQUE(merchant, mode, scope, key) + request hash
  │     same key + same body  → replay the stored response
  │     same key + other body → 422    still running → 409
  ├─ payment row, status=created                        [timeline: Payment created]
  ├─ Risk engine (rule-based) → allow | review | block  [timeline: Risk evaluated]
  │     block → failed(risk_blocked)     review → pending, waits for an operator
  ├─ Routing engine → ordered provider candidates       [timeline: Routing evaluated]
  │
  └─ for each candidate, until one succeeds or the policy stops:
        ├─ payment_attempts row (one per provider call, never reused)
        ├─ adapter.createPayment() under a timeout
        ├─ classify: success | requires_action | soft_decline | hard_decline
        │            technical_error | timeout | provider_unavailable
        └─ retry policy decides whether to cascade      [timeline: Fallback initiated]

  success → status successful/authorized, ledger transaction, event → webhook
```

Statuses move only through `applyTransition` in `src/modules/payments/state-machine.ts`, which validates the transition against an explicit table **and** puts the old status in the `WHERE` clause of the `UPDATE`. A concurrent writer that lost the race updates zero rows and gets an error rather than corrupting the state. Every transition is appended to `state_transitions`, which a database trigger makes append-only.

### Why failover does not double-charge

This is the part most likely to cost real money if it is wrong, so the rules are explicit:

- A **hard decline** is never retried. The issuer said no about this instrument; asking a different provider is both futile and, for fraud codes, harmful.
- **Soft declines** and **technical errors** may cascade to the next provider, bounded by the project's `maxAttempts` and by how many eligible providers remain.
- A **timeout is not a failure.** The provider may have processed the payment and lost the response. Before failing over, NATIO calls the provider back (`findPaymentByReference`) and only proceeds if the provider confirms no charge exists. If the provider confirms a charge, NATIO adopts that result instead of retrying. If the provider cannot answer, the attempt is parked as `unknown`, a `provider_sync` job is scheduled, and **no** other provider is tried — the payment waits rather than risking a second charge.

Per-attempt rows with their own provider references are what make this auditable after the fact: reconciliation can match either side, and support can see exactly which provider was asked what, when, and what it said.

### Events and webhooks

Domain events are written to the `events` table in the same transaction as the state change that produced them — a transactional outbox. Delivery rows are created at the same time, and only after the transaction commits are they enqueued. This ordering matters: an earlier version enqueued inside the transaction and the worker could read a delivery row that did not exist yet, losing the notification permanently.

Deliveries are signed `Natio-Signature: t=<unix>,v1=<HMAC-SHA256 of "<t>.<raw body>">`, retried on a fixed backoff (30s, 2m, 10m, 30m, 2h), recorded per attempt with the response status and body, and can be resent manually from either dashboard.

## Routing

`src/modules/routing/engine.ts` is pure: rules and candidates in, an ordered list out, no I/O. That is what makes it unit-testable and what will make an ML ranker a drop-in replacement later — same inputs, same output shape.

Rules are evaluated merchant-scoped before global, then by ascending priority; the first whose conditions all match wins. Conditions cover country, currency, merchant, project, payment method, amount, transaction type, risk score, hour of day, day of week and customer country. The winning rule's provider list is then filtered for eligibility (status, mode, method/currency/country support, amount limits, already-attempted) and ordered by one of three strategies:

- **ordered** — the explicit list. Predictable, the default.
- **weighted** — a deterministic weighted draw seeded by the payment id, so traffic splits are reproducible on replay.
- **score** — ranked by approval rate (weight 40), processing cost (30), provider uptime (20) and latency (10), with account priority as the tie-break. Statistics come from the last 24 hours of real attempts; below five samples a neutral prior is used so a new provider is not judged on noise.

Every decision — the rule, the strategy, every candidate with its eligibility reasons and score factors — is written to `routing_decisions` and surfaced on the payment. "Why did this go to provider B?" is always answerable.

## Provider adapters

Every connector implements one interface (`src/providers/types.ts`): `createPayment`, `getPayment`, `capturePayment`, `cancelPayment`, `refundPayment`, `createPayout`, `getPayout`, `verifyWebhook`, optional `findPaymentByReference` and `healthCheck`. Provider-specific behaviour never leaks into the orchestrator; the orchestrator only sees the normalised outcome vocabulary and the ~27-code failure dictionary in `src/providers/failure-codes.ts`, each classified soft / hard / technical / policy. That classification is what the retry policy reads, so adding a provider means mapping its codes into the dictionary, not touching the engine.

Adding a provider is: implement the interface, register it in `src/providers/registry.ts`, insert a `providers` row with that `adapterKey` and a `provider_accounts` row with encrypted credentials. No core changes.

Three mock providers ship with the platform — Demo Acquirer A, Demo Acquirer B and a Demo QR provider — and they are not stubs returning canned values. They keep their own ledger, answer status lookups, honour capture/cancel/refund, complete asynchronously through a simulated hosted page, and emit signed webhooks back to NATIO. That is what makes the sandbox capable of demonstrating the full failover and reconciliation story before any commercial agreement exists.

## Data model

Money is `bigint` in minor units, never floating point. Every financial object carries immutable history: `state_transitions` for status changes, `payment_events` for the human-readable timeline, `events` for the outbox, `audit_logs` for who did what, and `transactions` as the ledger. Database triggers (`0001_immutability.sql`) reject `UPDATE`/`DELETE` on the append-only tables and reject changes to the financial fields of `transactions`; corrections are new `adjustment` rows.

Roughly: `merchants` → `projects` → `api_keys`, with `payments` → `payment_attempts` → `transactions`, plus `refunds`, `payouts`, `providers` → `provider_accounts`, `routing_rules` → `provider_routes` → `routing_decisions`, `risk_rules` → `risk_decisions`, `settlements` → `settlement_items`, `reconciliation_batches` → `reconciliation_items`, and `webhook_endpoints` → `webhook_deliveries` → `webhook_delivery_attempts`.

Tenancy is enforced in every query by `merchant_id` and `mode`, never by object id alone — including pagination cursors, which resolve within the caller's tenant.

## Reconciliation and settlement

`reconcile()` is another pure function: NATIO's transactions and the provider's report in, categorised items out — `MATCHED`, `MISSING_PROVIDER`, `MISSING_NATIO`, `AMOUNT_MISMATCH`, `STATUS_MISMATCH`. Matching works on the provider reference or NATIO's own reference, with status normalisation across provider vocabularies. CSV import works today; the same function takes rows from a provider API when one is connected.

Settlements are recorded as what a provider reported paying, attributed to the provider entity that performed the settlement, with the constituent transactions linked. The UI keeps the four concepts visibly distinct — payment, provider, settlement, merchant — because conflating them is how a merchant ends up believing NATIO holds their money.

## Security posture

Summarised here, detailed in `docs/SECURITY.md`: scrypt password hashing, SHA-256-hashed API keys and session tokens, AES-256-GCM for provider credentials and webhook secrets, CSRF tokens on every state-changing browser route, RBAC enforced server-side for both merchant roles (owner/admin/developer/finance/analyst/support/viewer) and admin roles, per-project IP allow-lists, rate limiting, SSRF protection on outbound webhook URLs re-checked at delivery time, and structured audit logging of every sensitive action. Production configuration is validated at startup and the process refuses to boot if it is unsafe.

## Testing

209 tests. The pure cores — state machine, routing, retry decisions, risk evaluation, reconciliation matching, webhook signatures, permissions, IP/CIDR handling — are unit tested exhaustively, which is possible precisely because they have no I/O. On top of that an end-to-end suite runs against a real PostgreSQL: it registers, authenticates, creates payments through every failure scenario, verifies failover produces exactly two attempts with the right outcomes, checks the timeline ordering, replays idempotency keys, receives real signed webhooks on a local HTTP listener and verifies the signatures, exercises refunds, captures, payouts, admin review and provider simulation.
