# Adding a payment provider

Connecting a new acquirer, PSP, bank or local payment method means writing one adapter and inserting two rows. The orchestration engine — routing, retry, failover, state machine, reconciliation — never changes.

## 1. Implement the adapter

Create `apps/api/src/providers/<name>/<name>-adapter.ts` implementing `ProviderAdapter` from `src/providers/types.ts`:

```ts
export class AcmeAdapter implements ProviderAdapter {
  readonly key = "acme";
  readonly displayName = "Acme Payments";

  async createPayment(ctx: ProviderContext, input: CreatePaymentInput): Promise<ProviderPaymentResult> { … }
  async getPayment(ctx: ProviderContext, providerPaymentId: string): Promise<ProviderLookupResult> { … }
  async capturePayment(ctx, input): Promise<ProviderOperationResult> { … }
  async cancelPayment(ctx, input): Promise<ProviderOperationResult> { … }
  async refundPayment(ctx, input): Promise<ProviderOperationResult> { … }
  async createPayout(ctx, input): Promise<ProviderPayoutResult> { … }
  async getPayout(ctx, providerPayoutId): Promise<ProviderLookupResult> { … }
  async verifyWebhook(ctx, { headers, rawBody }): Promise<WebhookVerification> { … }

  // Optional but strongly recommended — see "Timeouts" below.
  async findPaymentByReference(ctx, reference): Promise<ProviderLookupResult> { … }
  async healthCheck(ctx): Promise<{ ok: boolean; latencyMs: number; message?: string }> { … }
}
```

`ctx.credentials` holds the decrypted credentials for the provider account being used, `ctx.config` the non-secret settings, `ctx.mode` is `test` or `live` and `ctx.timeoutMs` the deadline the orchestrator will enforce anyway. Never log `ctx.credentials`.

## 2. Normalise the outcome

This is the part that matters most. The orchestrator does not understand provider vocabularies; it understands the outcomes in `ProviderOutcome` and the failure codes in `src/providers/failure-codes.ts`. Map every provider response onto them:

| Outcome | Meaning | Retry behaviour |
|---|---|---|
| `success` | Authorised or captured | — |
| `requires_action` | Customer must complete a redirect, QR or similar | Payment waits; provider confirms later by webhook |
| `soft_decline` | Refused, but another provider might succeed (insufficient funds, issuer unreachable, velocity) | May cascade |
| `hard_decline` | Refused for a reason no provider will overturn (stolen, expired, invalid, fraud) | Never retried |
| `technical_error` | Gateway error, malformed response | May cascade |
| `timeout` | No answer within the deadline | Only after confirming no charge exists |
| `provider_unavailable` | Provider down or rejecting traffic | May cascade |

Set `failureCode` to a key that exists in `FAILURE_CODES`. Getting the soft/hard split wrong is expensive in both directions: a hard decline classified as soft wastes a second provider attempt on a stolen card, and a soft decline classified as hard loses a recoverable payment. When the provider's own documentation is ambiguous, classify as soft only if retrying is safe.

Add codes to the dictionary rather than inventing ad-hoc strings — the dictionary is what the dashboards, analytics and decline-reason reporting read.

## 3. Handle timeouts correctly

A timeout is not a failure. The provider may have taken the payment and lost the response.

Implement `findPaymentByReference(ctx, reference)` so NATIO can ask "do you have a payment for my reference `pay_…`?" after a timeout. Pass NATIO's `paymentId` as your merchant reference on every create call so this lookup is possible. With it, the orchestrator can fail over safely (provider confirms nothing exists) or adopt the result (provider confirms a charge). Without it, timed-out attempts are parked as `unknown` and no other provider is tried until a background sync resolves them — correct, but slower and more manual.

## 4. Verify inbound webhooks over the raw body

`verifyWebhook` receives `rawBody` as the exact bytes received. Compute the signature over that string — never over a re-serialised object, because key ordering and whitespace will differ and every signature will fail. Use a timing-safe comparison and reject stale timestamps. Return a `NormalizedProviderEvent` with the provider's event id (used for deduplication), the kind, the provider reference and the normalised status.

The inbound URL is `POST /providers/webhooks/{providerAccountId}` — give that to the provider when configuring the integration.

## 5. Register it

```ts
// src/providers/registry.ts
import { AcmeAdapter } from "./acme/acme-adapter.js";
registerAdapter(new AcmeAdapter());
```

## 6. Create the rows

A `providers` row describes the capability surface; `provider_accounts` rows hold credentials per mode. Both can be created from the admin UI (Providers → Add provider account) or by migration:

```sql
INSERT INTO providers (id, code, name, type, adapter_key, supported_methods,
                       supported_currencies, supported_countries, capabilities, settlement_entity)
VALUES ('prv_…', 'acme', 'Acme Payments', 'psp', 'acme',
        '["card","wallet"]', '["EUR","GBP"]', '["DE","FR","GB"]',
        '{"payments":true,"refunds":true,"capture":true,"payouts":false,"hostedPage":true}',
        'Acme Payments Ltd (licensed in …)');
```

`settlement_entity` should name the licensed entity that actually settles to the merchant — it is shown in the settlement UI, and it is how the platform stays honest about who is moving the money.

Credentials are encrypted with `NATIO_ENCRYPTION_KEY` (AES-256-GCM) when written through the admin API; do not insert them in plaintext.

## 7. Route traffic to it

Create a routing rule in the admin rule builder, or start it as a fallback behind an existing provider so real traffic only reaches it when the primary fails. The route simulator on the routing page dry-runs a transaction context against the current rules without creating a payment — use it to confirm the new account is selected before sending anything live.

## 8. Test it

Follow the pattern in `test/unit/routing.test.ts` for pure logic and the e2e suite for the full path. The mock adapters in `src/providers/mock/` are a working reference for every method, including the asynchronous hosted-page flow and signed inbound webhooks.

Before live traffic: run the provider's sandbox through every scenario in `GET /v1/test/scenarios` that the provider can produce, verify the decline-code mapping against their documentation, confirm the webhook signature check rejects a tampered body, and reconcile a day of sandbox transactions against the provider's own report.

## Compliance note

Do not describe NATIO as a partner of a provider, or use a provider's marks, until an agreement is signed and permits it. Adding an adapter is a technical capability, not a commercial relationship.
