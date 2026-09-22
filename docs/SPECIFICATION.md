# NATIO — Specification

Normative specification of the platform. This document states what the system
*must* do; `ARCHITECTURE.md` explains how it is arranged, and `SECURITY.md`
records the review findings.

Every statement here is derived from the code in this repository, not from
intent. Where the code and this document disagree, that is a bug in one of
them and the disagreement is the finding — do not quietly adjust the document
to match. Section 12 lists what is deliberately not built; it is part of the
specification, not an omission from it.

**Maintenance rule:** a change that alters a contract, an invariant, a state
transition, a permission or the built/not-built boundary updates this file in
the same commit. A reviewer is entitled to reject a change that does not.

---

## 1. Scope and regulatory position

NATIO is a payment **technology and orchestration** platform. It is not a bank,
an acquirer, a payment institution or an electronic money institution, it holds
no such licence, and it must not be described as any of them.

The platform **never takes custody of merchant or payer funds**. Fiat money
moves between the payer, licensed payment providers and the merchant; on-chain
money moves from the payer directly to an address the merchant controls. There
is no NATIO-held balance for funds to rest in, and no code path may introduce
one.

This is a design constraint, not a policy setting. A feature that would require
holding funds is out of scope for this phase regardless of demand.

## 2. Non-negotiable invariants

These hold across every module. A change that breaks one is wrong even if its
tests pass.

1. **No card data.** The platform never stores a CVV and never stores or
   designs storage for a raw PAN. Card data reaches providers directly; NATIO's
   PCI DSS scope is minimised by not being in the card data path.
2. **No spending capability.** NATIO accepts extended *public* keys only. An
   extended private key or a recovery phrase is refused before it reaches the
   database, by name and by version bytes (§8.1).
3. **No credentials in the repository.** Secrets are generated on the server at
   first start. Test fixtures must not contain strings shaped like live
   credentials of any vendor (§7.2).
4. **Financial operations are idempotent.** A retried create must never produce
   a second payment, payout, refund or on-chain credit (§6, §8.4).
5. **Financial facts are append-only.** Audit logs, state transitions, payment
   events, the event outbox, and the financial fields of transactions, chain
   observations and wallet addresses cannot be updated or deleted. The
   constraint is a database trigger, so it holds even when the application is
   wrong (§11).
6. **Exact decimals never pass through a float.** (§4)
7. **No unverified claims.** Public-facing copy states no capability the code
   does not have, and no metric that production has not produced. Capability
   claims in marketing are part of the specification's surface (§12).

## 3. Domain objects

`merchant` (with `kyb_status`), `project`, `merchant_user`, `api_key`,
`payment`, `payment_attempt`, `refund`, `payout`, `transaction`,
`provider_account`, `routing_rule`, `risk_rule`, `webhook_endpoint`,
`webhook_delivery`, `settlement`, `reconciliation_batch`, `audit_log`,
`state_transition`, `wallet_account`, `wallet_address`, `chain_observation`.

Every object is scoped to a merchant and to a **mode** (`test` | `live`). No
query may cross a merchant boundary, and no query may mix modes. Cross-tenant
leakage is treated as a security defect, not a bug (see `SECURITY.md`).

## 4. Money representation

Fiat amounts are integer **minor units** (cents), stored as `bigint`. They are
parsed to JavaScript numbers because minor units of any plausible fiat amount
fit inside `Number.MAX_SAFE_INTEGER` with room to spare.

On-chain amounts are integer **base units**, stored as `numeric(78, 0)` and
carried through the application as **exact decimal strings**. They are never
parsed into a JavaScript number.

`numeric` must not have a global type parser registered on it. A global
`numeric → parseFloat` parser existed once, added for a single percentage
column; it silently turned `1000000000000000000000` base units into `1e+21`,
which is a different number. The database was correct and the driver discarded
the precision on the way out. Columns that want a float convert at their own
call site.

Currency codes are ISO 4217. An amount is meaningless without its currency and
the two are always carried together.

## 5. Payment lifecycle

The transition table is authoritative and enforced in two places: in the
application, and in the `UPDATE ... WHERE status IN (...)` guard that performs
the write, so that two concurrent writers cannot produce an invalid path.

| From | May move to |
| --- | --- |
| `created` | `processing`, `pending`, `failed`, `cancelled` |
| `pending` | `processing`, `failed`, `cancelled` |
| `processing` | `authorized`, `successful`, `failed`, `cancelled`, `pending` |
| `authorized` | `successful`, `cancelled`, `failed` |
| `captured` | `successful` |
| `successful` | `partially_refunded`, `refunded` |
| `partially_refunded` | `partially_refunded`, `refunded` |
| `refunded`, `failed`, `cancelled` | — terminal |

Note the absence of `pending → successful`. Money that has been seen but not
confirmed is `processing`; a payment becomes `successful` only from a state
that acknowledges it was being worked on. On-chain settlement obeys this by
stepping through `processing` when the first confirmation is observed (§8.5),
which is a truthful description of the lifecycle rather than a workaround.

Refunds: `created → processing → successful | failed`.
Payouts: `created → pending | processing → successful | failed | cancelled`.

Every transition writes a `state_transition` row. These rows are immutable.

## 6. Idempotency

Creates accept an `Idempotency-Key` header. The record is keyed uniquely on
`(merchant_id, mode, scope, key)` and stores a hash of the request body
together with the original response status and body.

- Same key, same request hash → the original response is replayed. No second
  object is created.
- Same key, **different** request hash → the request is rejected. A key that
  meant one thing must never come to mean another.
- A key in flight is marked with `locked_at` so a concurrent duplicate cannot
  race past the first.

Keys expire. Expiry frees the key for reuse; it does not retroactively permit
a conflicting replay within the window.

## 7. Provider orchestration

### 7.1 Failure classification and retry

Provider outcomes are classified as **soft**, **hard**, **technical** or
**policy** decline.

- A **hard** decline is never retried on another provider. It is an answer, not
  an outage.
- A **soft** decline or a **technical** failure may fail over, subject to the
  project's retry policy.
- A **timeout is not a decline.** Before failing over after a timeout, NATIO
  asks the provider `findPaymentByReference`. It moves to another provider only
  on a confirmed absence of the payment. If the provider cannot answer, the
  attempt is recorded as `unknown`, the payment is flagged for provider sync,
  and **no other provider is tried**. Double charging is the worse failure.

### 7.2 Adapter contract

A provider adapter implements `createPayment`, `getPayment`, `capture`,
`cancel`, `refund`, `createPayout`, `getPayout` and `verifyWebhook`, and may
implement `findPaymentByReference` and `healthCheck`. Adding a provider is an
adapter, a registration and two database rows; it does not modify the engine.

### 7.3 API key format

Secret keys are `natio_sk_test_…` and `natio_sk_live_…`, validated against a
pattern imported from the generator rather than restated. The earlier
`sk_test_…` format was byte-identical to another vendor's: a leaked NATIO key
would have been attributed to them by scanners, the merchant would have been
told to rotate the wrong credential, and NATIO would never have learned of the
leak. Keys are displayed once and stored hashed.

## 8. Non-custodial on-chain settlement

### 8.1 Key acceptance

NATIO accepts an account-level **extended public key**. `xprv`, `yprv`, `zprv`,
`tprv`, `uprv`, `vprv` and recovery phrases are refused by name, before any
database write, with a message telling the submitter to treat the key as
compromised. The rejection must not echo the submitted value back — an error
body is the easiest place for a key to reach a log.

The **script type is derived from the key's own SLIP-132 version bytes**, never
from a separate setting. Handing the owner of a `zpub` a legacy address is lost
money, not a cosmetic mismatch.

Keys are stored encrypted (AES-256-GCM). The reason is not custody risk — an
xpub cannot spend — but that an xpub discloses the merchant's entire balance
history. A SHA-256 fingerprint allows duplicate detection, including across
merchants, without decryption; the same key registered by two merchants is a
strong signal that funds are about to land in the wrong place.

The extended key is never returned by any endpoint, never written to the audit
log, and never included in an error body. Listings return a 12-character
fingerprint.

### 8.2 Address derivation

One address per invoice, at a recorded derivation path. Addresses are never
reused: two customers sharing an address makes attribution a guess. The index
counter advances with a single `UPDATE ... RETURNING` inside the caller's
transaction, so concurrency is serialised by the row lock rather than by a
read-then-write.

On registration, index 0 is derived and returned as a **probe address**, and
the interface requires the merchant to confirm it appears in their own wallet
before taking payments. A mistyped key is not rejected by anything: it produces
valid addresses belonging to nobody, every payment leaves and never arrives,
and nothing downstream looks wrong. This confirmation is the only control that
catches it.

Verified against published vectors — BIP84 addresses, EIP-55 examples, the
known Ethereum address of the secp256k1 generator point, and a TRON round trip
against the EVM hash — rather than against the implementation's own output.

### 8.3 Chain observation

Observed: **TRON** (TronGrid) and **Bitcoin** (Esplora).
Derived but **not observed**: Ethereum, BSC, Polygon. `chainClientFor` throws
for these deliberately, and the interface says so where a merchant selects one.
A payment to an unobserved chain is not noticed automatically.

A transfer is matched on the **contract address**, never on the token symbol.
Matching on symbol would credit any counterfeit "USDT". A decimals mismatch
between the payload and the asset specification rejects the transfer.

One failing chain must not stop the others, and one failing address must not
stop the next: errors are recorded and the cycle continues. A provider outage
must never be indistinguishable from "nothing arrived".

### 8.4 Observation idempotency

`chain_observations` is unique on `(network, tx_hash, output_index)`. Replaying
a cycle, overlapping cycles, or re-observing an entire day cannot double-credit
anything. The property belongs to the database constraint, not to the
watcher's carefulness.

Confirmations only move forward. A settled amount is derived by summing
observations rather than by incrementing a counter, so a reorg that orphans a
transaction corrects the balance by itself.

### 8.5 Settlement outcomes

An address resolves to `settled`, `awaiting` (seen, not yet final),
`underpaid`, `expired` or remains `reserved`. Underpayment and overpayment are
first-class recorded outcomes with the observed amount against the expected
one; neither may silently fail or silently vanish.

Only addresses never seen on-chain are expired. An address with any observation
against it is a conversation about amounts, and marking it expired would hide a
real payment behind a tidy status.

On-chain receipts write the same `transaction` rows as card payments and appear
in the same reconciliation and settlement reports.

## 9. Webhooks

Event types: `payment.created`, `payment.processing`, `payment.authorized`,
`payment.successful`, `payment.failed`, `payment.cancelled`,
`payment.refunded`, `refund.successful`, `refund.failed`, `payout.created`,
`payout.successful`, `payout.failed`, `settlement.created`.

Events are written inside the same transaction as the fact they describe
(transactional outbox); deliveries are enqueued only after that transaction
commits. A webhook is never sent for something that did not happen.

Deliveries are signed and retried with backoff. Every attempt is recorded.
On-chain payments use the same contract as every other method — a merchant
integrating once does not integrate again for crypto.

## 10. Authentication and authorization

Merchant dashboard sessions are cookie-based with CSRF tokens required on every
mutating request. API access uses bearer secret keys, scoped to a project and a
mode.

Roles: `owner`, `admin`, `developer`, `finance`, `analyst`, `support`,
`viewer`. Permissions are coarse `resource.action` strings declared by each
route.

**`wallets.manage` is restricted to `owner` and `admin`.** A settlement key
decides where the merchant's money lands — a more consequential setting than an
API key. A developer able to register one could point settlements at a key of
their own, and nothing downstream would look wrong: payments would succeed,
webhooks would fire, reconciliation would balance, and the money would be gone.
All roles including `developer` hold `wallets.read`.

Note for tests: a CSRF failure and a permission failure both return
`403 forbidden` and differ only in the message. A test asserting only the
status would pass with the permission check deleted. Permission tests assert
the reason.

## 11. Immutability and audit

Database triggers forbid `UPDATE` and `DELETE` on `audit_logs`,
`state_transitions`, `payment_events` and `events`, and on the financial fields
of `transactions`, `chain_observations` and `wallet_addresses`.

The application connects to PostgreSQL as `natio_app`, which is not the owner
of the tables; migrations run as `natio_migrator`. The application therefore
has no privilege to alter the history it writes.

Every administrative action, state change and routing decision is audited with
its actor. Sensitive values are never among the audited fields.

## 12. What is not built

This section is normative: public-facing copy must agree with it.

- **Sanctions and watchlist screening — not implemented.** NATIO does not
  screen accounts or counterparties against published lists. No part of the
  platform may be described as doing so.
- **Automated identity verification (KYC/KYB) — not implemented.** A
  `kyb_status` field (`not_started` | `pending` | `approved` | `rejected`) and
  an administrative endpoint to set it exist, so a decision can be *recorded*.
  No identity provider is integrated, so no evidence is *collected or
  verified*. The distinction matters: the record exists, the check does not.
- **EVM chain observation — not implemented.** Ethereum, BSC and Polygon derive
  addresses that nothing watches (§8.3).
- **Supported assets, networks and served jurisdictions — undecided.** These
  follow from where the operating entity is incorporated and what its counsel
  advises.

Open legal questions that constrain the product and are not engineering
decisions: EU Regulation 833/2014 restricts crypto-wallet services to Russian
residents by EU persons; and under the Russian NPD regime (ФЗ-422, art. 6 §2
cl. 5) agency and commission income is not an object of the tax.

## 13. Operational contract

The server is deployed by pulling `origin/main`: a systemd timer runs an
updater that compares `HEAD` against `FETCH_HEAD`, builds before swapping, and
holds a lock so two runs cannot overlap. Nothing pushes to the server, and the
server exposes no deployment endpoint.

`GET /health` reports the running commit. That value is the authoritative
answer to "is this deployed", and it is the check to make before believing a
deployment succeeded.

### 13.1 The encryption key

`NATIO_ENCRYPTION_KEY` decrypts provider credentials, webhook secrets and
merchant extended public keys. It is generated once by `bootstrap.sh` and
exists only in the host's `.env`.

The failure mode this creates is not obvious. Restore a database backup onto a
fresh host, or rebuild one from the startup script while the database survives,
and bootstrap generates a *new* key against old ciphertext. Nothing looks
wrong: the process starts, serves traffic, and fails only at the first
decrypt — a provider call, a webhook signature, a merchant's next on-chain
payment — by which point nobody connects the two events.

Therefore: **the database records a fingerprint of the key its ciphertext was
written under, and the process refuses to start when the configured key does
not match.** The fingerprint is a domain-separated SHA-256, so the row
discloses nothing usable. Refusing to boot is recoverable in minutes; running
for a week under the wrong key is not recoverable at all.

A database that predates this check has no stored fingerprint and cannot be
verified retroactively — the first key seen is recorded and guards every boot
after it. That is the honest limit: it protects against the next accident, not
one that already happened.

Deliberate rotation requires **both** keys and re-encrypts every stored secret
in one transaction:

    NATIO_OLD_ENCRYPTION_KEY=<previous> NATIO_ENCRYPTION_KEY=<new> npm run db:rotate-key

If the previous key is lost there is no recovery by any means. What remains is
re-entering every provider credential, regenerating and redistributing every
webhook secret — breaking each merchant's signature verification until they
store the new one — and every merchant re-registering their settlement key.
No command performs that silently.

`deploy/backup-secrets.sh` prints what must be held off the host, with the
fingerprint to verify a backup against later. A database backup does not cover
this key, and a backup strategy that assumes it does is not a backup strategy.

### 13.2 Database backups

`bootstrap.sh` installs an hourly `/etc/cron.hourly/natio-backup` that runs
`deploy/backup.sh`. Three properties are required of it, and each exists
because its absence is invisible:

- **A dump is kept only once it has been verified.** It is written under a
  `.partial` name, listed with `pg_restore --list`, and renamed only on
  success. A truncated dump sitting under the real name is worse than no dump,
  because it is indistinguishable from a good one until the day it is needed.
- **The off-host destination is used when it is set.** `BACKUP_S3_URI` is
  copied to on every run. When it is unset the script says so on every run
  rather than once at install: a backup on the host that holds the database
  protects against a bad migration and nothing else.
- **The encryption key is not in the dump.** Restoring one of these onto a host
  with a different key produces rows nobody can decrypt, and the platform will
  refuse to start (§13.1) rather than run against them. The key is backed up
  separately or the restore is not a restore.
