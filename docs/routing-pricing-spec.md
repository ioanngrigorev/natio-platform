# Routing, cascading and dynamic pricing

Status: implementation complete; release validation in progress. Production receipt review is available separately under Finance.

## Product scope

Backend execution and frontend controls, not a presentation-only simulator. All new configuration and
examples in this release target Test Data. No real PSP calls, customer documents or new bulk financial
imports are authorized. Existing 2025 demo history remains unchanged.

- Infrastructure: route eligibility, ranked/ordered/weighted strategies, cascade controls and explainable simulator.
- Finance: amount-based merchant tariffs and PSP cost schedules, versioned publishing and quote breakdown.
- Payment detail: selected route, attempts, applied tariff versions, merchant commission, PSP cost and margin.
- Read-only investors may simulate and inspect; existing authorized operations roles manage configuration.

## Market evidence and decisions

Primary documentation reviewed 22 October 2026:

- [Stripe decline codes](https://docs.stripe.com/declines/codes): authentication, invalid details,
  insufficient funds and issuer unavailability need different responses. A generic soft-decline label
  is insufficient for deciding whether to cascade automatically.
- [Stripe advanced error handling](https://docs.stripe.com/error-low-level): network failures and server
  errors may have side effects. Preserve an operation's idempotency identity and reconcile unknown
  outcomes before starting another payment attempt.
- [Adyen refusal reasons](https://docs.adyen.com/development-resources/refusal-reasons/): HTTP success
  is distinct from payment success; use normalized result/advice fields. Keep detailed refusal evidence
  in operations rather than exposing fraud-specific reasons to shoppers.
- [Hyperswitch smart retries](https://github.com/juspay/hyperswitch-docs/blob/main/features/smart-retries.md):
  alternative-processor retries require explicit attempt limits and differ from flows requiring new
  customer authentication. Each attempt must be traceable to one logical payment.

Recommended profiles: balanced approval/cost; conversion-first; cost-first with reliability constraints;
explicit priority order; deterministic weighted allocation. Routing must first satisfy currency, method,
country, merchant ownership, amount limits, operational availability and safety constraints. A score
never overrides eligibility or a no-retry instruction.

## Execution safeguards

- Preserve logical payment identity; record each attempt separately and avoid concurrent orchestration.
- Final hard refusal / fraud / do-not-retry advice: stop.
- Authentication or changed customer details: require customer action, never silently route around it.
- Insufficient funds / generic issuer refusal: no immediate blind cascade.
- Known-safe technical refusal / eligible issuer-unavailable response: bounded alternate route.
- Timeout, unclassified transport error, duplicate or indeterminate result: hold for status reconciliation.
- A momentary not-found is insufficient unless the adapter guarantees a final no-charge outcome.
- Maximum attempts and latency budget cap the cascade; no retry loops or repeated account attempts.
- Routing health statistics are scoped by mode and distinguish settled approvals from pending authentication.
- Store decision explanations and configuration/pricing snapshots with attempts.

## Tariff semantics

The user confirmed BOTH merchant commission and PSP cost. Each schedule has one currency; no implicit FX.
Amount intervals select a rate for the whole transaction, not progressive cumulative billing.
Calculate percentage plus fixed fee in integer minor units, round half-up, then apply optional minimum
and maximum. Validate precision, contiguous non-overlapping brackets, dates and conflicting scope/priority.
Merchant/provider overrides outrank global rules; unresolved equal-precedence matches must not be guessed.

Publishing creates an immutable version. Changes affect future quotes; captured history is never repriced.
Quotes show merchant fee, provider cost, net amount and margin, including their tariff/version sources.
Unknown price is not zero. Existing account fee settings are an explicitly labelled legacy fallback.
Authorization/capture uses a frozen tariff version; partial capture applies that version's brackets to
captured amount. This release prices successful processing; refunds, taxes and FX are not implicitly added.

## Regression plan

- Unit: amount boundaries, precision/rounding, zero/three-decimal currencies, caps, conflicting plans,
  ranking strategies, eligibility and refusal/advice matrix, retry/latency limits.
- Integration: version publication and concurrent edits, immutable snapshots, quote-to-execution parity,
  unknown timeout remains processing, successful/declined/cascaded/captured payments, duplicate requests.
- API: authentication, CSRF, role boundaries, mode isolation, merchant scope, invalid inputs and exports.
- Frontend: route/pricing forms, simulations, payment drill-down, Finance receipt flow, existing navigation,
  BI filters/exports, themes and mobile layouts; inspect browser console and production service logs.
- Use a dedicated disposable test database for destructive/resetting suites. Never point those suites at production.
- Record actual passed checks and any remaining limits in a release report; do not claim all possible bugs are excluded.

## Delivered implementation

### Backend

- `routing/engine.ts` owns eligibility and deterministic ranking. Unknown geography cannot bypass a
  country restriction; manual capture requires PSP support. A matching empty ordered/weighted rule
  fails closed. An empty score chain intentionally evaluates all eligible accounts.
- Profiles use transparent weights: balanced (cost 30 / approval 40 / uptime 20 / latency 10),
  conversion (10/65/20/5), cost (65/15/15/5), reliability (5/25/55/15).
- Recent health is isolated by Test/Live mode. Pending authentication is not counted as an approval.
  Defaults are labelled as priors for sparse history. Optional minimum sample, approval, uptime and
  maximum latency gates exclude candidates before scoring; negative margin can also exclude them.
- `cascade.ts` evaluates normalized result, code, provider advice, charge evidence, method, remaining
  candidates, attempt cap and elapsed-time budget. A fresh not-found lookup does not prove absence.
  Unknown transport errors stay processing and use bounded status synchronisation; unresolved cases
  raise an operational event. Failed finalization is forbidden while an attempt remains unresolved.
- Short database row locks serialize creation of attempts for the same payment. No database transaction
  spans a PSP network request. Stale-attempt notifications cannot overwrite the current attempt.
- `pricing/engine.ts` calculates both fees with integer arithmetic and half-up rounding. Tariff rate is
  integer basis points; legacy account rates retain their four decimal places. No cross-currency sums.
- Tariff precedence: merchant/account scope, then method, then country, then lowest numeric priority.
  Equal-precedence overlaps are rejected. Brackets cover [0, infinity) without gaps, with exclusive upper
  bounds. Effective dates use [from, until), UTC. Drafts may be edited with optimistic versions.
- Publishing locks pricing configuration, checks overlaps, and writes audit evidence. Immediate replacement
  of the previous version in the same family can retire/publish atomically. Scheduled versions require
  non-overlapping effective intervals. Database triggers protect published terms and attempt snapshots.
- Each selected attempt stores both tariff sources/versions and complete terms. Successful payment/ledger
  fee is the merchant commission; attempt fee is PSP cost. Partial capture recalculates using the frozen
  version's brackets. Admin payment detail displays both values and gross margin; merchant responses do
  not include internal PSP pricing snapshots.
- `seedPricingDemo()` is opt-in, idempotent by named configuration and always Test Data. It creates synthetic
  tariffs for EUR, USD, GBP, JPY, INR and VND, sample PSP overrides, EUR/USD amount rules and disabled
  ordered/weighted examples. It does not insert payments, transactions, balances or documents.

### API and frontend

- Finance → `/admin/pricing`: tariff library, filters, draft editor, amount brackets, version cloning,
  publishing/retirement, scope links, PSP search and backend fee/margin calculator with an exact-value curve.
- Infrastructure → `/admin/routing/studio`: parameter and failure scenarios, saved-policy simulation or
  explicit unsaved preview, ranked provider links, price evidence, health sample and exclusion reasons.
- Existing `/admin/routing` editor persists profile, health constraints, retry limits and provider chains.
  PSP search covers the full catalog. Readonly users can inspect rules; mutations retain existing RBAC.
- `GET/POST /admin/pricing`, `PATCH /admin/pricing/:id`, `POST /admin/pricing/quote`,
  `GET /admin/payments/:id/pricing`; routing APIs remain backward compatible with optional `policy`.
- Simulation and quoting create no payment and call no external PSP. All writes require the existing
  admin permission and CSRF checks. No investor role or production credential was broadened.

## Deliberate boundaries

This release implements payment routing and amount-based charges on successful capture. It does not
certify real PSP adapters, change payout pricing, introduce FX, tax, monthly volume tiers, refund fees,
fees per failed attempt, or automatic accounting for those costs. Gross margin excludes these items.
Health gates use observed 24-hour attempts, not an externally certified uptime SLA or learned model.
Provider `dailyVolume` remains a legacy informational setting; this release enforces per-payment min/max
and the new policy gates, not a cross-currency daily reservation system. Existing 2025 records retain
recorded amounts and have no fabricated retrospective tariff snapshot. The calculator evaluates the
currently published tariff set at a selected effective date; historical execution evidence comes from
payment snapshots, not reconstructed current configuration.

## Regression record

Automated suite: 428 passing checks across 28 unit/integration files, covering existing payments,
refunds, payouts, wallets, chain watchers, encryption guards, reporting and receipt routes plus new
routing/pricing cases. API and web type checks passed; Next.js production build passed. Browser checks
on the isolated local demo confirmed tariff draft/save/publish/retire, calculator/curve, policy
create/reopen, unknown-timeout hold and insufficient-health exclusion. The Linux release image passed
an additional PostgreSQL 16 run: migrations, idempotent configuration seeding, route simulation,
merchant/PSP fee separation, immutable snapshots and four cascade outcomes. Production smoke results
are recorded in the deployment verification report.
