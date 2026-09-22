/**
 * Provider adapter contract. Every connector (mock, acquirer, PSP, bank, local method)
 * implements this interface. The orchestration engine never contains provider-specific logic.
 */
import type { NextAction, PayoutDestination } from "../db/schema/index.js";
import type { ProviderAccountConfig } from "../db/schema/index.js";

export type ProviderOutcome =
  | "success"
  | "requires_action"
  | "soft_decline"
  | "hard_decline"
  | "technical_error"
  | "timeout"
  | "provider_unavailable";

export type ProviderPaymentStatus = "pending" | "authorized" | "captured" | "failed" | "cancelled" | "refunded";

export interface ProviderContext {
  providerAccountId: string;
  providerId: string;
  providerCode: string;
  mode: "test" | "live";
  /** Decrypted credentials (never logged). */
  credentials: Record<string, unknown>;
  config: ProviderAccountConfig;
  timeoutMs: number;
}

export interface CustomerRef {
  id?: string;
  email?: string;
  name?: string;
  country?: string;
}

export interface CreatePaymentInput {
  paymentId: string;
  amount: number;
  currency: string;
  paymentMethodType: string;
  captureMethod: "automatic" | "manual";
  country?: string;
  customer?: CustomerRef;
  description?: string;
  reference?: string;
  returnUrl?: string;
  /** Provider token of a stored payment method (never raw card data). */
  paymentMethodToken?: string;
  metadata?: Record<string, unknown>;
  /** Sandbox only: primitive outcome hint understood by mock adapters. */
  simulate?: string;
}

export interface ProviderPaymentResult {
  outcome: ProviderOutcome;
  providerPaymentId?: string;
  status?: ProviderPaymentStatus;
  providerCode?: string;
  providerMessage?: string;
  failureCode?: string;
  nextAction?: NextAction;
  raw?: Record<string, unknown>;
}

export interface ProviderLookupResult {
  found: boolean;
  status?: ProviderPaymentStatus;
  amount?: number;
  capturedAmount?: number;
  providerPaymentId?: string;
  raw?: Record<string, unknown>;
}

export interface ProviderOperationResult {
  outcome: ProviderOutcome;
  providerReference?: string;
  providerCode?: string;
  providerMessage?: string;
  failureCode?: string;
  raw?: Record<string, unknown>;
}

export interface CreatePayoutInput {
  payoutId: string;
  amount: number;
  currency: string;
  destination: PayoutDestination;
  description?: string;
  reference?: string;
  simulate?: string;
}

export interface ProviderPayoutResult extends ProviderOperationResult {
  status?: "pending" | "processing" | "successful" | "failed";
}

export interface NormalizedProviderEvent {
  /** Provider-side unique event id, for dedupe. */
  eventId: string;
  kind: "payment" | "refund" | "payout";
  providerReference: string;
  status: ProviderPaymentStatus | "successful" | "processing";
  amount?: number;
  currency?: string;
  failureCode?: string;
  providerMessage?: string;
  raw?: Record<string, unknown>;
}

export interface WebhookVerification {
  valid: boolean;
  event?: NormalizedProviderEvent;
  reason?: string;
}

export interface ProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  createPayment(ctx: ProviderContext, input: CreatePaymentInput): Promise<ProviderPaymentResult>;
  getPayment(ctx: ProviderContext, providerPaymentId: string): Promise<ProviderLookupResult>;
  /**
   * Look up a payment by NATIO's own reference (payment id) — used after a timeout when no
   * provider id was received, to decide whether a failover is safe. Optional: when a provider
   * cannot search by merchant reference, a timed-out attempt stays "unknown" and is synced later.
   */
  findPaymentByReference?(ctx: ProviderContext, reference: string): Promise<ProviderLookupResult>;
  capturePayment(ctx: ProviderContext, input: { providerPaymentId: string; amount: number; currency: string }): Promise<ProviderOperationResult>;
  cancelPayment(ctx: ProviderContext, input: { providerPaymentId: string }): Promise<ProviderOperationResult>;
  refundPayment(
    ctx: ProviderContext,
    input: { providerPaymentId: string; refundId: string; amount: number; currency: string; simulate?: string },
  ): Promise<ProviderOperationResult>;
  createPayout(ctx: ProviderContext, input: CreatePayoutInput): Promise<ProviderPayoutResult>;
  getPayout(ctx: ProviderContext, providerPayoutId: string): Promise<ProviderLookupResult>;
  verifyWebhook(ctx: ProviderContext, input: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookVerification>;
  healthCheck?(ctx: ProviderContext): Promise<{ ok: boolean; latencyMs: number; message?: string }>;
}

export class ProviderTimeoutError extends Error {
  constructor(message = "provider request timed out") {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message = "provider unavailable") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}
