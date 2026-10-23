import {getPool} from '../../db/client.js';
import {biWhere,type BiQuery} from './bi.js';
import {SnapshotCache} from './snapshot-cache.js';
const cache=new SnapshotCache();
export const conversionDefinitions={method:'Eligible method / route found ÷ operations with a recorded selection result.',approval:'PSP approved ÷ PSP approved + PSP declined. Pending and technical/unknown responses are excluded.',payment:'Completed payments ÷ operations submitted to a PSP. Pending submissions remain in the denominator.',recovery:'Completed payments with more than one PSP attempt ÷ operations with more than one attempt.',scope:'Ledger payment operations in the selected period, not unique visitors or all checkout sessions. FTD/STD is declared by the merchant; STD includes all returning deposits.'};
const aggregates=`count(*)::int operations,
 count(*) FILTER(WHERE conversion IS NOT NULL)::int observed,
 count(*) FILTER(WHERE conversion->>'source'='synthetic')::int synthetic,
 count(*) FILTER(WHERE conversion->>'method_selected' IN ('true','false'))::int selection_known,
 count(*) FILTER(WHERE conversion->>'method_selected'='true')::int selected,
 count(*) FILTER(WHERE conversion->>'psp_submitted'='true')::int submitted,
 count(*) FILTER(WHERE conversion->>'psp_approved'='true')::int approved,
 count(*) FILTER(WHERE conversion->>'psp_approved'='false')::int declined,
 count(*) FILTER(WHERE conversion->>'completed'='true' AND conversion->>'psp_submitted'='true')::int completed,
 count(*) FILTER(WHERE status='pending')::int pending,
 count(*) FILTER(WHERE status='failed')::int failed,
 count(*) FILTER(WHERE (conversion->>'attempt_count')::int>1)::int retried,
 count(*) FILTER(WHERE status='successful' AND (conversion->>'attempt_count')::int>1)::int recovered,
 coalesce(sum(amount) FILTER(WHERE status='successful'),0)::bigint volume,
 percentile_cont(.95) WITHIN GROUP(ORDER BY (conversion->>'latency_ms')::numeric) p95_ms`;
export function trafficRates(row:Record<string,any>){const ratio=(n:number,d:number)=>d?100*n/d:null;return {...row,volume:Number(row.volume),method_success_rate:ratio(row.selected,row.selection_known),approval_rate:ratio(row.approved,row.approved+row.declined),payment_success_rate:ratio(row.completed,row.submitted),recovery_rate:ratio(row.recovered,row.retried),coverage_pct:ratio(row.observed,row.operations)};}
export async function trafficAnalytics(q:BiQuery,mode:'test'|'live'){
 return cache.get(JSON.stringify([q,mode]),async()=>{const f=biWhere(q,mode),where=f.where+" AND t.type='payment'",p=getPool();const [groups,daily,reasons]=await Promise.all([
 p.query(`SELECT traffic_type label,${aggregates} FROM transactions t WHERE ${where} GROUP BY traffic_type ORDER BY traffic_type`,f.values),
 p.query(`SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,traffic_type label,${aggregates} FROM transactions t WHERE ${where} GROUP BY 1,2 ORDER BY 1,2`,f.values),
 p.query(`SELECT traffic_type label,coalesce(failure_code,'unspecified') reason,count(*)::int operations FROM transactions t WHERE ${where} AND status='failed' GROUP BY 1,2 ORDER BY operations DESC LIMIT 12`,f.values)]);
 return {period:{from:q.from,to:q.to},currency:q.currency,mode,definitions:conversionDefinitions,groups:groups.rows.map(trafficRates),daily:daily.rows.map(trafficRates),declines:reasons.rows};});
}
