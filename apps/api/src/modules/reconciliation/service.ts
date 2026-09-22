import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import type { Db, DbOrTx } from "../../db/client.js";
import { mockProviderRecords, providerAccounts, providers, reconciliationBatches, reconciliationItems, transactions, type ReconTotals } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { recordAudit, type Actor } from "../audit/service.js";

/** Provider accounts are either platform-wide (merchant_id null) or dedicated to one merchant. */
export async function assertProviderAccountVisible(db: DbOrTx, providerAccountId: string, merchantId: string): Promise<void> {
  const [acc] = await db
    .select({ id: providerAccounts.id })
    .from(providerAccounts)
    .where(and(eq(providerAccounts.id, providerAccountId), or(isNull(providerAccounts.merchantId), eq(providerAccounts.merchantId, merchantId))))
    .limit(1);
  if (!acc) throw Errors.notFound("Provider account", providerAccountId);
}

/** Hard cap on provider report size: the whole file is parsed and matched in memory. */
export const MAX_CSV_ROWS = 50_000;

export type BatchRow = typeof reconciliationBatches.$inferSelect;

export interface ProviderReportRow {
  provider_reference: string;
  natio_reference?: string;
  amount: number;
  currency: string;
  status: string;
  type?: string;
}

const HEADER_ALIASES: Record<string, keyof ProviderReportRow> = {
  provider_reference: "provider_reference",
  reference: "provider_reference",
  transaction_id: "provider_reference",
  id: "provider_reference",
  natio_reference: "natio_reference",
  merchant_reference: "natio_reference",
  payment_id: "natio_reference",
  amount: "amount",
  currency: "currency",
  status: "status",
  type: "type",
};

/** Parse a provider CSV into normalised rows. Headers are matched case-insensitively with aliases. */
export function parseProviderCsv(text: string): ProviderReportRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(text, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    throw Errors.badRequest("invalid_csv", `CSV could not be parsed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  if (records.length > MAX_CSV_ROWS) {
    throw Errors.badRequest("csv_too_large", `Provider report has ${records.length} rows; the limit is ${MAX_CSV_ROWS}. Split the file by period.`);
  }
  const out: ProviderReportRow[] = [];
  for (const rec of records) {
    const row: Partial<ProviderReportRow> = {};
    for (const [k, v] of Object.entries(rec)) {
      const target = HEADER_ALIASES[k];
      if (!target) continue;
      if (target === "amount") row.amount = parseAmount(v);
      else (row as Record<string, string>)[target] = v;
    }
    if (!row.provider_reference || row.amount === undefined || Number.isNaN(row.amount) || !row.currency || !row.status) continue;
    out.push({ ...row, currency: row.currency.toUpperCase(), status: row.status.toLowerCase() } as ProviderReportRow);
  }
  if (!out.length) throw Errors.badRequest("invalid_csv", "CSV has no usable rows. Required columns: provider_reference, amount, currency, status");
  return out;
}

function parseAmount(v: string): number {
  const cleaned = v.replace(/[^0-9.-]/g, "");
  if (!cleaned) return Number.NaN;
  // Amounts in provider files are minor units when integer, major units when decimal.
  if (cleaned.includes(".")) return Math.round(Number.parseFloat(cleaned) * 100);
  return Number.parseInt(cleaned, 10);
}

export function normalizeProviderStatus(s: string): "successful" | "failed" | "pending" | "other" {
  const v = s.toLowerCase();
  if (["successful", "success", "captured", "settled", "approved", "completed", "paid", "refunded"].includes(v)) return "successful";
  if (["failed", "declined", "error", "rejected", "cancelled", "canceled", "voided"].includes(v)) return "failed";
  if (["pending", "processing", "authorized"].includes(v)) return "pending";
  return "other";
}

export interface ReconcileInput {
  natio: Array<{ id: string; entityId: string; paymentId: string | null; providerReference: string | null; amount: number; currency: string; status: string; type: string }>;
  provider: ProviderReportRow[];
}

export interface ReconcileOutput {
  items: Array<{
    status: "MATCHED" | "MISSING_PROVIDER" | "MISSING_NATIO" | "AMOUNT_MISMATCH" | "STATUS_MISMATCH";
    transactionId?: string;
    paymentId?: string | null;
    providerReference?: string;
    natioAmount?: number;
    providerAmount?: number;
    currency?: string;
    natioStatus?: string;
    providerStatus?: string;
    notes?: string;
  }>;
  totals: ReconTotals;
}

/** Pure matching algorithm (unit tested). */
export function reconcile(input: ReconcileInput): ReconcileOutput {
  const items: ReconcileOutput["items"] = [];
  const byProviderRef = new Map<string, ReconcileInput["natio"][number]>();
  const byNatioRef = new Map<string, ReconcileInput["natio"][number]>();
  for (const t of input.natio) {
    if (t.providerReference) byProviderRef.set(t.providerReference, t);
    byNatioRef.set(t.entityId, t);
    if (t.paymentId) byNatioRef.set(t.paymentId, t);
  }
  const seen = new Set<string>();
  for (const p of input.provider) {
    const t = byProviderRef.get(p.provider_reference) ?? (p.natio_reference ? byNatioRef.get(p.natio_reference) : undefined);
    if (!t) {
      items.push({ status: "MISSING_NATIO", providerReference: p.provider_reference, providerAmount: p.amount, currency: p.currency, providerStatus: p.status, notes: "Provider reports a transaction NATIO does not have" });
      continue;
    }
    seen.add(t.id);
    const natioAmount = Math.abs(t.amount);
    const pStatus = normalizeProviderStatus(p.status);
    const nStatus = t.status === "successful" ? "successful" : t.status === "failed" || t.status === "cancelled" ? "failed" : "pending";
    if (pStatus !== nStatus) {
      items.push({ status: "STATUS_MISMATCH", transactionId: t.id, paymentId: t.paymentId, providerReference: p.provider_reference, natioAmount, providerAmount: p.amount, currency: t.currency, natioStatus: t.status, providerStatus: p.status });
      continue;
    }
    if (natioAmount !== Math.abs(p.amount) || t.currency !== p.currency) {
      items.push({ status: "AMOUNT_MISMATCH", transactionId: t.id, paymentId: t.paymentId, providerReference: p.provider_reference, natioAmount, providerAmount: p.amount, currency: t.currency, natioStatus: t.status, providerStatus: p.status, notes: t.currency !== p.currency ? `currency ${t.currency} vs ${p.currency}` : undefined });
      continue;
    }
    items.push({ status: "MATCHED", transactionId: t.id, paymentId: t.paymentId, providerReference: p.provider_reference, natioAmount, providerAmount: p.amount, currency: t.currency, natioStatus: t.status, providerStatus: p.status });
  }
  for (const t of input.natio) {
    if (seen.has(t.id)) continue;
    if (t.status !== "successful") continue; // only settled money is expected in provider files
    items.push({ status: "MISSING_PROVIDER", transactionId: t.id, paymentId: t.paymentId, providerReference: t.providerReference ?? undefined, natioAmount: Math.abs(t.amount), currency: t.currency, natioStatus: t.status, notes: "NATIO has a successful transaction the provider did not report" });
  }
  const totals: ReconTotals = { total: items.length, MATCHED: 0, MISSING_PROVIDER: 0, MISSING_NATIO: 0, AMOUNT_MISMATCH: 0, STATUS_MISMATCH: 0 };
  for (const i of items) totals[i.status]++;
  return { items, totals };
}

export async function runReconciliation(
  db: Db,
  input: { merchantId: string | null; mode: "test" | "live"; providerAccountId: string; source: "csv" | "api"; fileName?: string; rows: ProviderReportRow[]; periodStart?: Date; periodEnd?: Date; actor: Actor },
): Promise<BatchRow> {
  const [acc] = await db.select().from(providerAccounts).where(eq(providerAccounts.id, input.providerAccountId)).limit(1);
  if (!acc) throw Errors.notFound("Provider account", input.providerAccountId);
  const conds: SQL[] = [eq(transactions.providerAccountId, input.providerAccountId), eq(transactions.mode, input.mode), inArray(transactions.type, ["payment", "refund", "payout"])];
  if (input.merchantId) conds.push(eq(transactions.merchantId, input.merchantId));
  if (input.periodStart) conds.push(gte(transactions.occurredAt, input.periodStart));
  if (input.periodEnd) conds.push(lte(transactions.occurredAt, input.periodEnd));
  const natio = await db
    .select()
    .from(transactions)
    .where(and(...conds));
  const result = reconcile({
    natio: natio.map((t) => ({ id: t.id, entityId: t.entityId, paymentId: t.paymentId, providerReference: t.providerReference, amount: t.amount, currency: t.currency, status: t.status, type: t.type })),
    provider: input.rows,
  });
  const id = newId("reconBatch");
  await db.transaction(async (tx) => {
    await tx.insert(reconciliationBatches).values({
      id,
      merchantId: input.merchantId,
      mode: input.mode,
      providerAccountId: input.providerAccountId,
      source: input.source,
      fileName: input.fileName ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      status: "completed",
      totals: result.totals,
      createdBy: input.actor.id ?? null,
      completedAt: new Date(),
    });
    if (result.items.length) {
      await tx.insert(reconciliationItems).values(
        result.items.map((i) => ({
          id: newId("reconItem"),
          batchId: id,
          status: i.status,
          transactionId: i.transactionId ?? null,
          paymentId: i.paymentId ?? null,
          providerReference: i.providerReference ?? null,
          natioAmount: i.natioAmount ?? null,
          providerAmount: i.providerAmount ?? null,
          currency: i.currency ?? null,
          natioStatus: i.natioStatus ?? null,
          providerStatus: i.providerStatus ?? null,
          notes: i.notes ?? null,
        })),
      );
    }
    await recordAudit(tx, { actor: input.actor, merchantId: input.merchantId ?? undefined, action: "reconciliation.run", entityType: "reconciliation_batch", entityId: id, after: { totals: result.totals, source: input.source, file: input.fileName } });
  });
  const [batch] = await db.select().from(reconciliationBatches).where(eq(reconciliationBatches.id, id)).limit(1);
  return batch!;
}

export function serializeBatch(b: BatchRow, extra: { providerName?: string | null; accountName?: string | null } = {}) {
  return {
    id: b.id,
    object: "reconciliation_batch",
    mode: b.mode,
    merchant_id: b.merchantId,
    provider_account_id: b.providerAccountId,
    provider_name: extra.providerName ?? null,
    provider_account_name: extra.accountName ?? null,
    source: b.source,
    file_name: b.fileName,
    period_start: b.periodStart,
    period_end: b.periodEnd,
    status: b.status,
    totals: b.totals,
    error: b.error,
    created_at: b.createdAt,
    completed_at: b.completedAt,
  };
}

export async function listBatches(db: DbOrTx, f: { merchantId?: string; mode?: "test" | "live"; limit?: number }) {
  const conds: SQL[] = [];
  if (f.merchantId) conds.push(eq(reconciliationBatches.merchantId, f.merchantId));
  if (f.mode) conds.push(eq(reconciliationBatches.mode, f.mode));
  const rows = await db
    .select({ b: reconciliationBatches, providerName: providers.name, accountName: providerAccounts.name })
    .from(reconciliationBatches)
    .innerJoin(providerAccounts, eq(providerAccounts.id, reconciliationBatches.providerAccountId))
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(reconciliationBatches.createdAt))
    .limit(Math.min(f.limit ?? 50, 200));
  return rows.map((r) => serializeBatch(r.b, { providerName: r.providerName, accountName: r.accountName }));
}

export async function getBatchDetail(db: DbOrTx, id: string, scope?: { merchantId: string }, f: { status?: string } = {}) {
  const conds = [eq(reconciliationBatches.id, id)];
  if (scope) conds.push(eq(reconciliationBatches.merchantId, scope.merchantId));
  const [row] = await db
    .select({ b: reconciliationBatches, providerName: providers.name, accountName: providerAccounts.name })
    .from(reconciliationBatches)
    .innerJoin(providerAccounts, eq(providerAccounts.id, reconciliationBatches.providerAccountId))
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(and(...conds))
    .limit(1);
  if (!row) return null;
  const iconds = [eq(reconciliationItems.batchId, id)];
  if (f.status) iconds.push(eq(reconciliationItems.status, f.status as never));
  const items = await db
    .select()
    .from(reconciliationItems)
    .where(and(...iconds))
    .orderBy(reconciliationItems.status, reconciliationItems.createdAt)
    .limit(2000);
  return {
    ...serializeBatch(row.b, { providerName: row.providerName, accountName: row.accountName }),
    items: items.map((i) => ({
      id: i.id,
      status: i.status,
      transaction_id: i.transactionId,
      payment_id: i.paymentId,
      provider_reference: i.providerReference,
      natio_amount: i.natioAmount,
      provider_amount: i.providerAmount,
      currency: i.currency,
      natio_status: i.natioStatus,
      provider_status: i.providerStatus,
      notes: i.notes,
      resolved_at: i.resolvedAt,
    })),
  };
}

export async function resolveItem(db: Db, itemId: string, note: string, actor: Actor) {
  const [item] = await db.select().from(reconciliationItems).where(eq(reconciliationItems.id, itemId)).limit(1);
  if (!item) throw Errors.notFound("Reconciliation item", itemId);
  await db.update(reconciliationItems).set({ resolvedAt: new Date(), resolvedBy: actor.id ?? null, notes: note }).where(eq(reconciliationItems.id, itemId));
  await recordAudit(db, { actor, action: "reconciliation.item_resolved", entityType: "reconciliation_item", entityId: itemId, after: { note } });
}

/**
 * Sandbox: export the demo provider's own ledger as CSV, the way a real provider would deliver
 * a settlement/transactions report. Useful to demonstrate reconciliation end to end.
 */
export async function sandboxProviderReport(
  db: DbOrTx,
  providerAccountId: string,
  opts: { from?: Date; to?: Date; merchantId?: string } = {},
): Promise<{ csv: string; rows: ProviderReportRow[] }> {
  const conds: SQL[] = [eq(mockProviderRecords.providerAccountId, providerAccountId), inArray(mockProviderRecords.kind, ["payment", "refund", "payout"])];
  if (opts.from) conds.push(gte(mockProviderRecords.createdAt, opts.from));
  if (opts.to) conds.push(lte(mockProviderRecords.createdAt, opts.to));
  // A provider account is shared by every merchant routed through it, so its ledger must be
  // narrowed to the caller's own entities. Without this a merchant reads its neighbours' traffic.
  if (opts.merchantId) {
    const m = opts.merchantId;
    conds.push(sql`(
      ${mockProviderRecords.natioReference} is not null
      and (
        exists (select 1 from payments p where p.id = ${mockProviderRecords.natioReference} and p.merchant_id = ${m})
        or exists (select 1 from refunds r where r.id = ${mockProviderRecords.natioReference} and r.merchant_id = ${m})
        or exists (select 1 from payouts o where o.id = ${mockProviderRecords.natioReference} and o.merchant_id = ${m})
      )
    )`);
  }
  const recs = await db
    .select()
    .from(mockProviderRecords)
    .where(and(...conds))
    .orderBy(mockProviderRecords.createdAt);
  const rows: ProviderReportRow[] = recs
    .filter((r) => r.status !== "pending" && r.status !== "authorized")
    .map((r) => ({
      provider_reference: r.externalId,
      natio_reference: r.natioReference ?? undefined,
      amount: r.kind === "payment" ? r.capturedAmount || r.amount : r.amount,
      currency: r.currency,
      status: r.status === "captured" || r.status === "refunded" ? "settled" : r.status,
      type: r.kind,
    }));
  const header = "provider_reference,natio_reference,type,amount,currency,status";
  const lines = rows.map((r) => [r.provider_reference, r.natio_reference ?? "", r.type ?? "", r.amount, r.currency, r.status].join(","));
  return { csv: [header, ...lines].join("\n") + "\n", rows };
}
