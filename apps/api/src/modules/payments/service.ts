import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import { customers, paymentAttempts, paymentMethods, payments, projects, providerAccounts, providers, routingDecisions } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { logger } from "../../lib/logger.js";
import { buildProviderContext } from "../../providers/context.js";
import { getAdapter } from "../../providers/registry.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { addTimeline, emitEvent, enqueueDeliveries, listTimeline } from "../events/service.js";
import { assessPayment, computeVelocity } from "../risk/service.js";
import { recordTransaction } from "../transactions/service.js";
import { failPayment, runOrchestration, type PaymentRow } from "./orchestrator.js";
import type { CreatePaymentInput } from "./schemas.js";
import { serializePayment, type SerializeOpts } from "./serialize.js";
import { applyTransition } from "./state-machine.js";
import { computeFee, formatMinor } from "../../lib/money.js";

export interface PaymentScope {
  merchantId: string;
  projectId: string;
  mode: "test" | "live";
}

async function resolveCustomer(tx: DbOrTx, scope: PaymentScope, input: CreatePaymentInput["customer"] | undefined) {
  if (!input) return null;
  if (input.id) {
    const [c] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.id), eq(customers.merchantId, scope.merchantId), eq(customers.mode, scope.mode)))
      .limit(1);
    if (!c) throw Errors.notFound("Customer", input.id);
    return c;
  }
  if (input.external_id) {
    const [c] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.projectId, scope.projectId), eq(customers.mode, scope.mode), eq(customers.externalId, input.external_id)))
      .limit(1);
    if (c) {
      if (input.email || input.name || input.country) {
        await tx
          .update(customers)
          .set({ email: input.email ?? c.email, name: input.name ?? c.name, country: input.country ?? c.country })
          .where(eq(customers.id, c.id));
      }
      return c;
    }
  }
  const [created] = await tx
    .insert(customers)
    .values({
      id: newId("customer"),
      merchantId: scope.merchantId,
      projectId: scope.projectId,
      mode: scope.mode,
      externalId: input.external_id ?? null,
      email: input.email ?? null,
      name: input.name ?? null,
      country: input.country ?? null,
      metadata: {},
    })
    .returning();
  return created!;
}

/**
 * Create and orchestrate a payment. Returns the payment after synchronous processing:
 * successful / authorized / failed, or processing with next_action (async methods), or pending (review).
 */
export async function createPayment(
  db: Db,
  scope: PaymentScope,
  input: CreatePaymentInput,
  opts: { actor: Actor; ip?: string; userAgent?: string; idempotencyKey?: string },
): Promise<PaymentRow> {
  const [project] = await db.select().from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  if (!project) throw Errors.notFound("Project", scope.projectId);
  const method = typeof input.payment_method === "string" ? { type: input.payment_method } : input.payment_method;

  let paymentMethodId: string | null = null;
  if (method.id) {
    const [pm] = await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.id, method.id), eq(paymentMethods.merchantId, scope.merchantId), eq(paymentMethods.mode, scope.mode)))
      .limit(1);
    if (!pm) throw Errors.notFound("Payment method", method.id);
    paymentMethodId = pm.id;
  }

  const created = await db.transaction(async (tx) => {
    const customer = await resolveCustomer(tx, scope, input.customer);
    const id = newId("payment");
    const [payment] = await tx
      .insert(payments)
      .values({
        id,
        merchantId: scope.merchantId,
        projectId: scope.projectId,
        mode: scope.mode,
        customerId: customer?.id ?? null,
        amount: input.amount,
        currency: input.currency,
        status: "created",
        captureMethod: input.capture_method ?? project.settings.captureMethod ?? "automatic",
        paymentMethodType: method.type,
        paymentMethodId,
        country: input.country ?? customer?.country ?? null,
        description: input.description ?? null,
        reference: input.reference ?? null,
        metadata: input.metadata ?? {},
        idempotencyKey: opts.idempotencyKey ?? null,
        returnUrl: input.return_url ?? null,
        device: { ip: input.device?.ip ?? opts.ip, userAgent: input.device?.user_agent ?? opts.userAgent, fingerprint: input.device?.fingerprint },
        testScenario: scope.mode === "test" ? (input.test_scenario ?? null) : null,
      })
      .returning();
    await addTimeline(tx, {
      paymentId: id,
      type: "payment.created",
      title: "Payment created",
      description: `${formatMinor(input.amount, input.currency)} · ${method.type}${input.country ? ` · ${input.country}` : ""}`,
      data: { amount: input.amount, currency: input.currency, method: method.type, reference: input.reference ?? null },
    });
    const ev = await emitEvent(tx, {
      merchantId: scope.merchantId,
      projectId: scope.projectId,
      mode: scope.mode,
      type: "payment.created",
      entityType: "payment",
      entityId: id,
      data: serializePayment(payment as PaymentRow, { customer }),
    });
    return { payment: payment as PaymentRow, customer, deliveryIds: ev.deliveryIds };
  });
  await enqueueDeliveries(created.deliveryIds);

  // Risk assessment
  const velocity = await computeVelocity(db, { merchantId: scope.merchantId, mode: scope.mode, customerId: created.customer?.id, ip: created.payment.device.ip });
  const risk = await assessPayment(
    db,
    created.payment.id,
    {
      country: created.payment.country,
      amount: input.amount,
      currency: input.currency,
      paymentMethod: method.type,
      merchantId: scope.merchantId,
      ip: created.payment.device.ip,
      deviceFingerprint: created.payment.device.fingerprint,
      customerEmail: created.customer?.email,
      testScenario: created.payment.testScenario,
      ...velocity,
    },
    scope.mode,
  );
  await db.update(payments).set({ riskDecisionId: risk.decisionId, riskScore: risk.score }).where(eq(payments.id, created.payment.id));
  await addTimeline(db, {
    paymentId: created.payment.id,
    type: "risk.evaluated",
    title: `Risk evaluated: ${risk.decision.toUpperCase()}`,
    description: risk.matched.length ? `score ${risk.score} · ${risk.matched.map((m) => m.name).join(", ")}` : `score ${risk.score} · no rules matched`,
    data: { decision: risk.decision, score: risk.score, matched: risk.matched },
  });

  const actor = { type: opts.actor.type, id: opts.actor.id };
  if (risk.decision === "block") {
    await failPayment(db, created.payment, { code: "risk_blocked", from: "created", actor }, created.payment.createdAt.getTime());
    return (await getPaymentRow(db, created.payment.id))!;
  }
  if (risk.decision === "review") {
    await applyTransition(db, "payment", created.payment.id, "created", "pending", { reason: "risk_review", actor });
    await addTimeline(db, {
      paymentId: created.payment.id,
      type: "risk.review",
      title: "Manual review required",
      description: "Payment is on hold until an operator approves or rejects it",
      data: {},
    });
    return (await getPaymentRow(db, created.payment.id))!;
  }

  try {
    return await runOrchestration(db, created.payment.id, actor);
  } catch (err) {
    logger.error({ err, paymentId: created.payment.id }, "orchestration crashed");
    const current = await getPaymentRow(db, created.payment.id);
    if (current && current.status === "processing") {
      await failPayment(db, current, { code: "technical_error", message: "orchestration error", from: "processing", actor }, created.payment.createdAt.getTime());
    }
    return (await getPaymentRow(db, created.payment.id))!;
  }
}

export async function getPaymentRow(db: DbOrTx, id: string): Promise<PaymentRow | null> {
  const [p] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return p ?? null;
}

export async function getPaymentDetail(db: DbOrTx, id: string, scope?: { merchantId: string; mode?: "test" | "live" }) {
  const conds = [eq(payments.id, id)];
  if (scope) conds.push(eq(payments.merchantId, scope.merchantId));
  if (scope?.mode) conds.push(eq(payments.mode, scope.mode));
  const [row] = await db
    .select({ payment: payments, provider: providers, account: providerAccounts, customer: customers })
    .from(payments)
    .leftJoin(providers, eq(providers.id, payments.providerId))
    .leftJoin(providerAccounts, eq(providerAccounts.id, payments.providerAccountId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .where(and(...conds))
    .limit(1);
  if (!row) return null;
  const attempts = await db
    .select({ a: paymentAttempts, providerName: providers.name, accountName: providerAccounts.name })
    .from(paymentAttempts)
    .innerJoin(providers, eq(providers.id, paymentAttempts.providerId))
    .innerJoin(providerAccounts, eq(providerAccounts.id, paymentAttempts.providerAccountId))
    .where(eq(paymentAttempts.paymentId, id))
    .orderBy(paymentAttempts.attemptNumber);
  let ruleName: string | null = null;
  if (row.payment.routingDecisionId) {
    const [d] = await db.select({ ruleName: routingDecisions.ruleName }).from(routingDecisions).where(eq(routingDecisions.id, row.payment.routingDecisionId)).limit(1);
    ruleName = d?.ruleName ?? null;
  }
  const opts: SerializeOpts = {
    provider: row.provider,
    account: row.account,
    customer: row.customer,
    attempts: attempts.map((x) => ({ ...x.a, providerName: x.providerName, accountName: x.accountName })),
    ruleName,
  };
  return { row: row.payment, serialized: serializePayment(row.payment, opts) };
}

export async function getPaymentTimeline(db: DbOrTx, id: string) {
  const items = await listTimeline(db, id);
  return items.map((e) => ({ id: e.id, type: e.type, title: e.title, description: e.description, attempt_id: e.attemptId, data: e.data, created_at: e.createdAt }));
}

export interface PaymentFilter {
  merchantId?: string;
  mode?: "test" | "live";
  projectId?: string;
  status?: string;
  currency?: string;
  country?: string;
  paymentMethod?: string;
  providerAccountId?: string;
  customerId?: string;
  reference?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export async function listPayments(db: DbOrTx, f: PaymentFilter) {
  const conds: SQL[] = [];
  if (f.merchantId) conds.push(eq(payments.merchantId, f.merchantId));
  if (f.mode) conds.push(eq(payments.mode, f.mode));
  if (f.projectId) conds.push(eq(payments.projectId, f.projectId));
  if (f.status) {
    const statuses = f.status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) conds.push(eq(payments.status, statuses[0] as never));
    else if (statuses.length) conds.push(inArray(payments.status, statuses as never[]));
  }
  if (f.currency) conds.push(eq(payments.currency, f.currency.toUpperCase()));
  if (f.country) conds.push(eq(payments.country, f.country.toUpperCase()));
  if (f.paymentMethod) conds.push(eq(payments.paymentMethodType, f.paymentMethod as never));
  if (f.providerAccountId) conds.push(eq(payments.providerAccountId, f.providerAccountId));
  if (f.customerId) conds.push(eq(payments.customerId, f.customerId));
  if (f.reference) conds.push(eq(payments.reference, f.reference));
  if (f.from) conds.push(gte(payments.createdAt, f.from));
  if (f.to) conds.push(lte(payments.createdAt, f.to));
  if (f.search) {
    const s = `%${f.search}%`;
    conds.push(or(ilike(payments.id, s), ilike(payments.reference, s), ilike(payments.providerPaymentId, s), ilike(payments.description, s))!);
  }
  if (f.cursor) {
    // The cursor row is looked up inside the caller's own tenant, so an id belonging to another
    // merchant cannot be used as an existence / timestamp oracle.
    conds.push(
      f.merchantId
        ? sql`${payments.createdAt} < (select created_at from payments where id = ${f.cursor} and merchant_id = ${f.merchantId})`
        : sql`${payments.createdAt} < (select created_at from payments where id = ${f.cursor})`,
    );
  }
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await db
    .select({ payment: payments, provider: providers, account: providerAccounts, customer: customers })
    .from(payments)
    .leftJoin(providers, eq(providers.id, payments.providerId))
    .leftJoin(providerAccounts, eq(providerAccounts.id, payments.providerAccountId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((r) => serializePayment(r.payment, { provider: r.provider, account: r.account, customer: r.customer }));
  return { data, has_more: hasMore, next_cursor: hasMore ? data[data.length - 1]!.id : null };
}

// ---------------------------------------------------------------------------
// Capture / cancel
// ---------------------------------------------------------------------------
async function providerFor(db: DbOrTx, providerAccountId: string) {
  const [row] = await db
    .select({ account: providerAccounts, provider: providers })
    .from(providerAccounts)
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(eq(providerAccounts.id, providerAccountId))
    .limit(1);
  if (!row) throw Errors.internal();
  return { ...row, ctx: buildProviderContext(row.account, row.provider), adapter: getAdapter(row.provider.adapterKey) };
}

export async function capturePayment(db: Db, payment: PaymentRow, input: { amount?: number }, actor: Actor): Promise<PaymentRow> {
  if (payment.status !== "authorized") throw Errors.invalidTransition("payment", payment.status, "successful");
  const amount = input.amount ?? payment.amount;
  if (amount > payment.amount) throw Errors.badRequest("amount_exceeds_authorization", "Capture amount exceeds the authorized amount", "amount");
  if (!payment.providerAccountId || !payment.providerPaymentId) throw Errors.conflict("missing_provider_reference", "Payment has no provider reference");
  const { ctx, adapter, account, provider } = await providerFor(db, payment.providerAccountId);
  const t0 = Date.now();
  const res = await adapter.capturePayment(ctx, { providerPaymentId: payment.providerPaymentId, amount, currency: payment.currency });
  const latency = Date.now() - t0;
  if (res.outcome !== "success") {
    await addTimeline(db, {
      paymentId: payment.id,
      attemptId: payment.currentAttemptId,
      type: "capture.failed",
      title: "Capture failed",
      description: `${provider.name} · ${res.providerMessage ?? res.failureCode ?? res.outcome}`,
      data: { outcome: res.outcome, failure_code: res.failureCode ?? null },
    });
    throw Errors.conflict("capture_failed", res.providerMessage ?? "The provider rejected the capture");
  }
  const fee = computeFee(amount, Number(account.feePercent), account.feeFixedMinor);
  const deliveries = await db.transaction(async (tx) => {
    const updated = await applyTransition(tx, "payment", payment.id, "authorized", "successful", {
      reason: "captured",
      actor: { type: actor.type, id: actor.id },
      set: { capturedAmount: amount, feeAmount: fee, processedAt: new Date() },
    });
    if (payment.currentAttemptId) {
      await tx.update(paymentAttempts).set({ status: "succeeded", feeAmount: fee, updatedAt: new Date() }).where(eq(paymentAttempts.id, payment.currentAttemptId));
    }
    await recordTransaction(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: "payment",
      status: "successful",
      entityType: "payment",
      entityId: payment.id,
      paymentId: payment.id,
      attemptId: payment.currentAttemptId,
      amount,
      currency: payment.currency,
      feeAmount: fee,
      providerAccountId: account.id,
      providerId: provider.id,
      providerReference: payment.providerPaymentId,
      paymentMethodType: payment.paymentMethodType,
      country: payment.country,
      processingTimeMs: latency,
    });
    await addTimeline(tx, {
      paymentId: payment.id,
      attemptId: payment.currentAttemptId,
      type: "payment.captured",
      title: "Payment captured",
      description: `${formatMinor(amount, payment.currency)} captured via ${provider.name} · ${latency} ms`,
      data: { amount, fee_amount: fee, provider_reference: res.providerReference ?? null },
    });
    await recordAudit(tx, { actor, merchantId: payment.merchantId, action: "payment.captured", entityType: "payment", entityId: payment.id, after: { amount } });
    const ev = await emitEvent(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: "payment.successful",
      entityType: "payment",
      entityId: payment.id,
      data: serializePayment(updated as PaymentRow, { provider, account }),
    });
    return ev.deliveryIds;
  });
  await enqueueDeliveries(deliveries);
  return (await getPaymentRow(db, payment.id))!;
}

export async function cancelPayment(db: Db, payment: PaymentRow, input: { reason?: string }, actor: Actor): Promise<PaymentRow> {
  const cancellable = ["created", "pending", "processing", "authorized"];
  if (!cancellable.includes(payment.status)) throw Errors.invalidTransition("payment", payment.status, "cancelled");
  if (payment.status === "processing" && !payment.nextAction) {
    throw Errors.conflict("payment_in_flight", "Payment is being processed and cannot be cancelled right now");
  }
  if ((payment.status === "authorized" || payment.status === "processing") && payment.providerAccountId && payment.providerPaymentId) {
    const { ctx, adapter, provider } = await providerFor(db, payment.providerAccountId);
    const res = await adapter.cancelPayment(ctx, { providerPaymentId: payment.providerPaymentId });
    if (res.outcome !== "success") {
      throw Errors.conflict("cancel_failed", res.providerMessage ?? `${provider.name} rejected the cancellation`);
    }
  }
  const deliveries = await db.transaction(async (tx) => {
    const updated = await applyTransition(tx, "payment", payment.id, payment.status, "cancelled", {
      reason: input.reason ?? "cancelled_by_merchant",
      actor: { type: actor.type, id: actor.id },
      set: { nextAction: null, processedAt: new Date() },
    });
    if (payment.currentAttemptId) {
      await tx.update(paymentAttempts).set({ status: "cancelled", updatedAt: new Date() }).where(eq(paymentAttempts.id, payment.currentAttemptId));
    }
    await addTimeline(tx, { paymentId: payment.id, type: "payment.cancelled", title: "Payment cancelled", description: input.reason ?? "Cancelled by merchant", data: {} });
    await recordAudit(tx, { actor, merchantId: payment.merchantId, action: "payment.cancelled", entityType: "payment", entityId: payment.id, after: { reason: input.reason } });
    const ev = await emitEvent(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: "payment.cancelled",
      entityType: "payment",
      entityId: payment.id,
      data: serializePayment(updated as PaymentRow),
    });
    return ev.deliveryIds;
  });
  await enqueueDeliveries(deliveries);
  return (await getPaymentRow(db, payment.id))!;
}

/** Admin: approve a payment held for review and resume orchestration. */
export async function reviewPayment(db: Db, payment: PaymentRow, decision: "approve" | "reject", actor: Actor): Promise<PaymentRow> {
  if (payment.status !== "pending") throw Errors.conflict("not_pending", "Only payments pending review can be reviewed");
  await addTimeline(db, {
    paymentId: payment.id,
    type: "risk.reviewed",
    title: decision === "approve" ? "Approved by operator" : "Rejected by operator",
    description: actor.label ?? actor.id ?? "operator",
    data: { decision },
  });
  await recordAudit(db, { actor, merchantId: payment.merchantId, action: `payment.review_${decision}`, entityType: "payment", entityId: payment.id });
  if (decision === "reject") {
    await failPayment(db, payment, { code: "risk_blocked", message: "Rejected during manual review", from: "pending", actor: { type: actor.type, id: actor.id } }, payment.createdAt.getTime());
    return (await getPaymentRow(db, payment.id))!;
  }
  return runOrchestration(db, payment.id, { type: actor.type, id: actor.id });
}
