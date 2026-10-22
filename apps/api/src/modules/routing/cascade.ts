import type { ProviderPaymentResult } from "../../providers/types.js";

export interface RetryPolicy {
  maxAttempts: number;
  retryOnSoftDecline: boolean;
  retryOnTimeout: boolean;
  maxElapsedMs?: number;
}
export interface RetryContext {
  timeoutResolvedSafe?: boolean;
  chargeState?: "not_created" | "created" | "unknown";
  failureCode?: string;
  advice?:
    | "do_not_retry"
    | "retry_later"
    | "authenticate"
    | "try_another_route";
  paymentMethod?: string;
  elapsedMs?: number;
}
const STOP_CODES = new Set([
  "stolen_card",
  "lost_card",
  "fraud_suspected",
  "fraudulent",
  "restricted_card",
  "not_permitted",
  "transaction_not_permitted",
  "do_not_try_again",
  "expired_card",
  "invalid_card",
  "invalid_account",
  "authentication_failed",
  "cancelled_by_customer",
  "risk_blocked",
]);
const CUSTOMER_CODES = new Set([
  "insufficient_funds",
  "do_not_honor",
  "generic_decline",
  "limit_exceeded",
  "incorrect_cvc",
  "invalid_cvc",
  "invalid_number",
  "authentication_required",
  "authentication_not_handled",
  "try_again_later",
]);
const SAFE_SOFT_CODES = new Set([
  "issuer_unavailable",
  "issuer_not_available",
  "acquirer_unavailable",
]);

/** Conservative cross-provider policy. HTTP errors alone never prove that a charge was not created. */
export function shouldRetry(
  outcome: ProviderPaymentResult["outcome"] | "unknown",
  policy: RetryPolicy,
  attempts: number,
  remaining: number,
  ctx: RetryContext = {},
): { retry: boolean; reason: string } {
  if (outcome === "success" || outcome === "requires_action")
    return { retry: false, reason: "not_retryable" };
  if (outcome === "unknown" || ctx.chargeState === "created")
    return { retry: false, reason: "outcome_unknown" };
  if (
    outcome === "hard_decline" ||
    ctx.advice === "do_not_retry" ||
    STOP_CODES.has(ctx.failureCode || "")
  )
    return { retry: false, reason: "hard_decline_never_retried" };
  if (
    ctx.advice === "authenticate" ||
    ctx.advice === "retry_later" ||
    CUSTOMER_CODES.has(ctx.failureCode || "")
  )
    return { retry: false, reason: "customer_action_or_later_retry_required" };
  if (ctx.failureCode === "duplicate_transaction")
    return { retry: false, reason: "reconcile_duplicate_first" };
  if (remaining <= 0) return { retry: false, reason: "no_more_candidates" };
  if (attempts >= policy.maxAttempts)
    return { retry: false, reason: "max_attempts_reached" };
  if ((ctx.elapsedMs ?? 0) >= (policy.maxElapsedMs ?? 30000))
    return { retry: false, reason: "latency_budget_exhausted" };
  if (outcome === "timeout") {
    if (!policy.retryOnTimeout)
      return { retry: false, reason: "timeout_retry_disabled" };
    return ctx.timeoutResolvedSafe
      ? { retry: true, reason: "provider_confirmed_no_charge" }
      : { retry: false, reason: "timeout_unresolved" };
  }
  if (ctx.chargeState !== "not_created")
    return { retry: false, reason: "no_charge_not_proven" };
  if (outcome === "technical_error" || outcome === "provider_unavailable")
    return { retry: true, reason: `${outcome}_is_retryable` };
  if (outcome === "soft_decline") {
    if (!policy.retryOnSoftDecline)
      return { retry: false, reason: "soft_decline_cascade_disabled" };
    if (ctx.paymentMethod !== "card")
      return { retry: false, reason: "new_customer_consent_required" };
    if (!SAFE_SOFT_CODES.has(ctx.failureCode || ""))
      return { retry: false, reason: "decline_not_allowlisted" };
    return { retry: true, reason: "soft_decline_cascade_enabled" };
  }
  return { retry: false, reason: "not_retryable" };
}
