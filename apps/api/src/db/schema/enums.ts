import { pgEnum } from "drizzle-orm/pg-core";

export const modeEnum = pgEnum("mode", ["test", "live"]);

export const merchantStatusEnum = pgEnum("merchant_status", ["active", "disabled"]);
export const kybStatusEnum = pgEnum("kyb_status", ["not_started", "pending", "approved", "rejected"]);
export const merchantRoleEnum = pgEnum("merchant_role", [
  "owner",
  "admin",
  "developer",
  "finance",
  "analyst",
  "support",
  "viewer",
]);
export const userStatusEnum = pgEnum("user_status", ["invited", "active", "disabled"]);
export const adminRoleEnum = pgEnum("admin_role", ["superadmin", "operations", "support", "readonly"]);
export const sessionKindEnum = pgEnum("session_kind", ["merchant", "admin"]);

export const providerTypeEnum = pgEnum("provider_type", [
  "acquirer",
  "psp",
  "bank",
  "qr",
  "wallet",
  "open_banking",
  "local",
]);
export const providerStatusEnum = pgEnum("provider_status", ["active", "disabled"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "disabled"]);

export const paymentMethodTypeEnum = pgEnum("payment_method_type", [
  "card",
  "bank_transfer",
  "qr",
  "open_banking",
  "wallet",
  "instant",
  "local",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "created",
  "pending",
  "processing",
  "authorized",
  "captured",
  "successful",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
export const captureMethodEnum = pgEnum("capture_method", ["automatic", "manual"]);

export const attemptStatusEnum = pgEnum("attempt_status", [
  "created",
  "processing",
  "unknown",
  "authorized",
  "succeeded",
  "failed",
  "cancelled",
]);
export const attemptOutcomeEnum = pgEnum("attempt_outcome", [
  "success",
  "requires_action",
  "soft_decline",
  "hard_decline",
  "technical_error",
  "timeout",
  "provider_unavailable",
  "unknown",
]);

export const refundStatusEnum = pgEnum("refund_status", ["created", "processing", "successful", "failed"]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "created",
  "pending",
  "processing",
  "successful",
  "failed",
  "cancelled",
]);

export const transactionTypeEnum = pgEnum("transaction_type", ["payment", "refund", "payout", "fee", "adjustment"]);
export const transactionStatusEnum = pgEnum("transaction_status", ["pending", "successful", "failed", "cancelled"]);

export const routingStrategyEnum = pgEnum("routing_strategy", ["ordered", "weighted", "score"]);

export const riskActionEnum = pgEnum("risk_action", ["allow", "review", "block"]);

export const settlementStatusEnum = pgEnum("settlement_status", ["pending", "settled", "failed"]);
export const settlementSourceEnum = pgEnum("settlement_source", ["provider_report", "provider_api", "manual"]);

export const reconSourceEnum = pgEnum("recon_source", ["csv", "api"]);
export const reconBatchStatusEnum = pgEnum("recon_batch_status", ["processing", "completed", "failed"]);
export const reconItemStatusEnum = pgEnum("recon_item_status", [
  "MATCHED",
  "MISSING_PROVIDER",
  "MISSING_NATIO",
  "AMOUNT_MISMATCH",
  "STATUS_MISMATCH",
]);

export const webhookEndpointStatusEnum = pgEnum("webhook_endpoint_status", ["active", "disabled"]);
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivering",
  "succeeded",
  "failed",
  "exhausted",
]);

export const actorTypeEnum = pgEnum("actor_type", ["merchant_user", "admin_user", "api_key", "system"]);
export const eventLevelEnum = pgEnum("event_level", ["info", "warning", "error"]);
