import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { merchantUsers, merchants, projects, payments, payouts, providerAccounts, providers, transactions } from "../../db/schema/index.js";
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
  // Snapshot observed routing and PSP evidence in the same transaction as the ledger entry.
  // Never infer a customer's deposit history from their local payment sequence.
  let trafficType='unknown', conversion:Record<string,unknown>|null=null;
  if(input.paymentId){
    const facts=await db.execute(sql`SELECT p.traffic_type,p.status,p.failure_code,p.processing_time_ms,
      (SELECT count(*)::int FROM payment_attempts a WHERE a.payment_id=p.id AND a.request_sent_at IS NOT NULL) attempts,
      (SELECT bool_or(a.status IN ('authorized','succeeded')) FROM payment_attempts a WHERE a.payment_id=p.id AND (a.status IN ('authorized','succeeded') OR a.outcome IN ('soft_decline','hard_decline'))) approved,
      (SELECT bool_or(d.selected_provider_account_id IS NOT NULL) FROM routing_decisions d WHERE d.payment_id=p.id) selected
      FROM payments p WHERE p.id=${input.paymentId} AND p.merchant_id=${input.merchantId} AND p.mode=${input.mode}`);
    const f=facts.rows[0] as any;
    if(f){trafficType=f.traffic_type;if(input.type==='payment')conversion={source:'observed',method_selected:f.selected,psp_submitted:f.attempts>0,psp_approved:f.approved,completed:input.status==='pending'?null:input.status==='successful',attempt_count:f.attempts,latency_ms:f.processing_time_ms,decline_reason:f.failure_code};}
  }
  const [row] = await db
    .insert(transactions)
    .values({
      id: newId("transaction"),
      merchantId: input.merchantId,
      projectId: input.projectId,
      mode: input.mode,
      type: input.type,
      trafficType, conversion,
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

export function serializeTransaction(t: TransactionRow & { providerName?: string | null; providerAccountName?: string | null; merchantName?: string | null; channel?: string | null; externalReference?: string | null; owner?: string | null }) {
  return {
    id: t.id,
    object: "transaction",
    merchant_id: t.merchantId,
    project_id: t.projectId,
    merchant_name: t.merchantName,
    channel: t.channel,
    external_reference: t.externalReference,
    owner: t.owner,
    received_amount: t.status === "successful" ? Math.abs(t.amount) : 0,
    mode: t.mode,
    type: t.type,
    status: t.status,
    traffic_type: t.trafficType,
    conversion: t.conversion,
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
        ? sql`(${transactions.occurredAt}, ${transactions.id}) < (select occurred_at, id from transactions where id = ${f.cursor} and merchant_id = ${f.merchantId})`
        : sql`(${transactions.occurredAt}, ${transactions.id}) < (select occurred_at, id from transactions where id = ${f.cursor})`,
    );
  }
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await db
    .select({ t: transactions, providerName: providers.name, providerAccountName: providerAccounts.name, merchantName: merchants.name, channel: projects.name, owner: merchants.contactEmail, externalReference: sql<string>`coalesce(${payments.reference},${payouts.reference})` })
    .from(transactions)
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(projects, eq(projects.id, transactions.projectId))
    .leftJoin(payments, eq(payments.id, transactions.paymentId))
    .leftJoin(payouts, eq(payouts.id, transactions.entityId))
    .leftJoin(providers, eq(providers.id, transactions.providerId))
    .leftJoin(providerAccounts, eq(providerAccounts.id, transactions.providerAccountId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((r) => serializeTransaction({ ...r.t, providerName: r.providerName, providerAccountName: r.providerAccountName, merchantName: r.merchantName, channel: r.channel, owner: r.owner, externalReference: r.externalReference }));
  return { data, has_more: hasMore, next_cursor: hasMore ? data[data.length - 1]!.id : null };
}
