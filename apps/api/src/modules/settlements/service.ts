import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import { providerAccounts, providers, settlementItems, settlements, transactions } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { emitEvent, enqueueDeliveries } from "../events/service.js";

export type SettlementRow = typeof settlements.$inferSelect;

export function serializeSettlement(s: SettlementRow, extra: { providerName?: string | null; accountName?: string | null; settlementEntity?: string | null } = {}) {
  return {
    id: s.id,
    object: "settlement",
    mode: s.mode,
    provider_account_id: s.providerAccountId,
    provider_name: extra.providerName ?? null,
    provider_account_name: extra.accountName ?? null,
    settlement_entity: extra.settlementEntity ?? null,
    settlement_reference: s.settlementReference,
    currency: s.currency,
    gross_amount: s.grossAmount,
    fee_amount: s.feeAmount,
    net_amount: s.netAmount,
    transaction_count: s.transactionCount,
    period_start: s.periodStart,
    period_end: s.periodEnd,
    status: s.status,
    source: s.source,
    settled_at: s.settledAt,
    created_at: s.createdAt,
  };
}

export async function listSettlements(db: DbOrTx, f: { merchantId?: string; mode?: "test" | "live"; providerAccountId?: string; status?: string; limit?: number }) {
  const conds: SQL[] = [];
  if (f.merchantId) conds.push(eq(settlements.merchantId, f.merchantId));
  if (f.mode) conds.push(eq(settlements.mode, f.mode));
  if (f.providerAccountId) conds.push(eq(settlements.providerAccountId, f.providerAccountId));
  if (f.status) conds.push(eq(settlements.status, f.status as never));
  const rows = await db
    .select({ s: settlements, providerName: providers.name, accountName: providerAccounts.name, entity: providers.settlementEntity })
    .from(settlements)
    .innerJoin(providerAccounts, eq(providerAccounts.id, settlements.providerAccountId))
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(settlements.periodEnd))
    .limit(Math.min(f.limit ?? 50, 200));
  return rows.map((r) => serializeSettlement(r.s, { providerName: r.providerName, accountName: r.accountName, settlementEntity: r.entity }));
}

export async function getSettlementDetail(db: DbOrTx, id: string, scope?: { merchantId: string }) {
  const conds = [eq(settlements.id, id)];
  if (scope) conds.push(eq(settlements.merchantId, scope.merchantId));
  const [row] = await db
    .select({ s: settlements, providerName: providers.name, accountName: providerAccounts.name, entity: providers.settlementEntity })
    .from(settlements)
    .innerJoin(providerAccounts, eq(providerAccounts.id, settlements.providerAccountId))
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(and(...conds))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select({ i: settlementItems, t: transactions })
    .from(settlementItems)
    .innerJoin(transactions, eq(transactions.id, settlementItems.transactionId))
    .where(eq(settlementItems.settlementId, id))
    .orderBy(transactions.occurredAt);
  return {
    ...serializeSettlement(row.s, { providerName: row.providerName, accountName: row.accountName, settlementEntity: row.entity }),
    items: items.map((x) => ({ transaction_id: x.t.id, type: x.t.type, entity_id: x.t.entityId, amount: x.i.amount, fee_amount: x.i.feeAmount, occurred_at: x.t.occurredAt })),
  };
}

/**
 * Build a settlement from a provider's report. In the sandbox the report is derived from the
 * provider's own ledger (successful transactions of the account in the period that are not yet settled).
 * With real providers this is fed by the provider's settlement file/API through the adapter.
 */
export async function createSettlementFromProviderReport(
  db: Db,
  input: { merchantId: string; mode: "test" | "live"; providerAccountId: string; periodStart: Date; periodEnd: Date; reference?: string; source?: "provider_report" | "provider_api" | "manual"; actor: Actor },
) {
  const [acc] = await db.select().from(providerAccounts).where(eq(providerAccounts.id, input.providerAccountId)).limit(1);
  if (!acc) throw Errors.notFound("Provider account", input.providerAccountId);
  const txs = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.merchantId, input.merchantId),
        eq(transactions.mode, input.mode),
        eq(transactions.providerAccountId, input.providerAccountId),
        eq(transactions.status, "successful"),
        inArray(transactions.type, ["payment", "refund"]),
        isNull(transactions.settlementId),
        gte(transactions.occurredAt, input.periodStart),
        lte(transactions.occurredAt, input.periodEnd),
      ),
    );
  if (!txs.length) throw Errors.conflict("nothing_to_settle", "No unsettled successful transactions for this provider account in the period");
  const byCurrency = new Map<string, typeof txs>();
  for (const t of txs) byCurrency.set(t.currency, [...(byCurrency.get(t.currency) ?? []), t]);

  const created: SettlementRow[] = [];
  const deliveries: string[] = [];
  await db.transaction(async (tx) => {
    for (const [currency, rows] of byCurrency) {
      const gross = rows.reduce((s, t) => s + t.amount, 0);
      const fees = rows.reduce((s, t) => s + t.feeAmount, 0);
      const id = newId("settlement");
      const [s] = await tx
        .insert(settlements)
        .values({
          id,
          merchantId: input.merchantId,
          mode: input.mode,
          providerAccountId: input.providerAccountId,
          settlementReference: input.reference ?? `${acc.name.replace(/\s+/g, "-").toUpperCase()}-${input.periodEnd.toISOString().slice(0, 10)}-${currency}`,
          currency,
          grossAmount: gross,
          feeAmount: fees,
          netAmount: gross - fees,
          transactionCount: rows.length,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: "settled",
          source: input.source ?? "provider_report",
          settledAt: new Date(),
        })
        .returning();
      await tx.insert(settlementItems).values(rows.map((t) => ({ id: newId("settlementItem"), settlementId: id, transactionId: t.id, amount: t.amount, feeAmount: t.feeAmount })));
      await tx
        .update(transactions)
        .set({ settlementId: id })
        .where(
          inArray(
            transactions.id,
            rows.map((t) => t.id),
          ),
        );
      const ev = await emitEvent(tx, {
        merchantId: input.merchantId,
        projectId: rows[0]!.projectId,
        mode: input.mode,
        type: "settlement.created",
        entityType: "settlement",
        entityId: id,
        data: serializeSettlement(s!),
      });
      deliveries.push(...ev.deliveryIds);
      created.push(s!);
    }
    await recordAudit(tx, { actor: input.actor, merchantId: input.merchantId, action: "settlement.created", entityType: "settlement", entityId: created.map((c) => c.id).join(","), after: { count: created.length, provider_account_id: input.providerAccountId } });
  });
  await enqueueDeliveries(deliveries);
  return created;
}

/** Balances view: NATIO is not a custodian; figures are derived from processed transactions and provider-reported settlements. */
export async function balances(db: DbOrTx, scope: { merchantId: string; mode: "test" | "live" }) {
  const processed = await db
    .select({
      currency: transactions.currency,
      gross: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('payment','refund')), 0)`.mapWith(Number),
      fees: sql<number>`coalesce(sum(${transactions.feeAmount}) filter (where ${transactions.type} in ('payment','refund')), 0)`.mapWith(Number),
      payouts: sql<number>`coalesce(sum(-${transactions.amount}) filter (where ${transactions.type} = 'payout'), 0)`.mapWith(Number),
      settled: sql<number>`coalesce(sum(${transactions.amount} - ${transactions.feeAmount}) filter (where ${transactions.type} in ('payment','refund') and ${transactions.settlementId} is not null), 0)`.mapWith(Number),
    })
    .from(transactions)
    .where(and(eq(transactions.merchantId, scope.merchantId), eq(transactions.mode, scope.mode), eq(transactions.status, "successful")))
    .groupBy(transactions.currency);
  return processed.map((r) => ({
    currency: r.currency,
    processed_gross: r.gross,
    fees: r.fees,
    processed_net: r.gross - r.fees,
    settled_by_providers: r.settled,
    awaiting_provider_settlement: r.gross - r.fees - r.settled,
    payouts_sent: r.payouts,
    note: "Funds are held and settled by licensed providers. NATIO reports provider settlement data and does not hold merchant funds.",
  }));
}
