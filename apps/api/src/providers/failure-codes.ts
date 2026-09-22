/**
 * Unified failure dictionary. Adapters normalise provider-specific codes to these.
 * `category` drives retry policy: soft → may cascade to another provider, hard → never retry.
 */
export type DeclineCategory = "soft" | "hard" | "technical" | "policy";

export interface FailureCode {
  code: string;
  category: DeclineCategory;
  message: string;
}

export const FAILURE_CODES: Record<string, FailureCode> = {
  insufficient_funds: { code: "insufficient_funds", category: "soft", message: "The account has insufficient funds" },
  do_not_honor: { code: "do_not_honor", category: "soft", message: "The issuer declined the transaction without a specific reason" },
  issuer_unavailable: { code: "issuer_unavailable", category: "soft", message: "The issuer or bank could not be reached" },
  try_again_later: { code: "try_again_later", category: "soft", message: "Temporary decline; retry later" },
  limit_exceeded: { code: "limit_exceeded", category: "soft", message: "A transaction or velocity limit was exceeded" },
  generic_decline: { code: "generic_decline", category: "soft", message: "The transaction was declined" },

  card_declined: { code: "card_declined", category: "hard", message: "The card was declined" },
  stolen_card: { code: "stolen_card", category: "hard", message: "The card was reported stolen" },
  lost_card: { code: "lost_card", category: "hard", message: "The card was reported lost" },
  expired_card: { code: "expired_card", category: "hard", message: "The card has expired" },
  invalid_card: { code: "invalid_card", category: "hard", message: "The card details are invalid" },
  invalid_account: { code: "invalid_account", category: "hard", message: "The account is invalid or closed" },
  restricted_card: { code: "restricted_card", category: "hard", message: "The card is restricted for this transaction" },
  fraud_suspected: { code: "fraud_suspected", category: "hard", message: "The provider suspects fraud" },
  authentication_failed: { code: "authentication_failed", category: "hard", message: "Customer authentication failed" },
  cancelled_by_customer: { code: "cancelled_by_customer", category: "hard", message: "The customer cancelled the payment" },
  payment_expired: { code: "payment_expired", category: "hard", message: "The payment was not completed in time" },

  technical_error: { code: "technical_error", category: "technical", message: "The provider returned a technical error" },
  timeout: { code: "timeout", category: "technical", message: "The provider did not respond in time" },
  provider_unavailable: { code: "provider_unavailable", category: "technical", message: "The provider is unavailable" },
  provider_configuration_error: { code: "provider_configuration_error", category: "technical", message: "Provider account is misconfigured" },

  unsupported_currency: { code: "unsupported_currency", category: "policy", message: "The currency is not supported by any eligible provider" },
  unsupported_method: { code: "unsupported_method", category: "policy", message: "The payment method is not supported by any eligible provider" },
  no_route_available: { code: "no_route_available", category: "policy", message: "No eligible provider route was found" },
  risk_blocked: { code: "risk_blocked", category: "policy", message: "The payment was blocked by risk rules" },
  amount_out_of_limits: { code: "amount_out_of_limits", category: "policy", message: "Amount is outside provider limits" },
  attempts_exhausted: { code: "attempts_exhausted", category: "policy", message: "All eligible providers were attempted without success" },
};

export function failureInfo(code: string | undefined | null): FailureCode {
  if (code && FAILURE_CODES[code]) return FAILURE_CODES[code]!;
  return { code: code ?? "unknown_error", category: "soft", message: "The transaction could not be completed" };
}
