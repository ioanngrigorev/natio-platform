/**
 * NATIO Demo provider adapters (mock). They behave like a real provider from the
 * orchestration engine's point of view: they keep their own ledger (mock_provider_records),
 * answer status lookups, support capture/cancel/refund/payout and emit signed webhooks.
 *
 * Simulation is controlled by (in order of precedence):
 *   1. provider account config.simulation.forceOutcome (admin-triggered outage / decline)
 *   2. the per-request `simulate` hint (sandbox test scenarios)
 *   3. config.simulation.technicalErrorRate (random technical errors)
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { mockProviderRecords } from "../../db/schema/index.js";
import { hmacSha256Hex, safeEqual } from "../../lib/crypto.js";
import { newId, randomString } from "../../lib/ids.js";
import { loadConfig } from "../../config.js";
import {
  ProviderTimeoutError,
  ProviderUnavailableError,
  type CreatePaymentInput,
  type CreatePayoutInput,
  type ProviderAdapter,
  type ProviderContext,
  type ProviderLookupResult,
  type ProviderOperationResult,
  type ProviderPaymentResult,
  type ProviderPayoutResult,
  type WebhookVerification,
} from "../types.js";

export type MockKind = "acquirer" | "qr";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MOCK_PRIMITIVES = [
  "success",
  "authorize",
  "requires_action",
  "soft_decline",
  "hard_decline",
  "technical_error",
  "timeout",
  "timeout_created",
  "provider_unavailable",
] as const;
export type MockPrimitive = (typeof MOCK_PRIMITIVES)[number];

function resolveSimulation(ctx: ProviderContext, hint: string | undefined): MockPrimitive | null {
  const forced = ctx.config.simulation?.forceOutcome;
  if (forced) return forced as MockPrimitive;
  if (hint && (MOCK_PRIMITIVES as readonly string[]).includes(hint)) return hint as MockPrimitive;
  const rate = ctx.config.simulation?.technicalErrorRate ?? 0;
  if (rate > 0 && Math.random() < rate) return "technical_error";
  return null;
}

export class MockProviderAdapter implements ProviderAdapter {
  constructor(
    public readonly key: string,
    public readonly displayName: string,
    private readonly kind: MockKind,
  ) {}

  private async latency(ctx: ProviderContext) {
    const ms = ctx.config.simulation?.latencyMs ?? (this.kind === "qr" ? 60 : 40);
    await sleep(Math.min(ms, 2000));
  }

  private extId(prefix: string) {
    return `${prefix}_${this.key}_${randomString(14)}`;
  }

  async createPayment(ctx: ProviderContext, input: CreatePaymentInput): Promise<ProviderPaymentResult> {
    await this.latency(ctx);
    const sim = resolveSimulation(ctx, input.simulate);
    const db = getDb();
    const externalId = this.extId("mp");
    const raw = { gateway: this.key, request_id: randomString(10), simulated: sim ?? "default" };

    switch (sim) {
      case "provider_unavailable":
        throw new ProviderUnavailableError(`${this.displayName} returned HTTP 503`);
      case "timeout":
        throw new ProviderTimeoutError(`${this.displayName} did not respond within ${ctx.timeoutMs}ms`);
      case "technical_error":
        return {
          outcome: "technical_error",
          providerCode: "GW-500",
          providerMessage: "Internal gateway error",
          failureCode: "technical_error",
          raw,
        };
      case "soft_decline":
        return { outcome: "soft_decline", providerCode: "51", providerMessage: "Insufficient funds", failureCode: "insufficient_funds", raw };
      case "hard_decline":
        return { outcome: "hard_decline", providerCode: "43", providerMessage: "Stolen card, pick up", failureCode: "stolen_card", raw };
      default:
        break;
    }

    const isQr = this.kind === "qr";
    const requiresAction = sim === "requires_action" || (isQr && sim !== "success" && sim !== "authorize" && sim !== "timeout_created");
    const authorizeOnly = sim === "authorize" || (input.captureMethod === "manual" && !isQr);

    let status: "pending" | "authorized" | "captured";
    if (requiresAction) status = "pending";
    else if (authorizeOnly) status = "authorized";
    else status = "captured";

    await db.insert(mockProviderRecords).values({
      id: newId("transition"),
      providerAccountId: ctx.providerAccountId,
      kind: "payment",
      externalId,
      natioReference: input.paymentId,
      status,
      amount: input.amount,
      capturedAmount: status === "captured" ? input.amount : 0,
      currency: input.currency,
      data: { method: input.paymentMethodType, country: input.country ?? null, reference: input.reference ?? null },
    });

    if (sim === "timeout_created") {
      // The provider processed the payment but the response was lost on the network.
      throw new ProviderTimeoutError(`${this.displayName} response lost after processing`);
    }

    if (requiresAction) {
      const cfg = loadConfig();
      const nextAction = isQr
        ? {
            type: "qr_code" as const,
            qrPayload: `NATIO-DEMO-QR|${externalId}|${input.amount}|${input.currency}`,
            url: `${cfg.PUBLIC_API_URL}/sandbox/hosted/${ctx.providerAccountId}/${externalId}`,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          }
        : {
            type: "redirect" as const,
            url: `${cfg.PUBLIC_API_URL}/sandbox/hosted/${ctx.providerAccountId}/${externalId}`,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          };
      return { outcome: "requires_action", providerPaymentId: externalId, status: "pending", nextAction, raw };
    }

    return {
      outcome: "success",
      providerPaymentId: externalId,
      status,
      providerCode: "00",
      providerMessage: status === "authorized" ? "Authorised" : "Approved",
      raw,
    };
  }

  async getPayment(ctx: ProviderContext, providerPaymentId: string): Promise<ProviderLookupResult> {
    await this.latency(ctx);
    const [rec] = await getDb()
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, ctx.providerAccountId), eq(mockProviderRecords.externalId, providerPaymentId)))
      .limit(1);
    if (!rec) return { found: false };
    return {
      found: true,
      status: rec.status as ProviderLookupResult["status"],
      amount: rec.amount,
      capturedAmount: rec.capturedAmount,
      providerPaymentId: rec.externalId,
      raw: { status: rec.status },
    };
  }

  /** Look up by NATIO payment id — used after a timeout where no provider id is known. */
  async findPaymentByReference(ctx: ProviderContext, reference: string): Promise<ProviderLookupResult> {
    const [rec] = await getDb()
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, ctx.providerAccountId), eq(mockProviderRecords.natioReference, reference), eq(mockProviderRecords.kind, "payment")))
      .limit(1);
    if (!rec) return { found: false };
    return { found: true, status: rec.status as ProviderLookupResult["status"], amount: rec.amount, capturedAmount: rec.capturedAmount, providerPaymentId: rec.externalId };
  }

  async capturePayment(ctx: ProviderContext, input: { providerPaymentId: string; amount: number; currency: string }): Promise<ProviderOperationResult> {
    await this.latency(ctx);
    const db = getDb();
    const [rec] = await db
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, ctx.providerAccountId), eq(mockProviderRecords.externalId, input.providerPaymentId)))
      .limit(1);
    if (!rec) return { outcome: "hard_decline", failureCode: "invalid_account", providerMessage: "Unknown payment" };
    if (rec.status !== "authorized") return { outcome: "hard_decline", failureCode: "invalid_account", providerMessage: `Cannot capture in status ${rec.status}` };
    if (input.amount > rec.amount) return { outcome: "hard_decline", failureCode: "amount_out_of_limits", providerMessage: "Capture exceeds authorisation" };
    await db
      .update(mockProviderRecords)
      .set({ status: "captured", capturedAmount: input.amount, updatedAt: new Date() })
      .where(eq(mockProviderRecords.id, rec.id));
    return { outcome: "success", providerReference: `cap_${randomString(10)}`, providerCode: "00" };
  }

  async cancelPayment(ctx: ProviderContext, input: { providerPaymentId: string }): Promise<ProviderOperationResult> {
    await this.latency(ctx);
    const db = getDb();
    const [rec] = await db
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, ctx.providerAccountId), eq(mockProviderRecords.externalId, input.providerPaymentId)))
      .limit(1);
    if (!rec) return { outcome: "hard_decline", failureCode: "invalid_account", providerMessage: "Unknown payment" };
    if (rec.status !== "authorized" && rec.status !== "pending") {
      return { outcome: "hard_decline", failureCode: "invalid_account", providerMessage: `Cannot cancel in status ${rec.status}` };
    }
    await db.update(mockProviderRecords).set({ status: "cancelled", updatedAt: new Date() }).where(eq(mockProviderRecords.id, rec.id));
    return { outcome: "success", providerReference: `void_${randomString(10)}`, providerCode: "00" };
  }

  async refundPayment(
    ctx: ProviderContext,
    input: { providerPaymentId: string; refundId: string; amount: number; currency: string; simulate?: string },
  ): Promise<ProviderOperationResult> {
    await this.latency(ctx);
    const db = getDb();
    const [rec] = await db
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, ctx.providerAccountId), eq(mockProviderRecords.externalId, input.providerPaymentId)))
      .limit(1);
    if (!rec) return { outcome: "hard_decline", failureCode: "invalid_account", providerMessage: "Unknown payment" };
    if (rec.status !== "captured" && rec.status !== "refunded") {
      return { outcome: "hard_decline", failureCode: "invalid_account", providerMessage: `Cannot refund in status ${rec.status}` };
    }
    if (input.simulate === "technical_error") return { outcome: "technical_error", failureCode: "technical_error", providerMessage: "Refund gateway error" };
    if (input.simulate === "hard_decline") return { outcome: "hard_decline", failureCode: "generic_decline", providerMessage: "Refund rejected by issuer" };
    const remaining = rec.capturedAmount - rec.refundedAmount;
    if (input.amount > remaining) return { outcome: "hard_decline", failureCode: "amount_out_of_limits", providerMessage: "Refund exceeds captured amount" };
    const refundedAmount = rec.refundedAmount + input.amount;
    const externalId = this.extId("mrf");
    await db.transaction(async (tx) => {
      await tx
        .update(mockProviderRecords)
        .set({ refundedAmount, status: refundedAmount >= rec.capturedAmount ? "refunded" : "captured", updatedAt: new Date() })
        .where(eq(mockProviderRecords.id, rec.id));
      await tx.insert(mockProviderRecords).values({
        id: newId("transition"),
        providerAccountId: ctx.providerAccountId,
        kind: "refund",
        externalId,
        natioReference: input.refundId,
        status: "successful",
        amount: input.amount,
        currency: input.currency,
        data: { payment: rec.externalId },
      });
    });
    return { outcome: "success", providerReference: externalId, providerCode: "00" };
  }

  async createPayout(ctx: ProviderContext, input: CreatePayoutInput): Promise<ProviderPayoutResult> {
    await this.latency(ctx);
    const sim = resolveSimulation(ctx, input.simulate);
    if (sim === "provider_unavailable") throw new ProviderUnavailableError(`${this.displayName} payouts unavailable`);
    if (sim === "timeout") throw new ProviderTimeoutError(`${this.displayName} payout timed out`);
    if (sim === "technical_error") return { outcome: "technical_error", failureCode: "technical_error", providerMessage: "Payout gateway error" };
    if (sim === "hard_decline") return { outcome: "hard_decline", failureCode: "invalid_account", providerMessage: "Beneficiary account invalid" };
    const externalId = this.extId("mpo");
    await getDb().insert(mockProviderRecords).values({
      id: newId("transition"),
      providerAccountId: ctx.providerAccountId,
      kind: "payout",
      externalId,
      natioReference: input.payoutId,
      status: "successful",
      amount: input.amount,
      currency: input.currency,
      data: { destination: input.destination.display },
    });
    return { outcome: "success", providerReference: externalId, status: "successful", providerCode: "00" };
  }

  async getPayout(ctx: ProviderContext, providerPayoutId: string): Promise<ProviderLookupResult> {
    const [rec] = await getDb()
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, ctx.providerAccountId), eq(mockProviderRecords.externalId, providerPayoutId)))
      .limit(1);
    if (!rec) return { found: false };
    return { found: true, status: rec.status === "successful" ? "captured" : (rec.status as never), amount: rec.amount, providerPaymentId: rec.externalId };
  }

  /**
   * Mock webhooks are signed with HMAC-SHA256 over the raw body using credentials.webhookSecret,
   * sent in the `X-Mock-Signature` header.
   */
  async verifyWebhook(ctx: ProviderContext, input: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookVerification> {
    const secret = String(ctx.credentials.webhookSecret ?? "");
    const header = input.headers["x-mock-signature"];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!secret || !sig) return { valid: false, reason: "missing signature" };
    const expected = hmacSha256Hex(secret, input.rawBody);
    if (!safeEqual(expected, sig)) return { valid: false, reason: "signature mismatch" };
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      return { valid: false, reason: "invalid json" };
    }
    const kind = String(body.kind ?? "payment") as "payment" | "refund" | "payout";
    return {
      valid: true,
      event: {
        eventId: String(body.event_id),
        kind,
        providerReference: String(body.external_id),
        status: body.status as never,
        amount: typeof body.amount === "number" ? body.amount : undefined,
        currency: typeof body.currency === "string" ? body.currency : undefined,
        failureCode: typeof body.failure_code === "string" ? body.failure_code : undefined,
        providerMessage: typeof body.message === "string" ? body.message : undefined,
        raw: body,
      },
    };
  }

  async healthCheck(ctx: ProviderContext) {
    const started = Date.now();
    await this.latency(ctx);
    const forced = ctx.config.simulation?.forceOutcome;
    const ok = forced !== "provider_unavailable" && forced !== "timeout";
    return { ok, latencyMs: Date.now() - started, message: ok ? "Demo provider reachable" : `Simulated outage (${forced})` };
  }

  /** Sandbox helper: transition a pending provider record (customer completed hosted page / QR). */
  async completeHosted(ctx: ProviderContext, externalId: string, approve: boolean) {
    const db = getDb();
    const [rec] = await db
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, ctx.providerAccountId), eq(mockProviderRecords.externalId, externalId)))
      .limit(1);
    if (!rec || rec.status !== "pending") return null;
    const status = approve ? "captured" : "failed";
    await db
      .update(mockProviderRecords)
      .set({ status, capturedAmount: approve ? rec.amount : 0, updatedAt: new Date() })
      .where(eq(mockProviderRecords.id, rec.id));
    return { ...rec, status };
  }
}
