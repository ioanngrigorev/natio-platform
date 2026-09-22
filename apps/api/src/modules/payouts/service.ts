import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "../../db/client.js";
import { payouts, providerAccounts, providers, type PayoutDestination } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { logger } from "../../lib/logger.js";
import { computeFee } from "../../lib/money.js";
import { buildProviderContext } from "../../providers/context.js";
import { failureInfo } from "../../providers/failure-codes.js";
import { getAdapter } from "../../providers/registry.js";
import { ProviderTimeoutError, ProviderUnavailableError } from "../../providers/types.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { emitEvent, enqueueDeliveries } from "../events/service.js";
import { currencySchema, countrySchema, hasUnmaskedDigits, looksLikeAccountNumber, looksLikeIban, metadataSchema } from "../payments/schemas.js";
import { applyTransition } from "../payments/state-machine.js";
import { decideRoute } from "../routing/service.js";
import { recordTransaction } from "../transactions/service.js";

export type PayoutRow = typeof payouts.$inferSelect;

export const createPayoutSchema = z
  .object({
    amount: z.number().int().positive(),
    currency: currencySchema,
    destination: z.object({
      type: z.enum(["bank_account", "wallet", "card_token"]),
      /** Provider token or tokenised beneficiary reference. Raw account numbers are not accepted. */
      token: z
        .string()
        .max(255)
        .refine((t) => !looksLikeAccountNumber(t), { message: "destination.token must be a provider token, never a raw card or account number" })
        .optional(),
      /** Masked display, e.g. "IBAN ****1234" or "Wallet ****ab12" */
      display: z.string().min(3).max(120),
      holder_name: z.string().max(120).optional(),
      country: countrySchema.optional(),
    }),
    description: z.string().max(500).optional(),
    reference: z.string().max(128).optional(),
    metadata: metadataSchema.optional(),
    test_scenario: z.enum(["success", "technical_error", "hard_decline", "unavailable", "timeout"]).optional(),
  })
  .strict()
  // Separators are stripped first, so "4111-1111-1111-1111" and "GB29 NWBK 6016 1331 9268 19"
  // are rejected exactly like their unspaced forms.
  .refine((v) => !hasUnmaskedDigits(v.destination.display, 8) && !looksLikeIban(v.destination.display), {
    message: "destination.display must be masked (no long digit sequences)",
    path: ["destination", "display"],
  });
export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;

export function serializePayout(p: PayoutRow, extra: { providerName?: string | null; accountName?: string | null } = {}) {
  const failure = p.failureCode ? failureInfo(p.failureCode) : null;
  return {
    id: p.id,
    object: "payout",
    mode: p.mode,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    destination: { type: p.destination.type, display: p.destination.display, holder_name: p.destination.holderName ?? null, country: p.destination.country ?? null },
    description: p.description,
    reference: p.reference,
    route: {
      provider_id: p.providerId,
      provider_name: extra.providerName ?? null,
      provider_account_id: p.providerAccountId,
      provider_account_name: extra.accountName ?? null,
      provider_payout_id: p.providerPayoutId,
      routing_decision_id: p.routingDecisionId,
    },
    fee: { amount: p.feeAmount, currency: p.currency },
    failure: failure ? { code: failure.code, category: failure.category, message: p.failureMessage ?? failure.message } : null,
    metadata: p.metadata,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    processed_at: p.processedAt,
  };
}

export async function createPayout(
  db: Db,
  scope: { merchantId: string; projectId: string; mode: "test" | "live" },
  input: CreatePayoutInput,
  opts: { actor: Actor; idempotencyKey?: string },
): Promise<PayoutRow> {
  const destination: PayoutDestination = {
    type: input.destination.type,
    display: input.destination.display,
    providerToken: input.destination.token,
    holderName: input.destination.holder_name,
    country: input.destination.country,
    currency: input.currency,
  };
  const actor = { type: opts.actor.type, id: opts.actor.id };
  const [payout] = await db
    .insert(payouts)
    .values({
      id: newId("payout"),
      merchantId: scope.merchantId,
      projectId: scope.projectId,
      mode: scope.mode,
      amount: input.amount,
      currency: input.currency,
      status: "created",
      destination,
      description: input.description ?? null,
      reference: input.reference ?? null,
      country: input.destination.country ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
      testScenario: scope.mode === "test" ? (input.test_scenario ?? null) : null,
    })
    .returning();
  await recordAudit(db, { actor: opts.actor, merchantId: scope.merchantId, action: "payout.created", entityType: "payout", entityId: payout!.id, after: { amount: input.amount, currency: input.currency, destination: destination.display } });
  {
    const ev = await emitEvent(db, { merchantId: scope.merchantId, projectId: scope.projectId, mode: scope.mode, type: "payout.created", entityType: "payout", entityId: payout!.id, data: serializePayout(payout!) });
    await enqueueDeliveries(ev.deliveryIds);
  }

  const { result, decisionId } = await decideRoute(
    db,
    {
      transactionType: "payout",
      merchantId: scope.merchantId,
      projectId: scope.projectId,
      mode: scope.mode,
      amount: input.amount,
      currency: input.currency,
      paymentMethod: input.destination.type,
      country: input.destination.country ?? null,
      seed: payout!.id,
    },
    { payoutId: payout!.id },
  );
  await db.update(payouts).set({ routingDecisionId: decisionId }).where(eq(payouts.id, payout!.id));

  if (!result.ordered.length) {
    return finishPayoutFailed(db, payout!, "no_route_available", "No eligible provider supports payouts for this currency/destination", actor, "created");
  }

  let processing = await applyTransition(db, "payout", payout!.id, "created", "processing", { reason: "sent_to_provider", actor });
  let lastCode = "attempts_exhausted";
  let lastMessage: string | undefined;
  const maxAttempts = Math.min(result.ordered.length, 3);
  for (let i = 0; i < maxAttempts; i++) {
    const cand = result.ordered[i]!;
    const ctx = buildProviderContext(cand.account, cand.provider);
    const adapter = getAdapter(cand.provider.adapterKey);
    const simulate = scope.mode === "test" && input.test_scenario ? mapPayoutScenario(input.test_scenario, i) : undefined;
    let outcome: Awaited<ReturnType<typeof adapter.createPayout>>;
    try {
      outcome = await adapter.createPayout(ctx, { payoutId: payout!.id, amount: input.amount, currency: input.currency, destination, description: input.description, reference: input.reference, simulate });
    } catch (err) {
      const code = err instanceof ProviderTimeoutError ? "timeout" : err instanceof ProviderUnavailableError ? "provider_unavailable" : "technical_error";
      if (code === "technical_error") logger.error({ err, payoutId: payout!.id }, "payout adapter threw");
      outcome = { outcome: code === "timeout" ? "timeout" : code === "provider_unavailable" ? "provider_unavailable" : "technical_error", failureCode: code, providerMessage: err instanceof Error ? err.message : String(err) };
    }
    if (outcome.outcome === "success") {
      const fee = computeFee(input.amount, Number(cand.account.feePercent), cand.account.feeFixedMinor);
      const deliveries = await db.transaction(async (tx) => {
        const done = await applyTransition(tx, "payout", payout!.id, "processing", "successful", {
          reason: "provider_confirmed",
          actor,
          set: { providerAccountId: cand.account.id, providerId: cand.provider.id, providerPayoutId: outcome.providerReference ?? null, feeAmount: fee, processedAt: new Date() },
        });
        await recordTransaction(tx, {
          merchantId: scope.merchantId,
          projectId: scope.projectId,
          mode: scope.mode,
          type: "payout",
          status: "successful",
          entityType: "payout",
          entityId: payout!.id,
          amount: -input.amount,
          currency: input.currency,
          feeAmount: fee,
          providerAccountId: cand.account.id,
          providerId: cand.provider.id,
          providerReference: outcome.providerReference ?? payout!.id,
          paymentMethodType: input.destination.type,
          country: input.destination.country ?? null,
        });
        const ev = await emitEvent(tx, { merchantId: scope.merchantId, projectId: scope.projectId, mode: scope.mode, type: "payout.successful", entityType: "payout", entityId: payout!.id, data: serializePayout(done as PayoutRow, { providerName: cand.provider.name, accountName: cand.account.name }) });
        return ev.deliveryIds;
      });
      await enqueueDeliveries(deliveries);
      return (await getPayout(db, payout!.id))!;
    }
    lastCode = outcome.failureCode ?? outcome.outcome;
    lastMessage = outcome.providerMessage;
    const retryable = outcome.outcome === "technical_error" || outcome.outcome === "provider_unavailable" || outcome.outcome === "timeout";
    if (!retryable) break;
    if (outcome.outcome === "timeout") {
      // Same safety rule as payments: do not re-send a payout after a timeout unless the provider confirms nothing was created.
      const lookup = adapter.findPaymentByReference ? await adapter.findPaymentByReference(ctx, payout!.id).catch(() => null) : null;
      if (!lookup || lookup.found) break;
    }
  }
  void processing;
  return finishPayoutFailed(db, payout!, lastCode, lastMessage, actor, "processing");
}

function mapPayoutScenario(s: string, attemptIndex: number): string | undefined {
  if (s === "success") return "success";
  if (s === "hard_decline") return "hard_decline";
  if (s === "technical_error") return attemptIndex === 0 ? "technical_error" : "success";
  if (s === "unavailable") return attemptIndex === 0 ? "provider_unavailable" : "success";
  if (s === "timeout") return attemptIndex === 0 ? "timeout" : "success";
  return undefined;
}

async function finishPayoutFailed(db: Db, payout: PayoutRow, code: string, message: string | undefined, actor: { type: string; id?: string }, from: string) {
  const info = failureInfo(code);
  const deliveries = await db.transaction(async (tx) => {
    const failed = await applyTransition(tx, "payout", payout.id, from, "failed", {
      reason: code,
      actor,
      set: { failureCode: info.code, failureMessage: message ?? info.message, processedAt: new Date() },
    });
    await recordTransaction(tx, {
      merchantId: payout.merchantId,
      projectId: payout.projectId,
      mode: payout.mode,
      type: "payout",
      status: "failed",
      entityType: "payout",
      entityId: payout.id,
      amount: -payout.amount,
      currency: payout.currency,
      providerReference: `${payout.id}:failed`,
      paymentMethodType: payout.destination.type,
      country: payout.country,
      failureCode: info.code,
    });
    const ev = await emitEvent(tx, { merchantId: payout.merchantId, projectId: payout.projectId, mode: payout.mode, type: "payout.failed", entityType: "payout", entityId: payout.id, data: serializePayout(failed as PayoutRow) });
    return ev.deliveryIds;
  });
  await enqueueDeliveries(deliveries);
  return (await getPayout(db, payout.id))!;
}

export async function getPayout(db: DbOrTx, id: string, scope?: { merchantId: string }) {
  const conds = [eq(payouts.id, id)];
  if (scope) conds.push(eq(payouts.merchantId, scope.merchantId));
  const [p] = await db
    .select()
    .from(payouts)
    .where(and(...conds))
    .limit(1);
  return p ?? null;
}

export async function getPayoutDetail(db: DbOrTx, id: string, scope?: { merchantId: string }) {
  const conds = [eq(payouts.id, id)];
  if (scope) conds.push(eq(payouts.merchantId, scope.merchantId));
  const [row] = await db
    .select({ p: payouts, providerName: providers.name, accountName: providerAccounts.name })
    .from(payouts)
    .leftJoin(providers, eq(providers.id, payouts.providerId))
    .leftJoin(providerAccounts, eq(providerAccounts.id, payouts.providerAccountId))
    .where(and(...conds))
    .limit(1);
  return row ? serializePayout(row.p, { providerName: row.providerName, accountName: row.accountName }) : null;
}

export async function cancelPayout(db: Db, payout: PayoutRow, actor: Actor) {
  if (payout.status !== "created" && payout.status !== "pending") throw Errors.invalidTransition("payout", payout.status, "cancelled");
  await applyTransition(db, "payout", payout.id, payout.status, "cancelled", { reason: "cancelled_by_merchant", actor: { type: actor.type, id: actor.id } });
  await recordAudit(db, { actor, merchantId: payout.merchantId, action: "payout.cancelled", entityType: "payout", entityId: payout.id });
  return (await getPayout(db, payout.id))!;
}

export async function listPayouts(
  db: DbOrTx,
  f: { merchantId?: string; mode?: "test" | "live"; status?: string; currency?: string; search?: string; from?: Date; to?: Date; limit?: number; cursor?: string },
) {
  const conds: SQL[] = [];
  if (f.merchantId) conds.push(eq(payouts.merchantId, f.merchantId));
  if (f.mode) conds.push(eq(payouts.mode, f.mode));
  if (f.status) conds.push(eq(payouts.status, f.status as never));
  if (f.currency) conds.push(eq(payouts.currency, f.currency.toUpperCase()));
  if (f.from) conds.push(gte(payouts.createdAt, f.from));
  if (f.to) conds.push(lte(payouts.createdAt, f.to));
  if (f.search) {
    const s = `%${f.search}%`;
    conds.push(or(ilike(payouts.id, s), ilike(payouts.reference, s), ilike(payouts.providerPayoutId, s))!);
  }
  if (f.cursor) {
    conds.push(
      f.merchantId
        ? sql`${payouts.createdAt} < (select created_at from payouts where id = ${f.cursor} and merchant_id = ${f.merchantId})`
        : sql`${payouts.createdAt} < (select created_at from payouts where id = ${f.cursor})`,
    );
  }
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await db
    .select({ p: payouts, providerName: providers.name, accountName: providerAccounts.name })
    .from(payouts)
    .leftJoin(providers, eq(providers.id, payouts.providerId))
    .leftJoin(providerAccounts, eq(providerAccounts.id, payouts.providerAccountId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(payouts.createdAt), desc(payouts.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((r) => serializePayout(r.p, { providerName: r.providerName, accountName: r.accountName }));
  return { data, has_more: hasMore, next_cursor: hasMore ? data[data.length - 1]!.id : null };
}
