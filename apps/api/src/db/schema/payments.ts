import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import {
  attemptOutcomeEnum,
  attemptStatusEnum,
  captureMethodEnum,
  modeEnum,
  paymentMethodTypeEnum,
  paymentStatusEnum,
  payoutStatusEnum,
  refundStatusEnum,
  transactionStatusEnum,
  transactionTypeEnum,
} from "./enums.js";
import { customers, merchants, paymentMethods, projects } from "./merchants.js";
import { providerAccounts, providers } from "./providers.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "number" });

export interface NextAction {
  type: "redirect" | "qr_code" | "display_details";
  url?: string;
  qrPayload?: string;
  details?: Record<string, string>;
  expiresAt?: string;
}

export interface DeviceInfo {
  ip?: string;
  userAgent?: string;
  fingerprint?: string;
  acceptLanguage?: string;
}

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    customerId: text("customer_id").references(() => customers.id),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    capturedAmount: money("captured_amount").notNull().default(0),
    refundedAmount: money("refunded_amount").notNull().default(0),
    status: paymentStatusEnum("status").notNull().default("created"),
    captureMethod: captureMethodEnum("capture_method").notNull().default("automatic"),
    paymentMethodType: paymentMethodTypeEnum("payment_method_type").notNull(),
    paymentMethodId: text("payment_method_id").references(() => paymentMethods.id),
    country: text("country"),
    description: text("description"),
    /** Merchant's own order/reference identifier. */
    reference: text("reference"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    riskDecisionId: text("risk_decision_id"),
    riskScore: integer("risk_score"),
    routingDecisionId: text("routing_decision_id"),
    currentAttemptId: text("current_attempt_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id),
    providerId: text("provider_id").references(() => providers.id),
    providerPaymentId: text("provider_payment_id"),
    feeAmount: money("fee_amount").notNull().default(0),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    declineCategory: text("decline_category"),
    nextAction: jsonb("next_action").$type<NextAction | null>(),
    returnUrl: text("return_url"),
    device: jsonb("device").$type<DeviceInfo>().notNull().default({}),
    testScenario: text("test_scenario"),
    processingTimeMs: integer("processing_time_ms"),
    version: integer("version").notNull().default(1),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    index("payments_merchant_created_idx").on(t.merchantId, t.mode, t.createdAt),
    index("payments_status_idx").on(t.status),
    index("payments_reference_idx").on(t.merchantId, t.reference),
    index("payments_provider_idx").on(t.providerAccountId, t.createdAt),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    attemptNumber: integer("attempt_number").notNull(),
    providerAccountId: text("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id),
    status: attemptStatusEnum("status").notNull().default("created"),
    outcome: attemptOutcomeEnum("outcome"),
    providerPaymentId: text("provider_payment_id"),
    providerCode: text("provider_code"),
    providerMessage: text("provider_message"),
    failureCode: text("failure_code"),
    feeAmount: money("fee_amount").notNull().default(0),
    requestSentAt: ts("request_sent_at"),
    respondedAt: ts("responded_at"),
    latencyMs: integer("latency_ms"),
    /** Provider response with secrets redacted. */
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_attempts_number_uq").on(t.paymentId, t.attemptNumber),
    index("payment_attempts_provider_idx").on(t.providerAccountId, t.createdAt),
  ],
);

/** Append-only record of every status transition of a financial object. */
export const stateTransitions = pgTable(
  "state_transitions",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actor: jsonb("actor").$type<{ type: string; id?: string }>().notNull().default({ type: "system" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("state_transitions_entity_idx").on(t.entityType, t.entityId, t.createdAt)],
);

/** Human-readable timeline of a payment (shown in dashboards). */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    attemptId: text("attempt_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("payment_events_payment_idx").on(t.paymentId, t.createdAt)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    status: refundStatusEnum("status").notNull().default("created"),
    reason: text("reason"),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id),
    providerRefundId: text("provider_refund_id"),
    idempotencyKey: text("idempotency_key"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("refunds_payment_idx").on(t.paymentId), index("refunds_merchant_idx").on(t.merchantId, t.mode, t.createdAt)],
);

export interface PayoutDestination {
  type: "bank_account" | "wallet" | "card_token";
  /** Masked display value, e.g. "IBAN ****1234". */
  display: string;
  country?: string;
  currency?: string;
  /** Provider token or reference. Never raw account numbers beyond masked display. */
  providerToken?: string;
  holderName?: string;
}

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    status: payoutStatusEnum("status").notNull().default("created"),
    destination: jsonb("destination").$type<PayoutDestination>().notNull(),
    description: text("description"),
    reference: text("reference"),
    country: text("country"),
    routingDecisionId: text("routing_decision_id"),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id),
    providerId: text("provider_id").references(() => providers.id),
    providerPayoutId: text("provider_payout_id"),
    feeAmount: money("fee_amount").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    testScenario: text("test_scenario"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("payouts_merchant_idx").on(t.merchantId, t.mode, t.createdAt)],
);

/**
 * Ledger-style transaction records. One row per financial movement (payment success,
 * refund, payout, fee). Rows are immutable once written; corrections are new rows of type adjustment.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    type: transactionTypeEnum("type").notNull(),
    status: transactionStatusEnum("status").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    paymentId: text("payment_id"),
    attemptId: text("attempt_id"),
    /** Signed amount in minor units from the merchant's perspective (+ inflow, - outflow). */
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    feeAmount: money("fee_amount").notNull().default(0),
    netAmount: money("net_amount").notNull(),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id),
    providerId: text("provider_id").references(() => providers.id),
    providerReference: text("provider_reference"),
    paymentMethodType: text("payment_method_type"),
    country: text("country"),
    processingTimeMs: integer("processing_time_ms"),
    failureCode: text("failure_code"),
    settlementId: text("settlement_id"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_merchant_idx").on(t.merchantId, t.mode, t.occurredAt),
    index("transactions_entity_idx").on(t.entityType, t.entityId),
    index("transactions_provider_idx").on(t.providerAccountId, t.occurredAt),
    uniqueIndex("transactions_provider_ref_uq").on(t.providerAccountId, t.providerReference, t.type),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    mode: modeEnum("mode").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<unknown>(),
    entityId: text("entity_id"),
    lockedAt: ts("locked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [uniqueIndex("idempotency_keys_uq").on(t.merchantId, t.mode, t.scope, t.key)],
);
