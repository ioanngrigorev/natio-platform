import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { paymentAttempts, payments, providerAccounts, providers, transactions } from "../../db/schema/index.js";

export interface AnalyticsScope {
  merchantId?: string;
  mode: "test" | "live";
  from: Date;
  to: Date;
  currency?: string;
}

function paymentConds(s: AnalyticsScope): SQL[] {
  const c: SQL[] = [eq(payments.mode, s.mode), gte(payments.createdAt, s.from), lte(payments.createdAt, s.to)];
  if (s.merchantId) c.push(eq(payments.merchantId, s.merchantId));
  return c;
}

/** Pick the most used currency (by number of successful payments) when none was requested. */
export async function dominantCurrency(db: DbOrTx, s: AnalyticsScope): Promise<string | null> {
  const [row] = await db
    .select({ currency: payments.currency, n: sql<number>`count(*)`.mapWith(Number) })
    .from(payments)
    .where(and(...paymentConds(s), eq(payments.status, "successful")))
    .groupBy(payments.currency)
    .orderBy(desc(sql`count(*)`), payments.currency)
    .limit(1);
  return row?.currency ?? null;
}

export async function overview(db: DbOrTx, s: AnalyticsScope) {
  const currency = s.currency ?? (await dominantCurrency(db, s));
  const [counts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      successful: sql<number>`count(*) filter (where ${payments.status} in ('successful','refunded','partially_refunded'))`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')`.mapWith(Number),
      inFlight: sql<number>`count(*) filter (where ${payments.status} in ('created','pending','processing','authorized'))`.mapWith(Number),
      avgProcessing: sql<number>`avg(${payments.processingTimeMs}) filter (where ${payments.status} in ('successful','refunded','partially_refunded'))`.mapWith(Number),
    })
    .from(payments)
    .where(and(...paymentConds(s)));
  const [vol] = currency
    ? await db
        .select({
          tpv: sql<number>`coalesce(sum(${payments.capturedAmount}) filter (where ${payments.status} in ('successful','refunded','partially_refunded')), 0)`.mapWith(Number),
          refunded: sql<number>`coalesce(sum(${payments.refundedAmount}), 0)`.mapWith(Number),
          fees: sql<number>`coalesce(sum(${payments.feeAmount}) filter (where ${payments.status} in ('successful','refunded','partially_refunded')), 0)`.mapWith(Number),
          successfulCount: sql<number>`count(*) filter (where ${payments.status} in ('successful','refunded','partially_refunded'))`.mapWith(Number),
        })
        .from(payments)
        .where(and(...paymentConds(s), eq(payments.currency, currency)))
    : [{ tpv: 0, refunded: 0, fees: 0, successfulCount: 0 }];
  const attemptConds: SQL[] = [eq(payments.mode, s.mode), gte(paymentAttempts.createdAt, s.from), lte(paymentAttempts.createdAt, s.to)];
  if (s.merchantId) attemptConds.push(eq(payments.merchantId, s.merchantId));
  const [att] = await db
    .select({
      attempts: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('success','requires_action'))`.mapWith(Number),
      technical: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('technical_error','timeout','provider_unavailable'))`.mapWith(Number),
    })
    .from(paymentAttempts)
    .innerJoin(payments, eq(payments.id, paymentAttempts.paymentId))
    .where(and(...attemptConds));
  const decided = (counts?.successful ?? 0) + (counts?.failed ?? 0);
  return {
    currency,
    period: { from: s.from, to: s.to },
    tpv: vol?.tpv ?? 0,
    net_revenue: (vol?.tpv ?? 0) - (vol?.refunded ?? 0),
    refunded: vol?.refunded ?? 0,
    processing_cost: vol?.fees ?? 0,
    average_ticket: vol?.successfulCount ? Math.round((vol.tpv ?? 0) / vol.successfulCount) : 0,
    transactions: counts?.total ?? 0,
    successful: counts?.successful ?? 0,
    failed: counts?.failed ?? 0,
    in_flight: counts?.inFlight ?? 0,
    success_rate: decided ? (counts!.successful / decided) : null,
    approval_rate: att?.attempts ? att.approved / att.attempts : null,
    provider_uptime: att?.attempts ? 1 - att.technical / att.attempts : null,
    avg_processing_ms: counts?.avgProcessing ? Math.round(counts.avgProcessing) : null,
  };
}

export async function timeseries(db: DbOrTx, s: AnalyticsScope, bucket: "hour" | "day" = "day") {
  const currency = s.currency ?? (await dominantCurrency(db, s));
  const conds = paymentConds(s);
  // bucket is a controlled enum ("hour" | "day"); inlined so GROUP BY and SELECT reference the same expression.
  const trunc = sql.raw(`date_trunc('${bucket === "hour" ? "hour" : "day"}', "payments"."created_at")`);
  const rows = await db
    .select({
      bucket: sql<string>`to_char(${trunc}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      tpv: currency
        ? sql<number>`coalesce(sum(${payments.capturedAmount}) filter (where ${payments.status} in ('successful','refunded','partially_refunded') and ${payments.currency} = ${currency}), 0)`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
      total: sql<number>`count(*)`.mapWith(Number),
      successful: sql<number>`count(*) filter (where ${payments.status} in ('successful','refunded','partially_refunded'))`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')`.mapWith(Number),
    })
    .from(payments)
    .where(and(...conds))
    .groupBy(trunc)
    .orderBy(trunc);
  return {
    currency,
    bucket,
    points: rows.map((r) => ({ t: r.bucket, tpv: r.tpv, transactions: r.total, successful: r.successful, failed: r.failed, success_rate: r.successful + r.failed ? r.successful / (r.successful + r.failed) : null })),
  };
}

async function breakdown(db: DbOrTx, s: AnalyticsScope, column: SQL, label: string) {
  const currency = s.currency ?? (await dominantCurrency(db, s));
  const rows = await db
    .select({
      key: sql<string>`coalesce(${column}::text, 'unknown')`,
      total: sql<number>`count(*)`.mapWith(Number),
      successful: sql<number>`count(*) filter (where ${payments.status} in ('successful','refunded','partially_refunded'))`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')`.mapWith(Number),
      tpv: currency
        ? sql<number>`coalesce(sum(${payments.capturedAmount}) filter (where ${payments.status} in ('successful','refunded','partially_refunded') and ${payments.currency} = ${currency}), 0)`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
    })
    .from(payments)
    .where(and(...paymentConds(s)))
    .groupBy(column)
    .orderBy(desc(sql`count(*)`))
    .limit(25);
  return { dimension: label, currency, rows: rows.map((r) => ({ key: r.key, transactions: r.total, successful: r.successful, failed: r.failed, tpv: r.tpv, success_rate: r.successful + r.failed ? r.successful / (r.successful + r.failed) : null })) };
}

export async function breakdowns(db: DbOrTx, s: AnalyticsScope) {
  const [country, currency, method, provider, declines] = await Promise.all([
    breakdown(db, s, sql`${payments.country}`, "country"),
    breakdown(db, s, sql`${payments.currency}`, "currency"),
    breakdown(db, s, sql`${payments.paymentMethodType}`, "payment_method"),
    providerBreakdown(db, s),
    declineReasons(db, s),
  ]);
  return { by_country: country, by_currency: currency, by_method: method, by_provider: provider, decline_reasons: declines };
}

async function providerBreakdown(db: DbOrTx, s: AnalyticsScope) {
  const currency = s.currency ?? (await dominantCurrency(db, s));
  const rows = await db
    .select({
      key: sql<string>`coalesce(${providers.name}, 'unrouted')`,
      total: sql<number>`count(*)`.mapWith(Number),
      successful: sql<number>`count(*) filter (where ${payments.status} in ('successful','refunded','partially_refunded'))`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')`.mapWith(Number),
      tpv: currency
        ? sql<number>`coalesce(sum(${payments.capturedAmount}) filter (where ${payments.status} in ('successful','refunded','partially_refunded') and ${payments.currency} = ${currency}), 0)`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
    })
    .from(payments)
    .leftJoin(providers, eq(providers.id, payments.providerId))
    .where(and(...paymentConds(s)))
    .groupBy(providers.name)
    .orderBy(desc(sql`count(*)`));
  return { dimension: "provider", currency, rows: rows.map((r) => ({ key: r.key, transactions: r.total, successful: r.successful, failed: r.failed, tpv: r.tpv, success_rate: r.successful + r.failed ? r.successful / (r.successful + r.failed) : null })) };
}

async function declineReasons(db: DbOrTx, s: AnalyticsScope) {
  const rows = await db
    .select({ key: sql<string>`coalesce(${payments.failureCode}, 'unknown')`, total: sql<number>`count(*)`.mapWith(Number), category: sql<string>`max(${payments.declineCategory})` })
    .from(payments)
    .where(and(...paymentConds(s), eq(payments.status, "failed")))
    .groupBy(payments.failureCode)
    .orderBy(desc(sql`count(*)`))
    .limit(15);
  return { dimension: "decline_reason", rows: rows.map((r) => ({ key: r.key, transactions: r.total, category: r.category })) };
}

/** Provider comparison table (attempt-level metrics + fees). */
export async function providerComparison(db: DbOrTx, s: AnalyticsScope) {
  const currency = s.currency ?? (await dominantCurrency(db, s));
  const conds: SQL[] = [eq(payments.mode, s.mode), gte(paymentAttempts.createdAt, s.from), lte(paymentAttempts.createdAt, s.to)];
  if (s.merchantId) conds.push(eq(payments.merchantId, s.merchantId));
  const rows = await db
    .select({
      providerAccountId: paymentAttempts.providerAccountId,
      providerName: providers.name,
      accountName: providerAccounts.name,
      attempts: sql<number>`count(*)`.mapWith(Number),
      successes: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('success','requires_action'))`.mapWith(Number),
      technical: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('technical_error','timeout','provider_unavailable'))`.mapWith(Number),
      avgLatency: sql<number>`avg(${paymentAttempts.latencyMs})`.mapWith(Number),
      fees: sql<number>`coalesce(sum(${paymentAttempts.feeAmount}), 0)`.mapWith(Number),
      volume: currency
        ? sql<number>`coalesce(sum(${payments.amount}) filter (where ${paymentAttempts.outcome} = 'success' and ${payments.currency} = ${currency}), 0)`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
    })
    .from(paymentAttempts)
    .innerJoin(payments, eq(payments.id, paymentAttempts.paymentId))
    .innerJoin(providerAccounts, eq(providerAccounts.id, paymentAttempts.providerAccountId))
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(and(...conds))
    .groupBy(paymentAttempts.providerAccountId, providers.name, providerAccounts.name)
    .orderBy(desc(sql`count(*)`));
  return {
    currency,
    rows: rows.map((r) => ({
      provider_account_id: r.providerAccountId,
      provider: r.providerName,
      account: r.accountName,
      volume: r.volume,
      transactions: r.attempts,
      success_rate: r.attempts ? r.successes / r.attempts : null,
      cost: r.fees,
      avg_latency_ms: r.attempts ? Math.round(r.avgLatency ?? 0) : null,
      uptime: r.attempts ? 1 - r.technical / r.attempts : null,
    })),
  };
}

/** Platform-wide numbers for the admin overview. */
export async function platformOverview(db: DbOrTx, mode: "test" | "live", from: Date, to: Date) {
  const [p] = await db
    .select({
      merchants: sql<number>`count(distinct ${payments.merchantId})`.mapWith(Number),
      total: sql<number>`count(*)`.mapWith(Number),
      successful: sql<number>`count(*) filter (where ${payments.status} in ('successful','refunded','partially_refunded'))`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${payments.status} = 'pending')`.mapWith(Number),
      processing: sql<number>`count(*) filter (where ${payments.status} = 'processing')`.mapWith(Number),
    })
    .from(payments)
    .where(and(eq(payments.mode, mode), gte(payments.createdAt, from), lte(payments.createdAt, to)));
  const volumes = await db
    .select({ currency: transactions.currency, tpv: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'payment'), 0)`.mapWith(Number), fees: sql<number>`coalesce(sum(${transactions.feeAmount}), 0)`.mapWith(Number) })
    .from(transactions)
    .where(and(eq(transactions.mode, mode), eq(transactions.status, "successful"), gte(transactions.occurredAt, from), lte(transactions.occurredAt, to)))
    .groupBy(transactions.currency)
    .orderBy(desc(sql`sum(${transactions.amount})`));
  return { ...p!, volumes };
}
