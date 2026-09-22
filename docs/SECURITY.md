# NATIO — Security

This document describes how the NATIO payment orchestration platform is secured, what was found
during the adversarial review of 22 September 2026, and what is deliberately not in place yet.

It is written for engineers working on the codebase and for reviewers assessing it. Everything
claimed here was verified against a running instance (API on `:4000`, web on `:3000`) rather than
inferred from the code alone.

---

## 1. Security model

### 1.1 What NATIO is, and what that means for risk

NATIO routes payments and payouts to external providers. It is an **orchestrator, not a custodian**
and **not a cardholder-data environment**:

* Money is never held by NATIO. Balances are derived from the transaction ledger and every balance
  response carries `custodian: false` (`src/modules/settlements/service.ts`, `/v1/balances`).
  Settlement happens between the provider and the merchant.
* Card data never reaches NATIO. The API accepts a **provider token** and a **masked display**
  string; a hosted page or the provider's own SDK collects the PAN. The sandbox hosted page
  (`src/http/routes/public.ts`) is explicit that "a real provider would show its PCI-compliant
  checkout here".

The consequences are that the highest-value assets in the system are: *provider credentials*,
*webhook signing secrets*, *API keys*, *session cookies*, and *the integrity and confidentiality of
one merchant's financial history against every other merchant*. The review was weighted accordingly.

### 1.2 Trust boundaries

| Boundary | Enters via | Authenticated by | Authorised by |
|---|---|---|---|
| Public API | `/v1/*` | `Authorization: Bearer sk_{test,live}_…` (`src/http/guards.ts:requireApiKey`) | merchant + project + mode carried on the key; optional project IP allow-list |
| Merchant dashboard | `/dashboard/*` | `natio_session` cookie (`requireMerchant`) | merchant role → `Permission` set (`src/modules/auth/permissions.ts`) |
| Internal admin | `/admin/*` | `natio_admin_session` cookie (`requireAdmin`) | admin role → `AdminPermission` set |
| Unauthenticated | `/health`, `/openapi.json`, `/public/contact`, `/providers/webhooks/:accountId`, `/sandbox/*` | none, or a provider HMAC | rate limits; signature verification on provider webhooks |
| Outbound | webhook delivery, provider adapters | NATIO signs; provider verifies | SSRF allow/deny on the destination |

The browser never talks to the API cross-origin. `apps/web/next.config.mjs` rewrites `/api/:path*`
to the API service, so cookies stay first-party and the CORS surface is a single configured origin
(`CORS_ORIGINS`). That rewrite is a transport convenience only — it grants no authority, and every
route behind it enforces its own authentication.

### 1.3 Sessions and CSRF

Session tokens are 48 characters from a 62-symbol alphabet (~285 bits) generated with
`crypto.randomBytes`, stored only as SHA-256 (`sessions.token_hash`, unique index) and never
logged. Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true` (enforced in
production by `src/config.ts`). A fresh token is minted on every login, so a session cannot be
fixated.

Because `SameSite=Lax` still permits top-level GET navigation, every state-changing dashboard and
admin request additionally requires an `X-CSRF-Token` header matching a per-session random token,
compared with `timingSafeEqual` (`src/http/guards.ts:checkCsrf`). This was exercised against the
live server: a `POST` with no header and a `POST` with a wrong header both return
`403 forbidden / "Missing or invalid CSRF token"`; only the correct token succeeds.

Sessions are revoked when a user is disabled (`setUserStatus`), on logout, and — since this review —
on password change. `resolveMerchantSession` / `resolveAdminSession` re-read the user and the
merchant on every request, so a disabled account or a role change takes effect immediately without
waiting for the session to expire.

Passwords are hashed with scrypt (N=2¹⁵, r=8, p=1, 64-byte output) and verified with
`timingSafeEqual`. Failed logins are counted per account and lock it for 15 minutes after 8
failures. Login responses are indistinguishable between an unknown address and a wrong password:
the same message, and a dummy scrypt verification keeps the timing flat (measured: 96–100 ms for
both cases across repeated samples).

### 1.4 Tenant isolation

Every query that can return merchant-owned data takes a `merchantId` and applies it as a `WHERE`
predicate; object-by-id routes 404 rather than 403 so that ids are not confirmed to a stranger.
This was tested by registering a second merchant through `POST /dashboard/auth/register` and
attempting to read and mutate the demo merchant's objects by id across every `:id` route —
payments, capture, cancel, refund, payouts, payout cancel, settlements, webhook endpoints and
deliveries (read, patch, delete, rotate-secret, resend), reconciliation batches, API keys, projects,
team members and audit entries. All returned `404` or an empty result. One route did **not** hold
(finding H-1) and has been fixed.

API keys carry merchant, project and mode. A test key cannot see live rows (`mode` is a predicate
on every list and detail query) and cannot reach another merchant's or another project's objects —
verified by creating a payment as merchant B and requesting it with merchant A's key (`404`).

### 1.5 Secrets at rest

| Secret | Storage | Ever returned? |
|---|---|---|
| Provider credentials | AES-256-GCM, `provider_accounts.credentials_enc` | No — serialiser emits `has_credentials: boolean` only (`src/modules/providers/service.ts:serializeAccount`) |
| Webhook signing secret | AES-256-GCM, `webhook_endpoints.secret_enc` | Once, at creation and rotation. Afterwards only an 11-character `secret_prefix` |
| API key | SHA-256, `api_keys.key_hash` (unique) | Once, at creation. Afterwards only the 12-character `prefix` |
| Passwords | scrypt | Never |
| Session / invite tokens | SHA-256 | Never |

Ciphertext format is `v1.<iv b64>.<tag b64>.<ciphertext b64>` (`src/lib/crypto.ts`). The AEAD tag
means tampered ciphertext fails to decrypt rather than decrypting to attacker-chosen plaintext.

`src/lib/logger.ts` redacts `authorization` and `cookie` headers and any `*.password`,
`*.passwordHash`, `*.secret`, `*.credentials`, `*.credentialsEnc`, `*.secretEnc`, `*.token` field.
No call site logs a request body.

`src/modules/audit/service.ts:redact()` strips any key matching
`/password|secret|credential|token|hash|cvv|pan/i` from the `before`/`after` snapshots before they
are written. This matters because `updateEndpoint` passes the whole existing row as `before`, which
includes `secret_enc`. Verified live: the resulting audit row stores `"[redacted]"`. A scan of the
whole `audit_logs` and `system_events` tables for encrypted blobs, `whsec_`, `natio_sk_test_`/`natio_sk_live_`
and `scrypt$` found only the deliberately public 12-character API key prefix.

Secrets are shown in the UI exactly once, in client component state after the POST that created
them (`apps/web/components/dashboard/modal.tsx:SecretReveal`). They are never part of a server
component payload: fetching `/dashboard/api-keys` server-rendered HTML and grepping for
`sk_…`/`whsec_…` returns nothing.

### 1.6 Financial integrity

Four mechanisms, layered:

1. **Idempotency.** `POST /v1/payments` and the other mutating endpoints accept `Idempotency-Key`.
   The key is claimed by an `INSERT … ON CONFLICT DO NOTHING` against a unique index on
   `(merchant_id, mode, scope, key)`, so the claim is decided by the database, not by the process
   (`src/modules/idempotency/service.ts`). Replays with the same payload return the stored response;
   a different payload returns `422 idempotency_key_reused`; a concurrent request returns
   `409 idempotency_in_progress`. Six truly parallel creates with one key produced **one** `201` and
   five `409`s, and exactly one payment row.
2. **State machine with a database guard.** `applyTransition` validates the edge against
   `PAYMENT_TRANSITIONS` / `REFUND_TRANSITIONS` / `PAYOUT_TRANSITIONS` and then writes with
   `WHERE id = ? AND status = <from>`, incrementing `payments.version`. A lost race updates zero
   rows and raises `invalid_state_transition` (`src/modules/payments/state-machine.ts`). Four
   parallel captures of one authorised payment produced one `200`, one `409` and two provider-level
   declines — one capture, one ledger row.
3. **Failover safety rule.** A technical error, an unavailable provider or a decline where the
   provider created no charge may fail over. A **timeout may not**, unless a follow-up lookup
   confirms the provider has no record of the payment; otherwise the attempt is left `unknown` and a
   provider sync is scheduled (`src/modules/payments/orchestrator.ts`, `shouldRetry` with
   `timeoutResolvedSafe`). This is what prevents a double charge across two providers.
4. **Append-only history.** Database triggers reject `UPDATE`/`DELETE` on `state_transitions`,
   `audit_logs`, `payment_events` and `events`; `transactions` allows only late settlement linkage
   and rejects any change to amount, currency, type, merchant, entity, fee, net or occurrence time;
   `payment_attempts` cannot have a `provider_payment_id` rewritten
   (`src/db/migrations/0001_immutability.sql`). Verified by issuing each statement directly through
   `psql` as the application role — every one was rejected with
   `integrity_constraint_violation`.

### 1.7 Webhooks

**Outbound.** Each endpoint has its own secret. Deliveries carry
`Natio-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<raw body>")>`, plus event id, type,
delivery id and attempt number. Deliveries are claimed with a conditional `UPDATE … WHERE status IN
('pending','failed')` so two workers cannot send the same delivery twice, retried with capped
exponential backoff (30 s → 2 h) and `fetch(… redirect: "manual")` so a 30x is recorded as a failure
rather than followed to a new host.

Destination URLs are checked by `src/lib/net.ts:validateOutboundUrl` — https only (http allowed
outside production), no embedded credentials, no `localhost`/`.local`/`.internal`, no literal or
resolved private, loopback, link-local, CGNAT or unspecified address. Tested against
`169.254.169.254` (IPv4, decimal-encoded and hex-encoded forms), `127.0.0.1`, `0.0.0.0`, RFC1918
ranges, CGNAT, IPv6 loopback/ULA/link-local, IPv4-mapped IPv6, a public hostname that resolves to
`127.0.0.1`, and URLs carrying credentials: all rejected. Since this review the same check also runs
**at delivery time**, closing the window where DNS is repointed after registration (finding M-4).

**Inbound.** `/providers/webhooks/:accountId` keeps the JSON body as a raw string via a scoped
content-type parser so the adapter verifies the HMAC over the exact bytes received
(`src/http/routes/public.ts`, `src/providers/mock/mock-adapter.ts:verifyWebhook`, `safeEqual`).
Verified: the correct signature over the exact body is accepted; the same signature with the amount
changed from 100 to 999999 is rejected; the same signature over a semantically identical but
whitespace-reformatted body is also rejected — which is the proof that raw bytes, not a
re-serialised object, are what gets signed. Rejections are recorded as `webhook.rejected` system
events.

### 1.8 Injection

Every query is built with Drizzle's tagged `sql` templates or its expression builders, so all
user-supplied values become bind parameters. There is exactly one `sql.raw(` in the codebase
(`src/modules/analytics/service.ts:89`) and its argument is a two-valued ternary
(`'hour'`/`'day'`), not user input. Search paths use `ilike()` with the pattern as a parameter, and
the audit filter uses `sql\`… ILIKE ${"%"+action+"%"}\`` — also a parameter. Pagination cursors are
bound values inside a scalar subquery; since this review that subquery is additionally scoped to the
caller's merchant (finding L-3).

### 1.9 Rate limiting and resource limits

* Global limiter (`src/server.ts`), Redis-backed when configured, with separate buckets and budgets
  for `/v1` (`RATE_LIMIT_API_PER_MINUTE`) and the browser surfaces
  (`RATE_LIMIT_DASHBOARD_PER_MINUTE`), so API traffic cannot starve the dashboard.
* Tighter per-route limits on authentication (`RATE_LIMIT_AUTH_PER_MINUTE`, default 10/min) and on
  the public contact form (5/min).
* JSON body limit 1 MB; multipart limited to one file of 10 MB; reconciliation CSVs additionally
  capped at 50 000 rows (finding L-4).
* `getBatchDetail` caps returned reconciliation items at 2 000 and every list endpoint caps `limit`
  at 200.

### 1.10 Browser hardening

The API sets CSP, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`,
cross-origin resource policy and (in production) HSTS with a one-year max-age via `@fastify/helmet`.
The web app sets its own CSP, `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy` that disables camera,
microphone and geolocation (`apps/web/next.config.mjs`). There is no `dangerouslySetInnerHTML`
anywhere in the web app, and no user-controlled interpolation into the server-rendered sandbox HTML.

---

## 2. Findings from the review of 22 September 2026

Severity is assessed for a production deployment. "Proof" is the observation that established the
finding against the running instance; each fix was re-proved the same way.

### Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| H-1 | **High** | Cross-tenant disclosure of payment history via the sandbox provider report | Fixed |
| H-2 | **High** | `X-Forwarded-For` accepted from any peer — IP allow-list and rate limits bypassable | Fixed |
| M-1 | Medium | Throttled requests returned `500`, not `429` | Fixed |
| M-2 | Medium | The `/v1` rate-limit configuration was silently ignored | Fixed |
| M-3 | Medium | Raw PANs and IBANs could be stored via payouts and payment methods | Fixed |
| M-4 | Medium | Webhook destination validated only at registration (stored SSRF / DNS rebinding) | Fixed |
| M-5 | Medium | Concurrent refunds each reached the provider before any amount was reserved | Fixed |
| M-6 | Medium | Password change did not invalidate the user's other sessions | Fixed |
| L-1 | Low | IPv6 literals escaped the private-range check; IPv4-mapped IPv6 was misclassified | Fixed |
| L-2 | Low | Login disclosed that an account exists but is not active | Fixed |
| L-3 | Low | Pagination cursors were resolved across tenants (existence/timestamp oracle) | Fixed |
| L-4 | Low | Reconciliation CSV parsed with no row limit | Fixed |
| L-5 | Low | Reconciliation could reference a provider account belonging to another merchant | Fixed |
| I-1 | Info | The application connects to PostgreSQL as a superuser that owns its tables | Not fixed — deployment |

### H-1 · Cross-tenant disclosure via the sandbox provider report — **fixed**

`GET /dashboard/reconciliation/sandbox-report/:accountId` called
`sandboxProviderReport(db, accountId)` with no tenant scope. Demo provider accounts are
platform-level (`provider_accounts.merchant_id IS NULL`), so their simulated ledger holds the
traffic of **every** merchant routed through them.

*Proof.* A merchant registered seconds earlier through `POST /dashboard/auth/register`, with one
payment of its own, requested the report for `pa_lj6mWPXP7g7EAFN9QlC9` and received `200` with a CSV
containing the demo merchant's payment and refund ids, amounts, currencies and statuses —
`pay_aAdBl7rkJnhZC8xZeIER`, `pay_Jj6lYt0liW18i9K5LM7g`, `rf_MvEcSaFW6vw9YX76swGu` and others.

*Fix.* `sandboxProviderReport` takes an optional `merchantId` and, when present, restricts records to
those whose `natio_reference` belongs to that merchant's payments, refunds or payouts; the dashboard
route always passes it (`src/modules/reconciliation/service.ts`,
`src/http/routes/dashboard.ts`). The admin route is intentionally left unscoped — platform operators
are meant to see the whole account.

*Re-proof.* The attacking merchant now receives only its own single row; the demo merchant still
receives its full nine-row report.

### H-2 · `X-Forwarded-For` accepted from any peer — **fixed**

Fastify was constructed with `trustProxy: true`, which trusts `X-Forwarded-For` from **any** source.
`req.ip` feeds three security controls: the per-project API-key IP allow-list
(`guards.ts:requireApiKey` → `isIpAllowed`), every rate-limit bucket, and the `ip` column of
`audit_logs`.

*Proof.* A project was locked to `allowed_ips: ["203.0.113.7"]`. A request from another address was
correctly refused with `403 ip_not_allowed`; the identical request with
`X-Forwarded-For: 203.0.113.7` returned `200` with the full principal. Separately, 14 consecutive
login attempts against the 10-per-minute auth limiter all succeeded while rotating
`X-Forwarded-For: 198.51.100.N`, where without the header attempts 11–14 were throttled. The same
spoof passes through the web app's `/api/*` rewrite.

*Fix.* A new `TRUST_PROXY` setting (`src/config.ts`, default `"loopback"`) is passed to Fastify.
Only listed peers may set the header; production refuses `TRUST_PROXY=true`. `.env.example`
documents that operators behind a load balancer must set it to that balancer's address or CIDR,
because otherwise `req.ip` collapses onto the proxy.

*Re-proof.* With a realistic non-loopback trust list, `req.ip` stays the socket address whether or
not `X-Forwarded-For` is present, and the allow-list bypass returns `403 ip_not_allowed`. With the
old `true` behaviour the spoof still works — which is what confirms the setting is the control.

### M-1 · Throttled requests returned `500` — **fixed**

`@fastify/rate-limit` **throws** whatever `errorResponseBuilder` returns. The builder returned
`Errors.rateLimited().toJSON()` — a plain object with no `statusCode` — so the error handler fell
through to `500 internal_error` and logged "unhandled error" for every throttled request. Clients
could not back off, and the `rate_limited` code never reached them.

*Proof.* The 6th request to `/public/contact` within a minute returned
`HTTP 500 {"error":{"code":"internal_error"}}`.

*Fix.* Return the `ApiError` instance itself (`src/server.ts`), which the error handler already maps
to its own status and body.

*Re-proof.* The 6th request now returns `HTTP 429` with `retry-after: 60`, the `x-ratelimit-*`
headers and `{"error":{"type":"rate_limit_error","code":"rate_limited"}}`.

### M-2 · The `/v1` rate-limit configuration was silently ignored — **fixed**

`registerV1Routes` set `route.config.rateLimit` from an `onRoute` hook registered inside the `/v1`
plugin. `@fastify/rate-limit` registers its own `onRoute` hook on the root instance, which runs
first, so it never saw the override. Consequently `/v1` ran on the dashboard's budget and shared a
single counter with the browser and public surfaces, and the `keyGenerator`'s `req.apiKey` branch
was dead code (the limiter runs on `onRequest`, long before authentication).

*Proof.* `GET /v1/me` returned `x-ratelimit-limit: 300` (`RATE_LIMIT_DASHBOARD_PER_MINUTE`) instead
of 600, and its counter decremented in lockstep with `GET /health`.

*Fix.* The global limiter now computes `max` per request from the URL prefix and gives `/v1` its own
key namespace (`src/server.ts`); the dead hook is removed with a comment recording why it could not
work.

*Re-proof.* `GET /v1/me` reports `x-ratelimit-limit: 600` on its own counter; `/health` still
reports 300 on the browser counter.

### M-3 · Raw PANs and IBANs could be stored — **fixed**

Three gaps in the PCI guards:

* `POST /v1/payment-methods` rejected a bare 12–19 digit `provider_token` only after stripping
  whitespace, so `4111-1111-1111-1111` was accepted and persisted to `payment_methods.provider_token`.
* The same endpoint rejected `display` values containing 7+ consecutive digits, so a PAN written in
  four-digit groups passed and was both stored and echoed back by the API.
* `POST /v1/payouts` applied **no** validation at all to `destination.token` — despite the field's
  own comment saying raw account numbers are not accepted — and rejected `destination.display` only
  on 9+ consecutive digits.

*Proof.* Four payouts were created and their stored rows read back from PostgreSQL:
`destination.providerToken` contained `"4111111111111111"` and `"GB29NWBK60161331926819"`;
`destination.display` contained `"4111-1111-1111-1111"` and `"GB29 NWBK 6016 1331 9268 19"`.

*Fix.* Shared guards in `src/modules/payments/schemas.ts` (`stripSeparators`, `looksLikePan`,
`looksLikeIban`, `looksLikeAccountNumber`, `hasUnmaskedDigits`) strip separators before testing, and
are applied to `payment_method.token` on payment creation, `provider_token` and every `display`
value on payment methods, and `destination.token` and `destination.display` on payouts.

*Re-proof.* PANs in bare, spaced, dashed and dotted form and full IBANs are rejected with `422` on
every one of those fields, while legitimate values (`tok_…`, `{"last4":"4242","brand":"visa"}`,
`"IBAN ****4321"`) are still accepted.

### M-4 · Webhook destination validated only at registration — **fixed**

`validateOutboundUrl` ran when an endpoint was created or its URL changed, but `deliverWebhook`
called `fetch(ep.url)` directly. A merchant could register a hostname that resolved to a public
address and later repoint its DNS at `169.254.169.254` or an internal service, turning the delivery
worker into an SSRF proxy. Redirects were already refused (`redirect: "manual"`).

*Fix.* `deliverWebhook` re-validates the destination immediately before the request. If it no longer
passes, the delivery is marked `exhausted`, the endpoint is disabled, and a warning is logged
(`src/modules/webhooks/service.ts`).

*Re-proof.* With `WEBHOOK_ALLOW_PRIVATE_URLS=false`, delivering to a stored endpoint pointing at
`https://169.254.169.254/steal` produced
`delivery.status=exhausted attempts=0 lastError="endpoint rejected: URL must not point to a private network" endpoint.status=disabled`
— no request was ever issued.

### M-5 · Concurrent refunds reached the provider unreserved — **fixed**

`createRefund` computed `refundable = capturedAmount - refundedAmount` from the payment row read at
the start of the request, and `payments.refunded_amount` is only written *after* the provider
confirms. Concurrent requests therefore all saw the full remaining balance, all created refund rows,
and all called the provider. NATIO's own ledger stayed correct — the state-machine guard rejected
the losers — but each loser had already asked the provider for money, and its refund row was left
stranded in `processing`. A provider without its own de-duplication would pay out more than once.

*Proof.* Four parallel full refunds of a 50 000 payment created four refund rows and four provider
calls; only the mock provider's own over-refund check prevented the double payout.

*Fix.* The check-and-reserve is now atomic (`src/modules/refunds/service.ts`): the payment row is
locked `FOR UPDATE`, in-flight refunds (`created`/`processing`) are summed and subtracted from the
refundable balance, and the new refund row is inserted in the same transaction. The success path
re-reads the payment under lock so the running total and the target status reflect any refund that
committed meanwhile.

*Re-proof.* Five parallel full refunds of a 40 000 payment now yield **one** `201` and four clean
`400 refund_amount_invalid`, one refund row, one provider record. Five parallel *partial* refunds of
10 000 on the same amount correctly settle as four successes totalling 40 000 plus one refusal, with
the payment ending `refunded`. Sequential partial-refund behaviour is unchanged and still covered by
the end-to-end suite.

### M-6 · Password change did not invalidate other sessions — **fixed**

`changePassword` rotated the hash but left every existing session live, so a user who changed their
password in response to a suspected compromise did not evict the attacker.

*Fix.* `revokeOtherSessions(db, userId, keepSessionId)` (`src/modules/auth/service.ts`) is called on
password change; the route passes the caller's own session id so the user is not logged out of the
tab they are using.

*Re-proof.* With two live sessions for one user, changing the password from session B leaves B at
`200` and moves A to `401`.

### L-1 · IPv6 literals escaped the private-range check — **fixed**

`URL.hostname` keeps the brackets around an IPv6 literal, so `isIP(host)` never matched and every
IPv6 URL fell through to `dns.lookup("[::1]")`, which failed and produced a rejection for the wrong
reason. Removing the brackets exposed a second bug: the WHATWG parser rewrites
`::ffff:169.254.169.254` as `::ffff:a9fe:a9fe`, and `normalizeIp` only understood the dotted form, so
an IPv4-mapped private address was classified as public.

*Fix.* `validateOutboundUrl` strips the brackets, and `normalizeIp` decodes both the dotted and the
hexadecimal IPv4-mapped forms (`src/lib/net.ts`).

*Re-proof.* `[::1]`, `[fd00::1]`, `[fe80::1]`, `[::ffff:169.254.169.254]` and `[::ffff:10.0.0.1]` all
return "URL must not point to a private network", while `[2606:4700::1111]` and `[::ffff:8.8.8.8]`
remain allowed. Covered by a new case in `test/unit/net.test.ts`.

### L-2 · Login disclosed account state — **fixed**

A disabled or not-yet-activated account returned `"Account is not active"` while an unknown address
returned `"Invalid email or password"`, letting an attacker confirm an address and learn its state.
Both now return the generic message (`src/modules/auth/service.ts`).

The `423 account_locked` response still reveals that an account exists, and self-service
registration necessarily returns `409 email_taken`. Both are accepted trade-offs for usability and
are noted in §3.

### L-3 · Pagination cursors resolved across tenants — **fixed**

Cursor conditions were of the form `created_at < (select created_at from payments where id =
$cursor)` with no tenant predicate. Passing another merchant's id returned rows when it existed and
nothing when it did not — a global existence and coarse-timestamp oracle for opaque ids. The
subqueries in `payments`, `payouts`, `transactions` and `webhook_deliveries` are now scoped to the
caller's merchant when one is present (admin callers keep the unscoped form deliberately).

*Re-proof.* A cursor taken from the demo merchant's payment list returns 0 rows for the other
merchant, while each merchant's own cursors continue to page correctly.

### L-4 · Reconciliation CSV parsed with no row limit — **fixed**

A 10 MB upload (the multipart limit) parses to roughly 200 000 rows, all held in memory, matched
into a map and inserted as one statement. `parseProviderCsv` now rejects files above 50 000 rows
with `400 csv_too_large` (`src/modules/reconciliation/service.ts`). A 60 000-row file is refused; a
1 000-row file still succeeds.

### L-5 · Reconciliation could reference another merchant's provider account — **fixed**

`runReconciliation` accepted any `provider_account_id`. The NATIO side of the match was already
merchant-scoped so nothing leaked, but a merchant could create batches against an account dedicated
to someone else. `assertProviderAccountVisible` now requires the account to be platform-level or the
caller's own, and is applied to both the upload and the sandbox-report routes. An unknown account
returns `404`; the shared platform account remains usable.

### I-1 · The application connects to PostgreSQL as a superuser — **not fixed (deployment)**

The runtime role `natio` is a PostgreSQL superuser and owns every table, so it can drop the
append-only triggers that protect `audit_logs`, `state_transitions`, `transactions`,
`payment_events` and `events`. Verified: `DROP TRIGGER audit_logs_immutable ON audit_logs` succeeded
(and was immediately restored, after which the `UPDATE` was rejected again). The triggers therefore
defend against application bugs, not against a compromised database credential or a future SQL
injection.

This cannot be fixed in application code. The remediation is operational: run migrations as a
dedicated owner role and give the runtime process a separate least-privilege role with
`SELECT/INSERT/UPDATE/DELETE` on the application tables, no ownership, and no `CREATE`/`DROP`. It is
recorded in §3 as required before production.

---

## 3. Not implemented, or out of scope for the MVP

These are known gaps, stated plainly so that nobody mistakes the current state for a
production-ready posture.

**Required before a production launch**

* **Least-privilege database role.** See I-1. Until then, the append-only guarantees are only as
  strong as the application's own correctness.
* **Secrets management.** `NATIO_ENCRYPTION_KEY` and `NATIO_SESSION_SECRET` are read from the
  environment. There is no KMS or secrets-manager integration, no envelope encryption, and no key
  rotation procedure: the ciphertext format carries a `v1` prefix so a second key version can be
  introduced, but nothing implements it. Provider credentials re-encrypted under a new key would
  need a migration that does not exist.
* **MFA.** `merchant_users.mfa_enabled` exists and is reported by the API, but there is no
  enrolment flow, no TOTP verification and no recovery codes. Admin accounts in particular should
  not go live without it.
* **Per-API-key rate limits and quotas.** The limiter runs on `onRequest`, before authentication, so
  it can only bucket by peer address. Real per-key quotas need a second limiter after
  `requireApiKey`, keyed on the resolved key id.
* **WAF / edge protection and DDoS mitigation.** None. The in-process limiter is not a substitute.
* **Independent penetration test.** This review is an internal, source-assisted assessment. It is
  not a substitute for a black-box test by a third party.
* **SOC 2 / ISO 27001 / PCI SAQ-D attestation.** No formal control framework, evidence collection,
  vendor risk process or audited change management is in place. The PCI position taken here (NATIO
  never receives, processes or stores cardholder data) should be confirmed with a QSA against the
  chosen provider integrations.
* **Key rotation for webhook secrets at scale.** Rotation exists per endpoint and is
  single-secret: there is no overlap window during which both the old and the new secret verify, so
  a rotation is a hard cutover for the merchant.

**Accepted for now, with reasons**

* **`'unsafe-inline'` in `script-src`.** Both the API's helmet policy and the web app's CSP allow
  inline scripts, because Next.js's bootstrap and hydration payload are inline and the app does not
  yet generate per-request nonces. This weakens CSP as an XSS mitigation. It is tolerable today only
  because there is no `dangerouslySetInnerHTML` in the codebase and all rendering goes through
  React's escaping; it should be replaced with a nonce-based policy.
* **Account enumeration through signup and lockout.** `POST /dashboard/auth/register` returns
  `409 email_taken`, and a locked account returns `423 account_locked`. Both reveal that an address
  is registered. Removing them would degrade the self-service experience for a small gain given that
  login itself is now indistinguishable.
* **Invite links returned in the API response.** No mail service is configured, so
  `POST /dashboard/team/invite` returns the invite URL once to the inviter to pass along out of
  band. The token is stored only as SHA-256 and expires in 7 days.
* **Unauthenticated sandbox hosted page.** `/sandbox/hosted/:accountId/:externalId/complete` lets
  anyone holding both opaque ids approve or decline a simulated payment. It is restricted to
  accounts backed by `MockProviderAdapter` and exists to demonstrate the redirect flow; no real
  provider is reachable through it.
* **Idempotency keys are scoped per merchant, mode and operation, not per project.** Two projects of
  the same merchant reusing one key for the same operation will collide. Narrowing the scope is a
  visible API change and was left alone.
* **No automated dependency or container scanning in CI**, and no signed releases or SBOM.

**Configuration hygiene (verified)**

`.gitignore` covers `.env`, `.env.*` (with `!.env.example`) and `.sandbox-credentials.json`, and
`git status` confirms none of them is tracked. `.env.example` contains only placeholders —
`NATIO_ENCRYPTION_KEY` and `NATIO_SESSION_SECRET` are `replace-with-64-hex-chars`, which the config
schema rejects outright since it requires 64 hex characters. The one real value it carries,
`SEED_DEMO_PASSWORD`, is the development seed password and is not used outside seeding.

`src/config.ts` refuses to start in production when `COOKIE_SECURE` is false, `QUEUE_DRIVER=memory`,
`WEBHOOK_ALLOW_PRIVATE_URLS` is true, `TRUST_PROXY=true`, `DATABASE_SSL` is not `require`,
`CORS_ORIGINS` contains `*` or an `http://` origin, or the encryption key and session secret are the
same value.

---

## 3b. Accepted exposures

Things that are deliberately not fixed, with the reasoning, so that "we never noticed" and "we
decided" stay distinguishable.

**`/health` reports the running commit, publicly.** The repository is public, so this tells anyone
exactly which code is serving — including whether a published fix has actually been deployed yet.
That converts the window between a security commit landing on GitHub and rolling onto the server
into something an attacker can poll for rather than guess at.

It is kept anyway, for now. The server deploys itself and cannot be logged into from anywhere the
platform is developed, so without this field the question "which version is live?" has no answer at
all — and an operator who cannot tell what is running is a larger risk than a fingerprint on a
codebase that is public regardless. Version fingerprinting is also weak protection: asset hashes and
rendered markup give most of it away.

**Before real merchant traffic, this should change**, together with pointing the deploy timer at a
tag rather than at `main`. The straightforward version is to keep `/health` to `status` and `checks`
for load balancers and move the commit behind an authenticated endpoint.

**Auto-deploy follows `main`.** A push and a release are currently the same event. That is right for
a platform with no merchants on it and wrong the moment there are any.

## 4. Verifying this yourself

```bash
cd apps/api && npx vitest run            # 209 tests
cd apps/api && npx tsc -p tsconfig.json --noEmit
cd apps/web && npx tsc --noEmit
```

The end-to-end suite runs against a dedicated `natio_test` database, drives real payments through
the orchestrator, receives real signed webhooks on a local HTTP receiver, and covers the state
machine, routing, risk, retry policy, reconciliation matching, permissions and webhook signatures.
