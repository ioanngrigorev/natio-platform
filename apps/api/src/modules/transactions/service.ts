import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { providerAccounts, providers, transactions } from "../../db/schema/index.js";
import { newId } from "../../lib/ids.js";

export type TransactionRow = typeof transactions.$inferSelect;

export interface RecordTransactionInput {
  merchantId: string;
  projectId: string;
  mode: "test" | "live";
  type: "payment" | "refund" | "payout" | "fee" | "adjustment";
  status: "pending" | "successful" | "failed" | "cancelled";
  entityType: string;
  entityId: string;
  paymentId?: string | null;
  attemptId?: string | null;
  amount: number;
  currency: string;
  feeAmount?: number;
  providerAccountId?: string | null;
  providerId?: string | null;
  providerReference?: string | null;
  paymentMethodType?: string | null;
  country?: string | null;
  processingTimeMs?: number | null;
  failureCode?: string | null;
  occurredAt?: Date;
}

export async function recordTransaction(db: DbOrTx, input: RecordTransactionInput): Promise<TransactionRow> {
  const fee = input.feeAmount ?? 0;
  const [row] = await db
    .insert(transactions)
    .values({
      id: newId("transaction"),
      merchantId: input.merchantId,
      projectId: input.projectId,
      mode: input.mode,
      type: input.type,
      status: input.status,
      entityType: input.entityType,
      entityId: input.entityId,
      paymentId: input.paymentId ?? null,
      attemptId: input.attemptId ?? null,
      amount: input.amount,
      currency: input.currency,
      feeAmount: fee,
      netAmount: input.amount - Math.sign(input.amount || 1) * fee,
      providerAccountId: input.providerAccountId ?? null,
      providerId: input.providerId ?? null,
      providerReference: input.providerReference ?? null,
      paymentMethodType: input.paymentMethodType ?? null,
      country: input.country ?? null,
      processingTimeMs: input.processingTimeMs ?? null,
      failureCode: input.failureCode ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing()
    .returning();
  return row!;
}

export interface TransactionFilter {
  merchantId?: string;
  mode?: "test" | "live";
  projectId?: string;
  type?: string;
  status?: string;
  currency?: string;
  providerAccountId?: string;
  country?: string;
  paymentMethodType?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export function serializeTransaction(t: TransactionRow & { providerName?: string | null; providerAccountName?: string | null }) {
  return {
    id: t.id,
    object: "transaction",
    mode: t.mode,
    type: t.type,
    status: t.status,
    entity_type: t.entityType,
    entity_id: t.entityId,
    payment_id: t.paymentId,
    attempt_id: t.attemptId,
    amount: t.amount,
    currency: t.currency,
    fee_amount: t.feeAmount,
    net_amount: t.netAmount,
    provider_account_id: t.providerAccountId,
    provider_id: t.providerId,
    provider_name: t.providerName ?? null,
    provider_account_name: t.providerAccountName ?? null,
    provider_reference: t.providerReference,
    payment_method: t.paymentMethodType,
    country: t.country,
    processing_time_ms: t.processingTimeMs,
    failure_code: t.failureCode,
    settlement_id: t.settlementId,
    occurred_at: t.occurredAt,
    created_at: t.createdAt,
  };
}

export async function listTransactions(db: DbOrTx, f: TransactionFilter) {
  const conds: SQL[] = [];
  if (f.merchantId) conds.push(eq(transactions.merchantId, f.merchantId));
  if (f.mode) conds.push(eq(transactions.mode, f.mode));
  if (f.projectId) conds.push(eq(transactions.projectId, f.projectId));
  if (f.type) conds.push(eq(transactions.type, f.type as never));
  if (f.status) conds.push(eq(transactions.status, f.status as never));
  if (f.currency) conds.push(eq(transactions.currency, f.currency.toUpperCase()));
  if (f.providerAccountId) conds.push(eq(transactions.providerAccountId, f.providerAccountId));
  if (f.country) conds.push(eq(transactions.country, f.country.toUpperCase()));
  if (f.paymentMethodType) conds.push(eq(transactions.paymentMethodType, f.paymentMethodType));
  if (f.from) conds.push(gte(transactions.occurredAt, f.from));
  if (f.to) conds.push(lte(transactions.occurredAt, f.to));
  if (f.search) {
    const s = `%${f.search}%`;
    conds.push(or(ilike(transactions.id, s), ilike(transactions.entityId, s), ilike(transactions.providerReference, s), ilike(sql`coalesce(${transactions.paymentId}, '')`, s))!);
  }
  if (f.cursor) {
    conds.push(
      f.merchantId
        ? sql`${transactions.occurredAt} < (select occurred_at from transactions where id = ${f.cursor} and merchant_id = ${f.merchantId})`
        : sql`${transactions.occurredAt} < (select occurred_at from transactions where id = ${f.cursor})`,
    );
  }
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await db
    .select({ t: transactions, providerName: providers.name, providerAccountName: providerAccounts.name })
    .from(transactions)
    .leftJoin(providers, eq(providers.id, transactions.providerId))
    .leftJoin(providerAccounts, eq(providerAccounts.id, transactions.providerAccountId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((r) => serializeTransaction({ ...r.t, providerName: r.providerName, providerAccountName: r.providerAccountName }));
  return { data, has_more: hasMore, next_cursor: hasMore ? data[data.length - 1]!.id : null };
}
