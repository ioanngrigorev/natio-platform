import type { customers, paymentAttempts, payments, providerAccounts, providers } from "../../db/schema/index.js";
import { failureInfo } from "../../providers/failure-codes.js";

type PaymentRow = typeof payments.$inferSelect;
type AttemptRow = typeof paymentAttempts.$inferSelect;

export interface SerializeOpts {
  provider?: typeof providers.$inferSelect | null;
  account?: typeof providerAccounts.$inferSelect | null;
  customer?: typeof customers.$inferSelect | null;
  attempts?: Array<AttemptRow & { providerName?: string | null; accountName?: string | null }>;
  ruleName?: string | null;
}

export function serializePayment(p: PaymentRow, opts: SerializeOpts = {}) {
  const failure = p.failureCode ? failureInfo(p.failureCode) : null;
  return {
    id: p.id,
    object: "payment",
    mode: p.mode,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    captured_amount: p.capturedAmount,
    refunded_amount: p.refundedAmount,
    capture_method: p.captureMethod,
    payment_method: { type: p.paymentMethodType, id: p.paymentMethodId },
    country: p.country,
    description: p.description,
    reference: p.reference,
    customer: opts.customer
      ? { id: opts.customer.id, external_id: opts.customer.externalId, email: opts.customer.email, name: opts.customer.name, country: opts.customer.country }
      : p.customerId
        ? { id: p.customerId }
        : null,
    metadata: p.metadata,
    route: {
      provider: opts.provider ? { id: opts.provider.id, code: opts.provider.code, name: opts.provider.name } : p.providerId ? { id: p.providerId } : null,
      provider_account_id: p.providerAccountId,
      provider_account_name: opts.account?.name ?? null,
      provider_payment_id: p.providerPaymentId,
      attempts: p.attemptCount,
      routing_decision_id: p.routingDecisionId,
      rule: opts.ruleName ?? null,
    },
    risk: { decision_id: p.riskDecisionId, score: p.riskScore },
    failure: failure ? { code: failure.code, category: failure.category, message: p.failureMessage ?? failure.message } : null,
    next_action: p.nextAction ?? null,
    fee: { amount: p.feeAmount, currency: p.currency },
    processing_time_ms: p.processingTimeMs,
    test_scenario: p.mode === "test" ? p.testScenario : undefined,
    attempts: opts.attempts?.map(serializeAttempt),
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    processed_at: p.processedAt,
  };
}

export function serializeAttempt(a: AttemptRow & { providerName?: string | null; accountName?: string | null }) {
  const failure = a.failureCode ? failureInfo(a.failureCode) : null;
  return {
    id: a.id,
    attempt_number: a.attemptNumber,
    status: a.status,
    outcome: a.outcome,
    provider_id: a.providerId,
    provider_name: a.providerName ?? null,
    provider_account_id: a.providerAccountId,
    provider_account_name: a.accountName ?? null,
    provider_payment_id: a.providerPaymentId,
    provider_code: a.providerCode,
    provider_message: a.providerMessage,
    failure: failure ? { code: failure.code, category: failure.category, message: failure.message } : null,
    fee_amount: a.feeAmount,
    latency_ms: a.latencyMs,
    request_sent_at: a.requestSentAt,
    responded_at: a.respondedAt,
    created_at: a.createdAt,
  };
}
