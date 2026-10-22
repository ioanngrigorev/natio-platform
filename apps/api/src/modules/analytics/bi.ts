import { storedMethod } from "../demo/display.js";
import { z } from "zod";
import { getPool } from "../../db/client.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, "Invalid calendar date");
export const biQuery = z.object({
  from: date.default("2025-01-01"), to: date.default("2025-12-31"),
  currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  merchant_id: z.string().max(100).optional(), method: z.string().max(160).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  status: z.enum(["successful","failed","pending","cancelled"]).optional(),
  type: z.enum(["payment","payout","refund","adjustment","fee"]).optional(),
  provider_account_id: z.string().max(100).optional(),
  kind: z.enum(["summary", "transactions", "daily", "merchants", "providers", "methods", "countries", "balances"]).default("summary"),
  all_currencies: z.enum(["0", "1"]).default("0"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["label","currency","transactions","volume","fees","amount","occurred_at"]).default("transactions"),
  direction: z.enum(["asc","desc"]).default("desc"),
}).refine(q => q.from <= q.to, "From must be on or before To");
export type BiQuery = z.infer<typeof biQuery>;

export function biWhere(q: BiQuery, mode: "test" | "live", currency = true) {
  const values: unknown[] = [mode, q.from, q.to];
  let where = "t.mode=$1 AND t.occurred_at >= $2::date AND t.occurred_at < $3::date + interval '1 day'";
  for (const [column, value] of [["t.currency", currency ? q.currency : undefined], ["t.merchant_id", q.merchant_id], ["t.payment_method_type", mode === "test" && q.method ? storedMethod(q.method) : q.method], ["t.country",q.country], ["t.status",q.status], ["t.type",q.type], ["t.provider_account_id",q.provider_account_id]] as const) {
    if (value) {
      values.push(value); const match=`${column}=$${values.length}`;
      if(column==="t.payment_method_type" && mode==="test" && q.method!==value){values.push(q.method);where+=` AND (${match} OR ${column}=$${values.length})`;}
      else where+=` AND ${match}`;
    }
  }
  return { where, values };
}

export const measures = `count(*)::bigint transactions,
 count(*) FILTER(WHERE status='successful')::bigint successful,
 count(*) FILTER(WHERE status='failed')::bigint failed,
 count(*) FILTER(WHERE status='pending')::bigint pending,
 coalesce(sum(amount) FILTER(WHERE type='payment' AND status='successful'),0)::bigint volume,
 coalesce(sum(fee_amount) FILTER(WHERE status='successful'),0)::bigint fees,
 coalesce(sum(-amount) FILTER(WHERE type='payout' AND status='successful'),0)::bigint payouts,
 coalesce(sum(net_amount) FILTER(WHERE status='successful'),0)::bigint ledger_net,
 coalesce(sum(net_amount) FILTER(WHERE status='successful' AND settlement_id IS NOT NULL),0)::bigint settled`;

export async function businessIntelligence(q: BiQuery, mode: "test" | "live") {
  const pool = getPool(), f = biWhere(q, mode), all = biWhere(q, mode, false);
  const [report, balances, options, coverage] = await Promise.all([
    pool.query(`WITH s AS MATERIALIZED (SELECT t.* FROM transactions t WHERE ${f.where})
      SELECT (SELECT row_to_json(x) FROM (SELECT ${measures} FROM s) x) summary,
      (SELECT coalesce(json_agg(x ORDER BY "day"),'[]') FROM (SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS "day", ${measures} FROM s GROUP BY 1) x) daily,
      (SELECT coalesce(json_agg(x),'[]') FROM (SELECT payment_method_type label,${measures} FROM s GROUP BY 1 ORDER BY count(*) DESC) x) methods,
      (SELECT coalesce(json_agg(x),'[]') FROM (SELECT country label,${measures} FROM s GROUP BY 1 ORDER BY count(*) DESC) x) countries,
      (SELECT coalesce(json_agg(x),'[]') FROM (SELECT m.name label,s.merchant_id,${measures.replaceAll('status=', 's.status=')} FROM s JOIN merchants m ON m.id=s.merchant_id GROUP BY m.name,s.merchant_id ORDER BY count(*) DESC) x) merchants,
      (SELECT coalesce(json_agg(x),'[]') FROM (SELECT status label,count(*)::bigint transactions FROM s GROUP BY status) x) statuses`, f.values),
    pool.query(`SELECT currency,${measures} FROM transactions t WHERE ${all.where} GROUP BY currency ORDER BY currency`, all.values),
    pool.query(`SELECT
      (SELECT coalesce(json_agg(x ORDER BY x),'[]') FROM (SELECT DISTINCT config->>'method' x FROM provider_accounts WHERE mode=$1 AND config->>'method' IS NOT NULL) a) methods,
      (SELECT coalesce(json_agg(x ORDER BY x),'[]') FROM (SELECT DISTINCT jsonb_array_elements_text(currencies) x FROM provider_accounts WHERE mode=$1) a) currencies`, [mode]),
    pool.query(`SELECT (SELECT count(*) FROM merchants) merchants,(SELECT count(*) FROM merchant_users) users,
      (SELECT count(DISTINCT provider_id) FROM provider_accounts WHERE mode=$1) providers,
      (SELECT count(*) FROM transactions WHERE mode=$1) transactions`, [mode]),
  ]);
  return { period: { from: q.from, to: q.to }, currency: q.currency, mode, ...report.rows[0], balances: balances.rows, options: options.rows[0], coverage: coverage.rows[0] };
}
