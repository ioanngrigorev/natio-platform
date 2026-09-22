import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import { paymentAttempts, payments, providerAccounts, providers, refunds } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { formatMinor } from "../../lib/money.js";
import { buildProviderContext } from "../../providers/context.js";
import { failureInfo } from "../../providers/failure-codes.js";
import { getAdapter } from "../../providers/registry.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { addTimeline, emitEvent, enqueueDeliveries } from "../events/service.js";
import type { PaymentRow } from "../payments/orchestrator.js";
import { getPaymentRow } from "../payments/service.js";
import { serializePayment } from "../payments/serialize.js";
import { applyTransition } from "../payments/state-machine.js";
import { recordTransaction } from "../transactions/service.js";

export type RefundRow = typeof refunds.$inferSelect;

export function serializeRefund(r: RefundRow) {
  const failure = r.failureCode ? failureInfo(r.failureCode) : null;
  return {
    id: r.id,
    object: "refund",
    mode: r.mode,
    payment_id: r.paymentId,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    reason: r.reason,
    provider_account_id: r.providerAccountId,
    provider_refund_id: r.providerRefundId,
    failure: failure ? { code: failure.code, message: r.failureMessage ?? failure.message } : null,
    metadata: r.metadata,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export async function createRefund(
  db: Db,
  payment: PaymentRow,
  input: { amount?: number; reason?: string; metadata?: Record<string, unknown>; idempotencyKey?: string; test_scenario?: string },
  actor: Actor,
): Promise<RefundRow> {
  if (!["successful", "partially_refunded"].includes(payment.status)) {
    throw Errors.conflict("payment_not_refundable", `Payment in status ${payment.status} cannot be refunded`);
  }
  if (!payment.providerAccountId || !payment.providerPaymentId) throw Errors.conflict("missing_provider_reference", "Payment has no provider reference");

  const [prow] = await db
    .select({ account: providerAccounts, provider: providers })
    .from(providerAccounts)
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(eq(providerAccounts.id, payment.providerAccountId))
    .limit(1);
  if (!prow) throw Errors.internal();

  /*
   * Reserve the amount before talking to the provider. `payments.refunded_amount` is only
   * written once the provider confirms, so two concurrent requests would both see the full
   * remaining balance and both send a refund — a provider without its own de-duplication
   * would pay out twice. Locking the payment row and counting refunds that are still in
   * flight makes the check-and-reserve atomic.
   */
  const { refund, amount } = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, payment.id)).for("update").limit(1);
    if (!locked || !["successful", "partially_refunded"].includes(locked.status)) {
      throw Errors.conflict("payment_not_refundable", `Payment in status ${locked?.status ?? "unknown"} cannot be refunded`);
    }
    const [pending] = await tx
      .select({ total: sql<number>`coalesce(sum(${refunds.amount}), 0)`.mapWith(Number) })
      .from(refunds)
      .where(and(eq(refunds.paymentId, payment.id), inArray(refunds.status, ["created", "processing"])));
    const refundable = locked.capturedAmount - locked.refundedAmount - (pending?.total ?? 0);
    const requested = input.amount ?? refundable;
    if (requested <= 0 || requested > refundable) {
      throw Errors.badRequest("refund_amount_invalid", `Refund amount must be between 1 and ${Math.max(refundable, 0)}`, "amount");
    }
    const [row] = await tx
      .insert(refunds)
      .values({
        id: newId("refund"),
        paymentId: payment.id,
        merchantId: payment.merchantId,
        projectId: payment.projectId,
        mode: payment.mode,
        amount: requested,
        currency: payment.currency,
        status: "created",
        reason: input.reason ?? null,
        providerAccountId: prow.account.id,
        idempotencyKey: input.idempotencyKey ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    await applyTransition(tx, "refund", row!.id, "created", "processing", { reason: "sent_to_provider", actor: { type: actor.type, id: actor.id } });
    return { refund: row, amount: requested };
  });
  await addTimeline(db, {
    paymentId: payment.id,
    type: "refund.created",
    title: "Refund requested",
    description: `${formatMinor(amount, payment.currency)} · ${refund!.id}`,
    data: { refund_id: refund!.id, amount },
  });

  const ctx = buildProviderContext(prow.account, prow.provider);
  const adapter = getAdapter(prow.provider.adapterKey);
  let outcome: Awaited<ReturnType<typeof adapter.refundPayment>>;
  try {
    outcome = await adapter.refundPayment(ctx, {
      providerPaymentId: payment.providerPaymentId,
      refundId: refund!.id,
      amount,
      currency: payment.currency,
      simulate: payment.mode === "test" ? input.test_scenario : undefined,
    });
  } catch (err) {
    outcome = { outcome: "technical_error", failureCode: "technical_error", providerMessage: err instanceof Error ? err.message : "adapter error" };
  }

  if (outcome.outcome !== "success") {
    const code = outcome.failureCode ?? "technical_error";
    const deliveries = await db.transaction(async (tx) => {
      const failed = await applyTransition(tx, "refund", refund!.id, "processing", "failed", {
        reason: code,
        actor: { type: actor.type, id: actor.id },
        set: { failureCode: code, failureMessage: outcome.providerMessage ?? null },
      });
      await recordTransaction(tx, {
        merchantId: payment.merchantId,
        projectId: payment.projectId,
        mode: payment.mode,
        type: "refund",
        status: "failed",
        entityType: "refund",
        entityId: refund!.id,
        paymentId: payment.id,
        amount: -amount,
        currency: payment.currency,
        providerAccountId: prow.account.id,
        providerId: prow.provider.id,
        providerReference: `${refund!.id}:failed`,
        paymentMethodType: payment.paymentMethodType,
        country: payment.country,
        failureCode: code,
      });
      await addTimeline(tx, { paymentId: payment.id, type: "refund.failed", title: "Refund failed", description: `${prow.provider.name} · ${outcome.providerMessage ?? code}`, data: { refund_id: refund!.id, failure_code: code } });
      await recordAudit(tx, { actor, merchantId: payment.merchantId, action: "refund.failed", entityType: "refund", entityId: refund!.id, after: { amount, code } });
      const ev = await emitEvent(tx, { merchantId: payment.merchantId, projectId: payment.projectId, mode: payment.mode, type: "refund.failed", entityType: "refund", entityId: refund!.id, data: serializeRefund(failed as RefundRow) });
      return ev.deliveryIds;
    });
    await enqueueDeliveries(deliveries);
    return (await getRefund(db, refund!.id))!;
  }

  const deliveries = await db.transaction(async (tx) => {
    const done = await applyTransition(tx, "refund", refund!.id, "processing", "successful", {
      reason: "provider_confirmed",
      actor: { type: actor.type, id: actor.id },
      set: { providerRefundId: outcome.providerReference ?? null },
    });
    // Re-read the payment under lock: a concurrent refund may have moved refunded_amount and
    // the status since this request started, and the running total has to include both.
    const [current] = await tx.select().from(payments).where(eq(payments.id, payment.id)).for("update").limit(1);
    const newRefunded = (current?.refundedAmount ?? payment.refundedAmount) + amount;
    const capturedAmount = current?.capturedAmount ?? payment.capturedAmount;
    const paymentTo = newRefunded >= capturedAmount ? "refunded" : "partially_refunded";
    const updatedPayment = await applyTransition(tx, "payment", payment.id, current?.status ?? payment.status, paymentTo, {
      reason: `refund ${refund!.id}`,
      actor: { type: actor.type, id: actor.id },
      set: { refundedAmount: newRefunded },
    });
    await recordTransaction(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: "refund",
      status: "successful",
      entityType: "refund",
      entityId: refund!.id,
      paymentId: payment.id,
      amount: -amount,
      currency: payment.currency,
      providerAccountId: prow.account.id,
      providerId: prow.provider.id,
      providerReference: outcome.providerReference ?? refund!.id,
      paymentMethodType: payment.paymentMethodType,
      country: payment.country,
    });
    await addTimeline(tx, {
      paymentId: payment.id,
      type: "refund.successful",
      title: "Refund successful",
      description: `${formatMinor(amount, payment.currency)} refunded via ${prow.provider.name}`,
      data: { refund_id: refund!.id, provider_refund_id: outcome.providerReference ?? null },
    });
    await recordAudit(tx, { actor, merchantId: payment.merchantId, action: "refund.created", entityType: "refund", entityId: refund!.id, after: { amount, reason: input.reason } });
    const ev1 = await emitEvent(tx, { merchantId: payment.merchantId, projectId: payment.projectId, mode: payment.mode, type: "refund.successful", entityType: "refund", entityId: refund!.id, data: serializeRefund(done as RefundRow) });
    const ev2 = await emitEvent(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: "payment.refunded",
      entityType: "payment",
      entityId: payment.id,
      data: serializePayment(updatedPayment as PaymentRow, { provider: prow.provider, account: prow.account }),
    });
    return [...ev1.deliveryIds, ...ev2.deliveryIds];
  });
  await enqueueDeliveries(deliveries);
  void paymentAttempts;
  return (await getRefund(db, refund!.id))!;
}

export async function getRefund(db: DbOrTx, id: string, scope?: { merchantId: string }) {
  const conds = [eq(refunds.id, id)];
  if (scope) conds.push(eq(refunds.merchantId, scope.merchantId));
  const [r] = await db
    .select()
    .from(refunds)
    .where(and(...conds))
    .limit(1);
  return r ?? null;
}

export async function listRefundsForPayment(db: DbOrTx, paymentId: string) {
  return db.select().from(refunds).where(eq(refunds.paymentId, paymentId)).orderBy(desc(refunds.createdAt));
}

export { getPaymentRow };
