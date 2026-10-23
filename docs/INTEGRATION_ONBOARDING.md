# Integration onboarding

The Integration Center issues NATIO server credentials and guides supported PSP setup. It does not create credentials inside a third-party PSP account.

## Merchant paths

- **Host-to-host API:** the merchant backend calls `POST /v1/payments`. Follow a returned `next_action` when customer interaction is required. NATIO does not accept PAN or CVV.
- **Hosted checkout / redirect:** the backend calls `POST /v1/checkout-sessions` with an HTTPS `return_url`, amount in minor units, currency and payment method. Open `url` only when present; a failure or terminal result can have no URL. Do not infer a successful charge from a redirect. Use the signed webhook or `GET /v1/payments/:id`.
- Send a unique `Idempotency-Key` for an order attempt. Repeating the same request with the same key returns the original result. A changed request requires a new key.
- A redirect key is limited to creating checkout sessions and reading an individual payment/status timeline in its own project. It cannot list ledger records, create direct payments, pay out or refund.

An administrator with `integrations.manage` sets allowed types and a preferred type for each merchant and environment. The preference controls new issuance; previously issued keys remain valid until explicitly revoked. Keys are hashed, shown once, project-scoped and environment-scoped. Live issuance requires KYB approval. The isolated demo never permits Live keys or real PSP adapters.

## PSP connections

The wizard lists implemented connectors and their supported methods/currencies. Choose a connector, currency and environment. Enter the PSP-issued credentials for that environment where applicable. The account is saved **disabled**. Open its detail page, run a health check, test success/decline/pending/timeout flows and signed webhooks, inspect routing, then explicitly activate it. Connectivity alone is not certification that live payments work.

The four-frame demo explains both merchant paths and provider setup, with pause, previous and next controls. Merchant instructions can be downloaded without embedding secrets.

## Tenant AI and reports

The floating assistant works in both admin and merchant shells, with text, reviewed voice transcription and current-message attachments. Merchant identity comes from the session, never the model. BI queries, saved boards, traffic analytics and downloads override any submitted merchant filter. Global inventory/options are excluded from the merchant response. Advanced reports remain plan-gated. Merchant connection requests direct the user to the Integration Center; only admin Lab can prepare simulated connections.

## Validation

`integration-onboarding.test.ts` covers tenant/project isolation, key restrictions, idempotent redirect sessions, Test/Live separation, disabled provider creation, private BI/export/board scopes and plan gates. Existing role, CSRF, payment, retry, ledger and transport suites remain required release gates.

## References

- Stripe API keys: https://docs.stripe.com/keys
- Adyen integration checklist: https://docs.adyen.com/online-payments/integration-checklist/
