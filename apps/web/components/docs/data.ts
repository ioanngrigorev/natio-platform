/**
 * Reference data for the developer portal.
 *
 * These tables mirror the API source of truth and are kept verbatim:
 *  - TEST_SCENARIOS        → apps/api/src/modules/payments/scenarios.ts
 *  - FAILURE_CODES         → apps/api/src/providers/failure-codes.ts
 *  - WEBHOOK_EVENT_TYPES   → apps/api/src/db/schema/webhooks.ts
 *  - PAYMENT_TRANSITIONS   → apps/api/src/modules/payments/state-machine.ts
 *  - error types/codes     → apps/api/src/lib/errors.ts
 *  - currency exponents    → apps/api/src/lib/money.ts
 */

// ---------------------------------------------------------------------------
// Sandbox test scenarios (name + description copied verbatim)
// ---------------------------------------------------------------------------
export const TEST_SCENARIOS: Array<{ name: string; description: string }> = [
  { name: "success", description: "Payment is approved by the first provider." },
  { name: "authorize", description: "Payment is authorised only; capture it with POST /v1/payments/{id}/capture." },
  { name: "requires_action", description: "Provider requests customer action (hosted page / redirect). Complete it via the sandbox hosted page." },
  { name: "soft_decline", description: "First provider soft-declines (insufficient funds); NATIO cascades to the next provider." },
  { name: "hard_decline", description: "Provider hard-declines (stolen card). No retry; payment fails." },
  { name: "technical_error", description: "First provider returns a technical error; NATIO fails over to the next provider." },
  { name: "failover", description: "Alias of technical_error: Provider A fails technically, Provider B succeeds." },
  { name: "timeout", description: "First provider times out, NATIO confirms no charge exists and fails over." },
  { name: "timeout_recovered", description: "Provider times out but had processed the payment; NATIO recovers it via status lookup — no double charge." },
  { name: "unavailable", description: "First provider is unavailable (HTTP 503); NATIO fails over." },
  { name: "all_fail", description: "Every eligible provider fails technically; payment ends as failed." },
  { name: "review", description: "Risk engine returns REVIEW; payment waits for manual approval in admin." },
  { name: "block", description: "Risk engine returns BLOCK; payment fails immediately." },
];

/** Scenarios accepted by POST /v1/payments/{id}/refund. */
export const REFUND_TEST_SCENARIOS = ["success", "technical_error", "hard_decline"] as const;

// ---------------------------------------------------------------------------
// Failure codes
// ---------------------------------------------------------------------------
export type DeclineCategory = "soft" | "hard" | "technical" | "policy";

export interface FailureCode {
  code: string;
  category: DeclineCategory;
  message: string;
}

export const FAILURE_CODES: FailureCode[] = [
  { code: "insufficient_funds", category: "soft", message: "The account has insufficient funds" },
  { code: "do_not_honor", category: "soft", message: "The issuer declined the transaction without a specific reason" },
  { code: "issuer_unavailable", category: "soft", message: "The issuer or bank could not be reached" },
  { code: "try_again_later", category: "soft", message: "Temporary decline; retry later" },
  { code: "limit_exceeded", category: "soft", message: "A transaction or velocity limit was exceeded" },
  { code: "generic_decline", category: "soft", message: "The transaction was declined" },

  { code: "card_declined", category: "hard", message: "The card was declined" },
  { code: "stolen_card", category: "hard", message: "The card was reported stolen" },
  { code: "lost_card", category: "hard", message: "The card was reported lost" },
  { code: "expired_card", category: "hard", message: "The card has expired" },
  { code: "invalid_card", category: "hard", message: "The card details are invalid" },
  { code: "invalid_account", category: "hard", message: "The account is invalid or closed" },
  { code: "restricted_card", category: "hard", message: "The card is restricted for this transaction" },
  { code: "fraud_suspected", category: "hard", message: "The provider suspects fraud" },
  { code: "authentication_failed", category: "hard", message: "Customer authentication failed" },
  { code: "cancelled_by_customer", category: "hard", message: "The customer cancelled the payment" },
  { code: "payment_expired", category: "hard", message: "The payment was not completed in time" },

  { code: "technical_error", category: "technical", message: "The provider returned a technical error" },
  { code: "timeout", category: "technical", message: "The provider did not respond in time" },
  { code: "provider_unavailable", category: "technical", message: "The provider is unavailable" },
  { code: "provider_configuration_error", category: "technical", message: "Provider account is misconfigured" },

  { code: "unsupported_currency", category: "policy", message: "The currency is not supported by any eligible provider" },
  { code: "unsupported_method", category: "policy", message: "The payment method is not supported by any eligible provider" },
  { code: "no_route_available", category: "policy", message: "No eligible provider route was found" },
  { code: "risk_blocked", category: "policy", message: "The payment was blocked by risk rules" },
  { code: "amount_out_of_limits", category: "policy", message: "Amount is outside provider limits" },
  { code: "attempts_exhausted", category: "policy", message: "All eligible providers were attempted without success" },
];

export const FAILURE_CATEGORIES: Array<{ category: DeclineCategory; title: string; retry: string; note: string }> = [
  {
    category: "soft",
    title: "Soft declines",
    retry: "May cascade",
    note: "The issuer or bank refused this attempt but the instrument itself is usable. NATIO may cascade the payment to the next eligible provider.",
  },
  {
    category: "hard",
    title: "Hard declines",
    retry: "Never retried",
    note: "The instrument or the customer decision is final. NATIO never retries a hard decline on another provider; the payment fails immediately.",
  },
  {
    category: "technical",
    title: "Technical failures",
    retry: "May cascade",
    note: "The provider, not the payment, failed. NATIO may fail over to the next eligible provider, after confirming that no charge was created.",
  },
  {
    category: "policy",
    title: "Policy outcomes",
    retry: "No further attempt",
    note: "The orchestration layer itself stopped the payment: no eligible route, risk block, limits, or every provider already attempted.",
  },
];

// ---------------------------------------------------------------------------
// Webhook event types
// ---------------------------------------------------------------------------
export const WEBHOOK_EVENT_TYPES = [
  "payment.created",
  "payment.processing",
  "payment.authorized",
  "payment.successful",
  "payment.failed",
  "payment.cancelled",
  "payment.refunded",
  "refund.successful",
  "refund.failed",
  "payout.created",
  "payout.successful",
  "payout.failed",
  "settlement.created",
] as const;

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<string, string> = {
  "payment.created": "A payment object was created and accepted for orchestration.",
  "payment.processing": "The payment is in flight at a provider, or awaiting a customer action.",
  "payment.authorized": "Funds were authorised and are held for capture (capture_method = manual).",
  "payment.successful": "The payment completed. For automatic capture this is the terminal success event.",
  "payment.failed": "No eligible provider completed the payment. The failure object carries the code and category.",
  "payment.cancelled": "The payment was cancelled before completion, by the merchant or by expiry of an authorisation.",
  "payment.refunded": "The payment reached refunded or partially_refunded after a refund settled.",
  "refund.successful": "A refund was accepted by the provider.",
  "refund.failed": "A refund was rejected by the provider. The payment amounts are unchanged.",
  "payout.created": "A payout object was created and queued for a provider.",
  "payout.successful": "The provider confirmed the payout.",
  "payout.failed": "The payout was rejected. The failure object carries the code and category.",
  "settlement.created": "A provider settlement record was ingested for the merchant.",
};

/** Retry schedule (apps/api/src/modules/webhooks/service.ts → backoffMs). */
export const WEBHOOK_RETRY_SCHEDULE: Array<{ attempt: string; delay: string }> = [
  { attempt: "1", delay: "immediately when the event is emitted" },
  { attempt: "2", delay: "30 seconds after attempt 1" },
  { attempt: "3", delay: "2 minutes after attempt 2" },
  { attempt: "4", delay: "10 minutes after attempt 3" },
  { attempt: "5", delay: "30 minutes after attempt 4" },
  { attempt: "6", delay: "2 hours after attempt 5" },
  { attempt: "7 and later", delay: "2 hours between attempts (the last interval repeats)" },
];

// ---------------------------------------------------------------------------
// Payment statuses
// ---------------------------------------------------------------------------
export const PAYMENT_STATUSES: Array<{ status: string; terminal: boolean; meaning: string; next: string }> = [
  { status: "created", terminal: false, meaning: "The payment object exists; risk and routing have not produced an attempt yet.", next: "processing, pending, failed, cancelled" },
  { status: "pending", terminal: false, meaning: "Waiting on something outside NATIO: a customer action, or a manual risk review.", next: "processing, failed, cancelled" },
  { status: "processing", terminal: false, meaning: "An attempt is in flight at a provider, or the provider outcome is not yet known.", next: "authorized, successful, failed, cancelled, pending" },
  { status: "authorized", terminal: false, meaning: "Funds are authorised and held. Capture within the provider window or cancel.", next: "successful, cancelled, failed" },
  { status: "captured", terminal: false, meaning: "A capture was accepted by the provider and is being finalised.", next: "successful" },
  { status: "successful", terminal: false, meaning: "The payment completed. Refunds can be created from here.", next: "partially_refunded, refunded" },
  { status: "partially_refunded", terminal: false, meaning: "At least one refund settled but the full amount has not been returned.", next: "partially_refunded, refunded" },
  { status: "refunded", terminal: true, meaning: "The full captured amount was refunded.", next: "—" },
  { status: "failed", terminal: true, meaning: "No eligible provider completed the payment. Read failure.code and failure.category.", next: "—" },
  { status: "cancelled", terminal: true, meaning: "The payment was cancelled before completion.", next: "—" },
];

// ---------------------------------------------------------------------------
// Timeline event types
// ---------------------------------------------------------------------------
export const TIMELINE_EVENTS: Array<{ type: string; meaning: string }> = [
  { type: "payment.created", meaning: "The payment was accepted. Carries amount, currency, method and reference." },
  { type: "risk.evaluated", meaning: "The risk engine returned ALLOW, REVIEW or BLOCK, with the score and the rules that matched." },
  { type: "risk.review", meaning: "The payment was parked for manual review; it waits in pending until an operator decides." },
  { type: "risk.reviewed", meaning: "An operator approved or rejected a payment that was held for review." },
  { type: "routing.evaluated", meaning: "The routing decision: strategy, the rule that matched and every candidate provider account with its score." },
  { type: "provider.selected", meaning: "A provider account was chosen for this attempt, with the attempt number and the fee terms applied." },
  { type: "provider.request_sent", meaning: "The request left NATIO for the provider adapter. In test mode it also names the simulated primitive." },
  { type: "provider.declined", meaning: "The provider declined the attempt. Carries the normalised failure code and the raw provider code." },
  { type: "provider.error", meaning: "The provider returned a technical error rather than a decision." },
  { type: "provider.unavailable", meaning: "The provider could not be reached at all (for example HTTP 503)." },
  { type: "provider.timeout", meaning: "The provider did not answer inside the adapter timeout; the outcome is unknown at this point." },
  { type: "provider.lookup", meaning: "NATIO queried the provider after an unknown outcome and recorded what actually happened." },
  { type: "provider.webhook", meaning: "An asynchronous notification arrived from the provider and moved the payment forward." },
  { type: "failover.initiated", meaning: "The failure was retryable, so the next eligible provider account was selected." },
  { type: "retry.stopped", meaning: "No further attempt will be made: the failure was final or no candidate was left." },
  { type: "payment.requires_action", meaning: "The provider needs the customer to act; next_action on the payment carries the redirect URL or QR payload." },
  { type: "payment.authorized", meaning: "The attempt authorised funds for later capture." },
  { type: "payment.successful", meaning: "The attempt succeeded. Carries provider payment id, fee and latency." },
  { type: "payment.failed", meaning: "The payment ended as failed, with the failure code that closed it." },
  { type: "payment.captured", meaning: "A capture was accepted by the provider." },
  { type: "capture.failed", meaning: "A capture request was rejected by the provider; the payment stays authorized." },
  { type: "payment.cancelled", meaning: "The payment was cancelled, with the reason supplied by the caller." },
  { type: "refund.created", meaning: "A refund was requested against this payment." },
  { type: "refund.successful", meaning: "The refund was accepted by the provider and the refunded amount was updated." },
  { type: "refund.failed", meaning: "The refund was rejected by the provider." },
  { type: "sync.scheduled", meaning: "The provider outcome stayed unknown; a background reconciliation of that attempt was scheduled." },
  { type: "sync.resolved", meaning: "The scheduled sync resolved the unknown attempt one way or the other." },
  { type: "webhook.queued", meaning: "A merchant event was queued for delivery, with the event type and how many endpoints subscribe to it." },
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export const ERROR_TYPES: Array<{ type: string; status: string; meaning: string }> = [
  { type: "invalid_request_error", status: "400 / 413 / 415 / 422", meaning: "The request itself is wrong: malformed JSON, an unknown field, a failed validation rule or a body that is too large." },
  { type: "authentication_error", status: "401", meaning: "No API key was presented, or the key is unknown or revoked." },
  { type: "permission_error", status: "403", meaning: "The key is valid but not allowed to do this: missing permission, or the caller IP is outside the project allow-list." },
  { type: "not_found_error", status: "404", meaning: "No object with that id exists inside the merchant, project and mode of the key — or the route does not exist." },
  { type: "idempotency_error", status: "409 / 422", meaning: "An Idempotency-Key is in flight (409) or was reused with a different body (422)." },
  { type: "rate_limit_error", status: "429", meaning: "Too many requests in the current window. Retry after the window resets." },
  { type: "state_error", status: "409", meaning: "The object cannot move to the requested state, for example capturing a payment that is not authorized." },
  { type: "provider_error", status: "503", meaning: "No eligible provider was available for the request." },
  { type: "risk_error", status: "—", meaning: "Reserved for risk-layer rejections surfaced as an API error rather than a failed payment." },
  { type: "internal_error", status: "500", meaning: "An unexpected error. Quote the request_id when you contact support." },
];

export const ERROR_CODES: Array<{ code: string; type: string; status: number; message: string }> = [
  { code: "validation_failed", type: "invalid_request_error", status: 422, message: "One or more fields failed validation. details lists each path." },
  { code: "invalid_json", type: "invalid_request_error", status: 400, message: "Request body is not valid JSON" },
  { code: "unsupported_media_type", type: "invalid_request_error", status: 415, message: "Use application/json" },
  { code: "payload_too_large", type: "invalid_request_error", status: 413, message: "Request body is too large" },
  { code: "invalid_idempotency_key", type: "invalid_request_error", status: 400, message: "Idempotency-Key must be at most 255 characters" },
  { code: "test_scenario_not_allowed", type: "invalid_request_error", status: 400, message: "test_scenario is only accepted with test API keys" },
  { code: "unauthorized", type: "authentication_error", status: 401, message: "Authentication required" },
  { code: "invalid_api_key", type: "authentication_error", status: 401, message: "Invalid or revoked API key" },
  { code: "forbidden", type: "permission_error", status: 403, message: "You do not have permission to perform this action" },
  { code: "ip_not_allowed", type: "permission_error", status: 403, message: "Request IP is not in the project allow-list" },
  { code: "resource_not_found", type: "not_found_error", status: 404, message: "<Entity> <id> was not found" },
  { code: "route_not_found", type: "not_found_error", status: 404, message: "No route for <METHOD> <path>" },
  { code: "idempotency_in_progress", type: "idempotency_error", status: 409, message: "A request with this Idempotency-Key is still being processed" },
  { code: "idempotency_key_reused", type: "idempotency_error", status: 422, message: "Idempotency-Key was already used with a different request payload" },
  { code: "invalid_state_transition", type: "state_error", status: 409, message: "<entity> cannot move from <status> to <status>" },
  { code: "rate_limited", type: "rate_limit_error", status: 429, message: "Too many requests" },
  { code: "no_route_available", type: "provider_error", status: 503, message: "No eligible provider is available for this request" },
  { code: "internal_error", type: "internal_error", status: 500, message: "An internal error occurred" },
];

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
export const CURRENCY_EXPONENTS: Array<{ exponent: number; currencies: string; example: string }> = [
  { exponent: 0, currencies: "JPY, KRW, VND, CLP, ISK, UGX, XAF, XOF", example: "amount 10000 with currency JPY is 10000 JPY" },
  { exponent: 2, currencies: "every other supported currency, including USD, EUR, GBP", example: "amount 10000 with currency USD is 100.00 USD" },
  { exponent: 3, currencies: "BHD, KWD, OMR, JOD, TND", example: "amount 10000 with currency KWD is 10.000 KWD" },
];

export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CHF",
  "PLN",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "AED",
  "SGD",
  "HKD",
  "JPY",
  "AUD",
  "CAD",
  "BRL",
  "MXN",
  "INR",
  "IDR",
  "VND",
  "THB",
  "PHP",
  "MYR",
  "TRY",
  "ZAR",
  "NGN",
  "KES",
  "SAR",
  "KZT",
] as const;

export const PAYMENT_METHOD_TYPES = ["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local"] as const;

// ---------------------------------------------------------------------------
// Sandbox demo providers (apps/api/src/db/seed.ts)
// ---------------------------------------------------------------------------
export const DEMO_PROVIDERS: Array<{ name: string; code: string; kind: string; role: string }> = [
  { name: "NATIO Demo Acquirer A", code: "demo_acquirer_a", kind: "Acquirer", role: "First choice for card traffic in the seeded routing rules. Simulates a card acquirer with an amount limit." },
  { name: "NATIO Demo Acquirer B", code: "demo_acquirer_b", kind: "Acquirer", role: "Fallback for card traffic. Used to demonstrate failover when Acquirer A fails technically." },
  { name: "NATIO Demo QR Provider", code: "demo_qr", kind: "QR / local", role: "Asynchronous rail. Returns next_action of type qr_code and completes through the sandbox hosted page." },
];
