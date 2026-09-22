/**
 * Payment orchestration engine.
 *
 *   payment (created|pending) → processing → [attempt per provider] → successful | authorized | failed
 *
 * Guarantees:
 *  - one PaymentAttempt row per provider call, never re-used;
 *  - a failover is attempted only when it is safe: technical errors / unavailability / declines
 *    where the provider did not create a charge, or timeouts where the provider confirmed there is no charge;
 *  - a timeout that cannot be resolved leaves the attempt `unknown` and schedules a provider sync
 *    instead of retrying (no double charge);
 *  - every state change is logged (state_transitions) and narrated (payment_events timeline);
 *  - domain events are written in the same transaction as the state change (outbox) and delivered after commit.
 */
import { and, eq } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import type { Db } from "../../db/client.js";
import { customers, paymentAttempts, payments, projects, providerAccounts, providers } from "../../db/schema/index.js";
import { computeFee } from "../../lib/money.js";
import { logger } from "../../lib/logger.js";
import { newId } from "../../lib/ids.js";
import { getQueue, QUEUE_NAMES } from "../../lib/queue.js";
import { buildProviderContext } from "../../providers/context.js";
import { failureInfo } from "../../providers/failure-codes.js";
import { getAdapter } from "../../providers/registry.js";
import {
  ProviderTimeoutError,
  ProviderUnavailableError,
  type ProviderContext,
  type ProviderLookupResult,
  type ProviderPaymentResult,
} from "../../providers/types.js";
import { recordSystemEvent } from "../audit/service.js";
import { addTimeline, emitEvent, enqueueDeliveries } from "../events/service.js";
import { decideRoute } from "../routing/service.js";
import type { Candidate } from "../routing/engine.js";
import { recordTransaction } from "../transactions/service.js";
import { primitiveForAttempt } from "./scenarios.js";
import { serializePayment } from "./serialize.js";
import { applyTransition, type TransitionActor } from "./state-machine.js";

export type PaymentRow = typeof payments.$inferSelect;
export type AttemptRow = typeof paymentAttempts.$inferSelect;

export interface RetryPolicy {
  maxAttempts: number;
  retryOnSoftDecline: boolean;
  retryOnTimeout: boolean;
}

export function resolveRetryPolicy(project: typeof projects.$inferSelect | null): RetryPolicy {
  const cfg = loadConfig();
  const p = project?.settings.retryPolicy ?? {};
  return {
    maxAttempts: Math.max(1, Math.min(p.maxAttempts ?? cfg.DEFAULT_RETRY_MAX_ATTEMPTS, 5)),
    retryOnSoftDecline: p.retryOnSoftDecline ?? cfg.DEFAULT_RETRY_ON_SOFT_DECLINE,
    retryOnTimeout: p.retryOnTimeout ?? true,
  };
}

/** Pure retry decision — unit tested. */
export function shouldRetry(
  outcome: ProviderPaymentResult["outcome"] | "unknown",
  policy: RetryPolicy,
  attemptsSoFar: number,
  candidatesRemaining: number,
  opts: { timeoutResolvedSafe?: boolean } = {},
): { retry: boolean; reason: string } {
  if (candidatesRemaining <= 0) return { retry: false, reason: "no_more_candidates" };
  if (attemptsSoFar >= policy.maxAttempts) return { retry: false, reason: "max_attempts_reached" };
  switch (outcome) {
    case "technical_error":
    case "provider_unavailable":
      return { retry: true, reason: `${outcome}_is_retryable` };
    case "soft_decline":
      return policy.retryOnSoftDecline ? { retry: true, reason: "soft_decline_cascade_enabled" } : { retry: false, reason: "soft_decline_cascade_disabled" };
    case "timeout":
      if (!policy.retryOnTimeout) return { retry: false, reason: "timeout_retry_disabled" };
      return opts.timeoutResolvedSafe ? { retry: true, reason: "provider_confirmed_no_charge" } : { retry: false, reason: "timeout_unresolved" };
    case "hard_decline":
      return { retry: false, reason: "hard_decline_never_retried" };
    case "unknown":
      return { retry: false, reason: "outcome_unknown" };
    default:
      return { retry: false, reason: "not_retryable" };
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(`no response within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadPaymentBundle(db: Db, paymentId: string) {
  const [row] = await db
    .select({ payment: payments, project: projects, customer: customers })
    .from(payments)
    .innerJoin(projects, eq(projects.id, payments.projectId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .where(eq(payments.id, paymentId))
    .limit(1);
  return row ?? null;
}

async function providerContextFor(db: Db, providerAccountId: string) {
  const [row] = await db
    .select({ account: providerAccounts, provider: providers })
    .from(providerAccounts)
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(eq(providerAccounts.id, providerAccountId))
    .limit(1);
  if (!row) throw new Error(`provider account ${providerAccountId} not found`);
  return { ...row, ctx: buildProviderContext(row.account, row.provider), adapter: getAdapter(row.provider.adapterKey) };
}

// ---------------------------------------------------------------------------
// Success / failure finalisation (short transactions, deliveries enqueued after commit)
// ---------------------------------------------------------------------------
async function finalizeSuccess(
  db: Db,
  payment: PaymentRow,
  attempt: AttemptRow,
  cand: { account: typeof providerAccounts.$inferSelect; provider: typeof providers.$inferSelect },
  result: { providerPaymentId: string; status: "authorized" | "captured"; latencyMs: number; raw?: Record<string, unknown> },
  actor: TransitionActor,
  startedAt: number,
) {
  const fee = computeFee(payment.amount, Number(cand.account.feePercent), cand.account.feeFixedMinor);
  const toStatus = result.status === "authorized" ? "authorized" : "successful";
  const processingTime = Date.now() - startedAt;
  const deliveries = await db.transaction(async (tx) => {
    await tx
      .update(paymentAttempts)
      .set({
        status: toStatus === "authorized" ? "authorized" : "succeeded",
        outcome: "success",
        providerPaymentId: result.providerPaymentId,
        respondedAt: new Date(),
        latencyMs: result.latencyMs,
        feeAmount: fee,
        rawResponse: result.raw ?? {},
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id));
    const updated = await applyTransition(tx, "payment", payment.id, "processing", toStatus, {
      reason: toStatus === "authorized" ? "provider_authorized" : "provider_captured",
      actor,
      set: {
        providerAccountId: cand.account.id,
        providerId: cand.provider.id,
        providerPaymentId: result.providerPaymentId,
        capturedAmount: toStatus === "successful" ? payment.amount : 0,
        feeAmount: toStatus === "successful" ? fee : 0,
        failureCode: null,
        failureMessage: null,
        declineCategory: null,
        nextAction: null,
        processedAt: new Date(),
        processingTimeMs: processingTime,
      },
    });
    if (toStatus === "successful") {
      await recordTransaction(tx, {
        merchantId: payment.merchantId,
        projectId: payment.projectId,
        mode: payment.mode,
        type: "payment",
        status: "successful",
        entityType: "payment",
        entityId: payment.id,
        paymentId: payment.id,
        attemptId: attempt.id,
        amount: payment.amount,
        currency: payment.currency,
        feeAmount: fee,
        providerAccountId: cand.account.id,
        providerId: cand.provider.id,
        providerReference: result.providerPaymentId,
        paymentMethodType: payment.paymentMethodType,
        country: payment.country,
        processingTimeMs: processingTime,
      });
    }
    await addTimeline(tx, {
      paymentId: payment.id,
      attemptId: attempt.id,
      type: toStatus === "authorized" ? "payment.authorized" : "payment.successful",
      title: toStatus === "authorized" ? "Payment authorized" : "Payment successful",
      description: `${cand.provider.name} · ${cand.account.name} · ${result.latencyMs} ms`,
      data: { provider_payment_id: result.providerPaymentId, fee_amount: fee, latency_ms: result.latencyMs },
    });
    const ev = await emitEvent(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: toStatus === "authorized" ? "payment.authorized" : "payment.successful",
      entityType: "payment",
      entityId: payment.id,
      data: serializePayment(updated as PaymentRow, { provider: cand.provider, account: cand.account }),
    });
    return ev.deliveryIds;
  });
  await enqueueDeliveries(deliveries);
  await noteWebhookQueued(db, payment.id, deliveries.length, toStatus === "authorized" ? "payment.authorized" : "payment.successful");
}

async function noteWebhookQueued(db: Db, paymentId: string, count: number, type: string) {
  if (!count) return;
  await addTimeline(db, {
    paymentId,
    type: "webhook.queued",
    title: "Webhook queued for merchant",
    description: `${count} endpoint(s) subscribed to ${type}`,
    data: { event_type: type, endpoints: count },
  });
}

export async function failPayment(
  db: Db,
  payment: PaymentRow,
  input: { code: string; message?: string; attemptId?: string | null; from?: string; actor: TransitionActor; providerAccountId?: string | null; providerId?: string | null },
  startedAt?: number,
) {
  const info = failureInfo(input.code);
  const from = input.from ?? payment.status;
  const deliveries = await db.transaction(async (tx) => {
    const updated = await applyTransition(tx, "payment", payment.id, from, "failed", {
      reason: input.code,
      actor: input.actor,
      set: {
        failureCode: info.code,
        failureMessage: input.message ?? info.message,
        declineCategory: info.category,
        nextAction: null,
        processedAt: new Date(),
        processingTimeMs: startedAt ? Date.now() - startedAt : payment.processingTimeMs,
        ...(input.providerAccountId ? { providerAccountId: input.providerAccountId, providerId: input.providerId ?? null } : {}),
      },
    });
    await recordTransaction(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: "payment",
      status: "failed",
      entityType: "payment",
      entityId: payment.id,
      paymentId: payment.id,
      attemptId: input.attemptId ?? null,
      amount: payment.amount,
      currency: payment.currency,
      providerAccountId: input.providerAccountId ?? payment.providerAccountId ?? null,
      providerId: input.providerId ?? payment.providerId ?? null,
      providerReference: `${payment.id}:failed`,
      paymentMethodType: payment.paymentMethodType,
      country: payment.country,
      failureCode: info.code,
      processingTimeMs: startedAt ? Date.now() - startedAt : null,
    });
    await addTimeline(tx, {
      paymentId: payment.id,
      attemptId: input.attemptId ?? null,
      type: "payment.failed",
      title: "Payment failed",
      description: `${info.code} · ${input.message ?? info.message}`,
      data: { failure_code: info.code, category: info.category },
    });
    const ev = await emitEvent(tx, {
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      type: "payment.failed",
      entityType: "payment",
      entityId: payment.id,
      data: serializePayment(updated as PaymentRow),
    });
    return ev.deliveryIds;
  });
  await enqueueDeliveries(deliveries);
  await noteWebhookQueued(db, payment.id, deliveries.length, "payment.failed");
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
export async function runOrchestration(db: Db, paymentId: string, actor: TransitionActor = { type: "system" }): Promise<PaymentRow> {
  const cfg = loadConfig();
  const bundle = await loadPaymentBundle(db, paymentId);
  if (!bundle) throw new Error(`payment ${paymentId} not found`);
  let payment = bundle.payment;
  const startedAt = payment.createdAt.getTime();

  if (payment.status === "created" || payment.status === "pending") {
    // Deliveries are enqueued only after the transaction commits (outbox rule); enqueueing inside the
    // transaction lets the worker read the delivery row before it is visible and drop it silently.
    const started = await db.transaction(async (tx) => {
      const p = await applyTransition(tx, "payment", payment.id, payment.status, "processing", { reason: "orchestration_started", actor });
      const ev = await emitEvent(tx, {
        merchantId: p.merchantId,
        projectId: p.projectId,
        mode: p.mode,
        type: "payment.processing",
        entityType: "payment",
        entityId: p.id,
        data: serializePayment(p as PaymentRow),
      });
      return { payment: p as PaymentRow, deliveryIds: ev.deliveryIds };
    });
    payment = started.payment;
    await enqueueDeliveries(started.deliveryIds);
  } else if (payment.status !== "processing") {
    return payment;
  }

  const policy = resolveRetryPolicy(bundle.project);
  const attempted = await db.select({ id: paymentAttempts.providerAccountId }).from(paymentAttempts).where(eq(paymentAttempts.paymentId, payment.id));
  const excluded = attempted.map((a) => a.id);

  const { result: route, decisionId } = await decideRoute(
    db,
    {
      transactionType: "payment",
      merchantId: payment.merchantId,
      projectId: payment.projectId,
      mode: payment.mode,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.paymentMethodType,
      country: payment.country,
      customerCountry: bundle.customer?.country ?? null,
      riskScore: payment.riskScore,
      seed: payment.id,
      excludeAccountIds: excluded,
    },
    { paymentId: payment.id },
  );
  await db.update(payments).set({ routingDecisionId: decisionId }).where(eq(payments.id, payment.id));
  await addTimeline(db, {
    paymentId: payment.id,
    type: "routing.evaluated",
    title: route.rule ? `Routing rule evaluated: ${route.rule.name}` : "Routing evaluated (default scoring)",
    description: `${route.strategy} strategy · ${route.ordered.length} eligible provider(s) · ${route.reason}`,
    data: {
      routing_decision_id: decisionId,
      rule_id: route.rule?.id ?? null,
      strategy: route.strategy,
      candidates: route.candidates.map((c) => ({ provider: c.providerName, account: c.accountName, eligible: c.eligible, score: c.score, reasons: c.reasons })),
    },
  });

  if (!route.ordered.length) {
    await failPayment(db, payment, { code: "no_route_available", actor, from: "processing" }, startedAt);
    return (await loadPaymentBundle(db, payment.id))!.payment;
  }

  let attemptsSoFar = payment.attemptCount;
  let lastFailure: { code: string; message?: string; attemptId: string; providerAccountId: string; providerId: string } | null = null;

  for (let i = 0; i < route.ordered.length; i++) {
    const cand = route.ordered[i]!;
    const attemptNumber = attemptsSoFar + 1;
    const attempt = await createAttempt(db, payment, cand, attemptNumber);
    attemptsSoFar++;
    const remaining = route.ordered.length - i - 1;

    const outcome = await executeAttempt(db, payment, bundle, attempt, cand, attemptNumber - 1, actor, startedAt);
    if (outcome.kind === "done") return (await loadPaymentBundle(db, payment.id))!.payment;

    lastFailure = { code: outcome.code, message: outcome.message, attemptId: attempt.id, providerAccountId: cand.account.id, providerId: cand.provider.id };
    const decision = shouldRetry(outcome.outcome, policy, attemptsSoFar, remaining, { timeoutResolvedSafe: outcome.timeoutResolvedSafe });
    if (!decision.retry) {
      await addTimeline(db, {
        paymentId: payment.id,
        attemptId: attempt.id,
        type: "retry.stopped",
        title: "No further retry",
        description: decision.reason.replace(/_/g, " "),
        data: { reason: decision.reason, attempts: attemptsSoFar, max_attempts: policy.maxAttempts },
      });
      break;
    }
    const next = route.ordered[i + 1]!;
    await addTimeline(db, {
      paymentId: payment.id,
      attemptId: attempt.id,
      type: "failover.initiated",
      title: "Fallback initiated",
      description: `${decision.reason.replace(/_/g, " ")} → next provider ${next.provider.name}`,
      data: { reason: decision.reason, next_provider_account_id: next.account.id },
    });
  }

  const current = (await loadPaymentBundle(db, payment.id))!.payment;
  if (current.status === "processing") {
    await failPayment(
      db,
      current,
      {
        code: lastFailure?.code ?? "attempts_exhausted",
        message: lastFailure?.message,
        attemptId: lastFailure?.attemptId ?? null,
        providerAccountId: lastFailure?.providerAccountId ?? null,
        providerId: lastFailure?.providerId ?? null,
        from: "processing",
        actor,
      },
      startedAt,
    );
  }
  void cfg;
  return (await loadPaymentBundle(db, payment.id))!.payment;
}

async function createAttempt(db: Db, payment: PaymentRow, cand: Candidate, attemptNumber: number): Promise<AttemptRow> {
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({
        id: newId("attempt"),
        paymentId: payment.id,
        attemptNumber,
        providerAccountId: cand.account.id,
        providerId: cand.provider.id,
        status: "processing",
      })
      .returning();
    await tx.update(payments).set({ currentAttemptId: attempt!.id, attemptCount: attemptNumber, updatedAt: new Date() }).where(eq(payments.id, payment.id));
    await addTimeline(tx, {
      paymentId: payment.id,
      attemptId: attempt!.id,
      type: "provider.selected",
      title: `${cand.provider.name} selected`,
      description: `Attempt ${attemptNumber} · account ${cand.account.name} · fee ${cand.account.feePercent}% + ${cand.account.feeFixedMinor}`,
      data: { provider_account_id: cand.account.id, provider_id: cand.provider.id, attempt_number: attemptNumber, score: cand.stats ? undefined : null },
    });
    return attempt!;
  });
}

type AttemptOutcome =
  | { kind: "done" }
  | { kind: "failed"; outcome: ProviderPaymentResult["outcome"] | "unknown"; code: string; message?: string; timeoutResolvedSafe?: boolean };

async function executeAttempt(
  db: Db,
  payment: PaymentRow,
  bundle: NonNullable<Awaited<ReturnType<typeof loadPaymentBundle>>>,
  attempt: AttemptRow,
  cand: Candidate,
  attemptIndex: number,
  actor: TransitionActor,
  startedAt: number,
): Promise<AttemptOutcome> {
  const cfg = loadConfig();
  const ctx = buildProviderContext(cand.account, cand.provider);
  const adapter = getAdapter(cand.provider.adapterKey);
  const simulate = payment.mode === "test" ? primitiveForAttempt(payment.testScenario, attemptIndex) : undefined;

  await db.update(paymentAttempts).set({ requestSentAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
  await addTimeline(db, {
    paymentId: payment.id,
    attemptId: attempt.id,
    type: "provider.request_sent",
    title: "Request sent to provider",
    description: `${cand.provider.name} · createPayment${simulate ? ` · sandbox: ${simulate}` : ""}`,
    data: { adapter: adapter.key, simulate: simulate ?? null },
  });

  const t0 = Date.now();
  let result: ProviderPaymentResult | null = null;
  let error: "timeout" | "provider_unavailable" | "technical_error" | null = null;
  let errorMessage = "";
  try {
    result = await withTimeout(
      adapter.createPayment(ctx, {
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethodType: payment.paymentMethodType,
        captureMethod: payment.captureMethod,
        country: payment.country ?? undefined,
        customer: bundle.customer
          ? { id: bundle.customer.id, email: bundle.customer.email ?? undefined, name: bundle.customer.name ?? undefined, country: bundle.customer.country ?? undefined }
          : undefined,
        description: payment.description ?? undefined,
        reference: payment.reference ?? undefined,
        returnUrl: payment.returnUrl ?? undefined,
        metadata: payment.metadata,
        simulate,
      }),
      cfg.PROVIDER_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof ProviderTimeoutError) error = "timeout";
    else if (err instanceof ProviderUnavailableError) error = "provider_unavailable";
    else error = "technical_error";
    errorMessage = err instanceof Error ? err.message : String(err);
    if (error === "technical_error") logger.error({ err, paymentId: payment.id, attemptId: attempt.id }, "provider adapter threw");
  }
  const latencyMs = Date.now() - t0;

  // -------------------------------------------------------------- transport errors
  if (error) {
    if (error === "timeout") {
      await addTimeline(db, {
        paymentId: payment.id,
        attemptId: attempt.id,
        type: "provider.timeout",
        title: "Provider timeout",
        description: `${cand.provider.name} did not respond within ${cfg.PROVIDER_TIMEOUT_MS} ms`,
        data: { latency_ms: latencyMs },
      });
      await db.update(paymentAttempts).set({ status: "unknown", outcome: "timeout", respondedAt: new Date(), latencyMs, providerMessage: errorMessage, updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
      const resolved = await resolveTimeout(db, ctx, adapter, payment, attempt, cand, actor, startedAt);
      if (resolved.kind === "done") return { kind: "done" };
      if (resolved.kind === "unknown") {
        return { kind: "failed", outcome: "unknown", code: "timeout", message: "Provider status unknown; sync scheduled" };
      }
      return { kind: "failed", outcome: "timeout", code: "timeout", message: errorMessage, timeoutResolvedSafe: true };
    }
    await db
      .update(paymentAttempts)
      .set({ status: "failed", outcome: error, failureCode: error, providerMessage: errorMessage, respondedAt: new Date(), latencyMs, updatedAt: new Date() })
      .where(eq(paymentAttempts.id, attempt.id));
    await addTimeline(db, {
      paymentId: payment.id,
      attemptId: attempt.id,
      type: error === "provider_unavailable" ? "provider.unavailable" : "provider.error",
      title: error === "provider_unavailable" ? "Provider unavailable" : "Provider technical error",
      description: `${cand.provider.name} · ${errorMessage}`,
      data: { latency_ms: latencyMs },
    });
    if (error === "provider_unavailable") {
      await recordSystemEvent(db, {
        level: "warning",
        source: "orchestrator",
        type: "provider.unavailable",
        message: `${cand.provider.name} (${cand.account.name}) unavailable: ${errorMessage}`,
        providerAccountId: cand.account.id,
        merchantId: payment.merchantId,
        data: { payment_id: payment.id, attempt_id: attempt.id },
      });
    }
    return { kind: "failed", outcome: error, code: error, message: errorMessage };
  }

  // -------------------------------------------------------------- provider answered
  const r = result!;
  switch (r.outcome) {
    case "success": {
      await finalizeSuccess(
        db,
        payment,
        attempt,
        cand,
        { providerPaymentId: r.providerPaymentId!, status: r.status === "authorized" ? "authorized" : "captured", latencyMs, raw: r.raw },
        actor,
        startedAt,
      );
      return { kind: "done" };
    }
    case "requires_action": {
      await db.transaction(async (tx) => {
        await tx
          .update(paymentAttempts)
          .set({ status: "processing", outcome: "requires_action", providerPaymentId: r.providerPaymentId ?? null, respondedAt: new Date(), latencyMs, rawResponse: r.raw ?? {}, updatedAt: new Date() })
          .where(eq(paymentAttempts.id, attempt.id));
        await tx
          .update(payments)
          .set({ nextAction: r.nextAction ?? null, providerAccountId: cand.account.id, providerId: cand.provider.id, providerPaymentId: r.providerPaymentId ?? null, updatedAt: new Date() })
          .where(eq(payments.id, payment.id));
        await addTimeline(tx, {
          paymentId: payment.id,
          attemptId: attempt.id,
          type: "payment.requires_action",
          title: "Awaiting customer action",
          description: `${cand.provider.name} requires ${r.nextAction?.type ?? "customer action"} · ${latencyMs} ms`,
          data: { next_action: r.nextAction ?? null, provider_payment_id: r.providerPaymentId ?? null },
        });
      });
      return { kind: "done" };
    }
    case "soft_decline":
    case "hard_decline":
    case "technical_error": {
      const code = r.failureCode ?? (r.outcome === "technical_error" ? "technical_error" : "generic_decline");
      await db
        .update(paymentAttempts)
        .set({
          status: "failed",
          outcome: r.outcome,
          failureCode: code,
          providerCode: r.providerCode ?? null,
          providerMessage: r.providerMessage ?? null,
          providerPaymentId: r.providerPaymentId ?? null,
          respondedAt: new Date(),
          latencyMs,
          rawResponse: r.raw ?? {},
          updatedAt: new Date(),
        })
        .where(eq(paymentAttempts.id, attempt.id));
      await addTimeline(db, {
        paymentId: payment.id,
        attemptId: attempt.id,
        type: r.outcome === "technical_error" ? "provider.error" : "provider.declined",
        title: r.outcome === "technical_error" ? "Provider technical error" : r.outcome === "soft_decline" ? "Soft decline" : "Hard decline",
        description: `${cand.provider.name} · ${r.providerCode ?? ""} ${r.providerMessage ?? code}`.trim(),
        data: { failure_code: code, provider_code: r.providerCode ?? null, latency_ms: latencyMs },
      });
      return { kind: "failed", outcome: r.outcome, code, message: r.providerMessage };
    }
    default: {
      await db.update(paymentAttempts).set({ status: "failed", outcome: "technical_error", failureCode: "technical_error", updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
      return { kind: "failed", outcome: "technical_error", code: "technical_error", message: "unexpected adapter outcome" };
    }
  }
}

/**
 * After a timeout, ask the provider whether the payment exists. Only a confirmed "not found"
 * makes a failover safe. A confirmed charge is adopted (no retry). Anything else → unknown + sync.
 */
async function resolveTimeout(
  db: Db,
  ctx: ProviderContext,
  adapter: ReturnType<typeof getAdapter>,
  payment: PaymentRow,
  attempt: AttemptRow,
  cand: Candidate,
  actor: TransitionActor,
  startedAt: number,
): Promise<{ kind: "done" } | { kind: "safe" } | { kind: "unknown" }> {
  if (!adapter.findPaymentByReference) {
    await scheduleSync(db, payment, attempt, "adapter cannot look up by reference");
    return { kind: "unknown" };
  }
  let lookup: ProviderLookupResult;
  try {
    lookup = await withTimeout(adapter.findPaymentByReference(ctx, payment.id), loadConfig().PROVIDER_TIMEOUT_MS);
  } catch (err) {
    await scheduleSync(db, payment, attempt, err instanceof Error ? err.message : "lookup failed");
    return { kind: "unknown" };
  }
  if (!lookup.found) {
    await db.update(paymentAttempts).set({ status: "failed", failureCode: "timeout", updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    await addTimeline(db, {
      paymentId: payment.id,
      attemptId: attempt.id,
      type: "provider.lookup",
      title: "Provider confirmed no charge exists",
      description: `${cand.provider.name} has no record of ${payment.id} — failover is safe`,
      data: { found: false },
    });
    return { kind: "safe" };
  }
  if (lookup.status === "captured" || lookup.status === "authorized") {
    await addTimeline(db, {
      paymentId: payment.id,
      attemptId: attempt.id,
      type: "provider.lookup",
      title: "Provider confirmed the payment after timeout",
      description: `${cand.provider.name} reports status ${lookup.status} for ${lookup.providerPaymentId} — adopting result, no retry`,
      data: { found: true, status: lookup.status, provider_payment_id: lookup.providerPaymentId },
    });
    await finalizeSuccess(
      db,
      payment,
      attempt,
      cand,
      { providerPaymentId: lookup.providerPaymentId!, status: lookup.status === "authorized" ? "authorized" : "captured", latencyMs: attempt.latencyMs ?? 0, raw: lookup.raw },
      actor,
      startedAt,
    );
    return { kind: "done" };
  }
  if (lookup.status === "failed" || lookup.status === "cancelled") {
    await db.update(paymentAttempts).set({ status: "failed", failureCode: "timeout", updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    await addTimeline(db, {
      paymentId: payment.id,
      attemptId: attempt.id,
      type: "provider.lookup",
      title: "Provider reports the attempt failed",
      description: `${cand.provider.name} status ${lookup.status} — failover is safe`,
      data: { found: true, status: lookup.status },
    });
    return { kind: "safe" };
  }
  // pending at the provider: keep processing, sync later
  await db
    .update(paymentAttempts)
    .set({ providerPaymentId: lookup.providerPaymentId ?? null, updatedAt: new Date() })
    .where(eq(paymentAttempts.id, attempt.id));
  await scheduleSync(db, payment, attempt, `provider status ${lookup.status}`);
  return { kind: "unknown" };
}

export interface ProviderSyncJob {
  attemptId: string;
  tries: number;
}

async function scheduleSync(db: Db, payment: PaymentRow, attempt: AttemptRow, why: string) {
  await addTimeline(db, {
    paymentId: payment.id,
    attemptId: attempt.id,
    type: "sync.scheduled",
    title: "Provider status unknown — sync scheduled",
    description: `${why}. NATIO will not retry with another provider until the status is known.`,
    data: { attempt_id: attempt.id },
  });
  await getQueue<ProviderSyncJob>(QUEUE_NAMES.providerSync).add("sync", { attemptId: attempt.id, tries: 0 }, { delayMs: 5000 });
}

/** Worker entry: resolve an `unknown` attempt by asking the provider. */
export async function syncAttempt(db: Db, job: ProviderSyncJob): Promise<void> {
  const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, job.attemptId)).limit(1);
  if (!attempt || attempt.status !== "unknown") return;
  const bundle = await loadPaymentBundle(db, attempt.paymentId);
  if (!bundle || bundle.payment.status !== "processing") return;
  const { ctx, adapter, account, provider } = await providerContextFor(db, attempt.providerAccountId);
  let lookup: ProviderLookupResult | null = null;
  try {
    lookup = attempt.providerPaymentId
      ? await adapter.getPayment(ctx, attempt.providerPaymentId)
      : adapter.findPaymentByReference
        ? await adapter.findPaymentByReference(ctx, attempt.paymentId)
        : { found: false };
  } catch (err) {
    logger.warn({ err, attemptId: attempt.id }, "provider sync lookup failed");
  }
  const cand = { account, provider };
  if (lookup?.found && (lookup.status === "captured" || lookup.status === "authorized")) {
    await finalizeSuccess(
      db,
      bundle.payment,
      attempt,
      cand,
      { providerPaymentId: lookup.providerPaymentId!, status: lookup.status === "authorized" ? "authorized" : "captured", latencyMs: attempt.latencyMs ?? 0, raw: lookup.raw },
      { type: "system", id: "provider-sync" },
      bundle.payment.createdAt.getTime(),
    );
    return;
  }
  if (lookup && (!lookup.found || lookup.status === "failed" || lookup.status === "cancelled")) {
    await db.update(paymentAttempts).set({ status: "failed", failureCode: "timeout", updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    await addTimeline(db, {
      paymentId: attempt.paymentId,
      attemptId: attempt.id,
      type: "sync.resolved",
      title: "Provider sync: no charge exists",
      description: "Resuming orchestration with the next eligible provider",
      data: {},
    });
    await runOrchestration(db, attempt.paymentId, { type: "system", id: "provider-sync" });
    return;
  }
  if (job.tries < 5) {
    await getQueue<ProviderSyncJob>(QUEUE_NAMES.providerSync).add("sync", { attemptId: attempt.id, tries: job.tries + 1 }, { delayMs: Math.min(60000, 5000 * 2 ** job.tries) });
  } else {
    await recordSystemEvent(db, {
      level: "error",
      source: "provider-sync",
      type: "attempt.unresolved",
      message: `Attempt ${attempt.id} of ${attempt.paymentId} could not be resolved after ${job.tries} tries; manual review required`,
      providerAccountId: attempt.providerAccountId,
      merchantId: bundle.payment.merchantId,
      data: { attempt_id: attempt.id, payment_id: attempt.paymentId },
    });
  }
}

// ---------------------------------------------------------------------------
// Asynchronous completion (provider webhooks / sandbox hosted page)
// ---------------------------------------------------------------------------
export async function handleProviderPaymentEvent(
  db: Db,
  providerAccountId: string,
  event: { providerReference: string; status: string; failureCode?: string; providerMessage?: string; eventId: string },
): Promise<{ handled: boolean; reason?: string }> {
  const [attempt] = await db
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.providerAccountId, providerAccountId), eq(paymentAttempts.providerPaymentId, event.providerReference)))
    .limit(1);
  if (!attempt) return { handled: false, reason: "unknown provider reference" };
  const bundle = await loadPaymentBundle(db, attempt.paymentId);
  if (!bundle) return { handled: false, reason: "payment missing" };
  const payment = bundle.payment;
  const { account, provider } = await providerContextFor(db, providerAccountId);
  await addTimeline(db, {
    paymentId: payment.id,
    attemptId: attempt.id,
    type: "provider.webhook",
    title: "Provider notification received",
    description: `${provider.name} · status ${event.status} · event ${event.eventId}`,
    data: { status: event.status, event_id: event.eventId },
  });
  if (payment.status !== "processing" && payment.status !== "authorized") return { handled: true, reason: `payment already ${payment.status}` };

  if (event.status === "captured" || event.status === "authorized") {
    if (payment.status === "authorized" && event.status === "authorized") return { handled: true, reason: "already authorized" };
    if (payment.status === "processing") {
      await finalizeSuccess(
        db,
        payment,
        attempt,
        { account, provider },
        { providerPaymentId: event.providerReference, status: event.status, latencyMs: attempt.latencyMs ?? 0 },
        { type: "system", id: "provider-webhook" },
        payment.createdAt.getTime(),
      );
      return { handled: true };
    }
  }
  if (event.status === "failed" || event.status === "cancelled") {
    const code = event.failureCode ?? (event.status === "cancelled" ? "cancelled_by_customer" : "payment_expired");
    await db.update(paymentAttempts).set({ status: "failed", outcome: "hard_decline", failureCode: code, providerMessage: event.providerMessage ?? null, updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    await failPayment(db, payment, { code, message: event.providerMessage, attemptId: attempt.id, from: payment.status, actor: { type: "system", id: "provider-webhook" }, providerAccountId, providerId: provider.id }, payment.createdAt.getTime());
    return { handled: true };
  }
  return { handled: true, reason: `status ${event.status} ignored` };
}
