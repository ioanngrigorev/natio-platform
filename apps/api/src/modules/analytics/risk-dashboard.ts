import { z } from 'zod';
import { getPool } from '../../db/client.js';
import { biQuery,biWhere } from './bi.js';
import { demoDisplay } from '../demo/display.js';
export const riskQuery=biQuery.transform(q=>({...q,status:undefined,type:undefined})).refine(q=>(Date.parse(q.to)-Date.parse(q.from))/86400000<=730,'Maximum risk window is 731 days');
export const riskThresholds=z.object({decline_pct:z.coerce.number().min(1).max(100).default(15),min_count:z.coerce.number().int().min(20).max(10000).default(100),concentration_pct:z.coerce.number().min(1).max(100).default(35),spike_multiplier:z.coerce.number().min(1.5).max(10).default(2)});
export const industryPlaybooks=[
 {industry:'Subscriptions',triggers:['Repeat billing disputes','Refunds after renewal','Unclear cancellation'],controls:['Keep consent and renewal notice evidence','Track cancellation-to-refund time'],impact:'Disputes and refund exposure'},
 {industry:'Travel & advance delivery',triggers:['Long delivery horizon','Seasonal cancellation spike','Supplier failure'],controls:['Track undelivered obligations','Reconcile refund deadlines and supplier exposure'],impact:'Future delivery and liquidity exposure'},
 {industry:'Gaming & wagering',triggers:['Restricted jurisdictions','Rapid deposit and withdrawal','Account takeover'],controls:['Verify applicable licenses and customer eligibility','Review linked accounts and source of funds'],impact:'Partner eligibility and fraud exposure'},
 {industry:'Digital assets & financial services',triggers:['Rapid value movement','Unusual geographic patterns','Unauthorized investment claims'],controls:['Verify activity-specific approval','Review ownership, counterparties and transaction evidence'],impact:'Regulatory and reputational exposure'},
 {industry:'Marketplaces',triggers:['Undisclosed sellers','Seller concentration','Non-delivery complaints'],controls:['KYB of submerchants','Trace settlement to each seller'],impact:'Aggregated partner and fulfillment exposure'},
];
export function buildSignals(data:any,threshold:z.infer<typeof riskThresholds>){
 const signals:any[]=[];
 for(const m of data.merchants){const decided=Number(m.successful)+Number(m.failed),pct=decided?Number(m.failed)/decided*100:0;
 if(decided>=threshold.min_count&&pct>=threshold.decline_pct)signals.push({id:'decline-'+m.id,severity:pct>=threshold.decline_pct*2?'high':'review',title:'Elevated payment failure rate',entity:m.name,href:`/admin/merchants/${m.id}`,value:pct,unit:'%',evidence:`${m.failed} failed / ${decided} decided payments`,impact:'Lower conversion; check issuer, method and PSP failure reasons.',basis:'Calculated from selected transactions'});
 if(m.kyb!=='approved')signals.push({id:'kyb-'+m.id,severity:'review',title:'Business verification incomplete',entity:m.name,href:`/admin/merchants/${m.id}`,value:null,unit:'',evidence:`KYB: ${m.kyb}. Account: ${m.status}`,impact:'Live processing must remain blocked pending approval.',basis:'Merchant verification status'});
 }
 const volume=Number(data.summary.volume);
 for(const p of data.providers){const share=volume?Number(p.volume)/volume*100:0;
 if(share>=threshold.concentration_pct)signals.push({id:'concentration-'+p.id,severity:'review',title:'PSP concentration',entity:p.name,href:`/admin/provider-accounts/${p.id}`,value:share,unit:'%',evidence:`${share.toFixed(1)}% of successful pay-in volume`,impact:'An outage may affect a large share of processing. Review eligible fallback routes.',basis:'Calculated; one currency'});
 }
 for(let i=7;i<data.daily.length;i++){const d=data.daily[i],prior=data.daily.slice(Math.max(0,i-30),i),baseline=prior.reduce((s:number,x:any)=>s+Number(x.payments),0)/prior.length;
 if(baseline>0&&Number(d.payments)>=threshold.min_count&&Number(d.payments)>=baseline*threshold.spike_multiplier)signals.push({id:'velocity-'+d.day,severity:'review',title:'Daily activity spike',entity:d.day,href:`/admin/bi?from=${d.day}&to=${d.day}&currency=${data.currency}`,value:Number(d.payments)/baseline,unit:'×',evidence:`${d.payments} payments vs ${baseline.toFixed(0)} daily average over prior ${prior.length} days in view`,impact:'Investigate campaigns, retries or unusual activity. A spike is not proof of fraud.',basis:'Calculated, preceding available days'});
 }
 return signals.sort((a,b)=>(a.severity==='high'?-1:0)-(b.severity==='high'?-1:0));
}
export async function riskDashboard(raw:unknown,mode:'test'|'live'){
 const q=riskQuery.parse(raw),thresholds=riskThresholds.parse(raw),f=biWhere(q,mode),pool=getPool();
 const metric=`count(*) FILTER(WHERE type='payment')::int payments,count(*) FILTER(WHERE type='payment' AND status='successful')::int successful,count(*) FILTER(WHERE type='payment' AND status='failed')::int failed,count(*) FILTER(WHERE type='payment' AND status='pending')::int pending,coalesce(sum(amount) FILTER(WHERE type='payment' AND status='successful'),0)::float8 volume,count(*) FILTER(WHERE type='refund' AND status='successful')::int refunds,coalesce(sum(abs(amount)) FILTER(WHERE type='refund' AND status='successful'),0)::float8 refund_amount`;
 const result=await pool.query(`WITH s AS MATERIALIZED(SELECT t.* FROM transactions t WHERE ${f.where}),
 d AS(SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,${metric} FROM s GROUP BY 1),
 dates AS(SELECT to_char(day,'YYYY-MM-DD') AS day FROM generate_series($2::date,$3::date,interval '1 day') AS g(day)),
 m AS(SELECT merchant_id,${metric} FROM s GROUP BY merchant_id),
 p AS(SELECT provider_account_id,${metric} FROM s GROUP BY provider_account_id)
 SELECT (SELECT row_to_json(t) FROM(SELECT ${metric},percentile_cont(.99) WITHIN GROUP(ORDER BY amount) FILTER(WHERE type='payment' AND status='successful') p99_amount FROM s)t) summary,
 (SELECT coalesce(json_agg(json_build_object('day',dates.day,'payments',coalesce(d.payments,0),'successful',coalesce(d.successful,0),'failed',coalesce(d.failed,0),'pending',coalesce(d.pending,0),'volume',coalesce(d.volume,0),'refunds',coalesce(d.refunds,0),'refund_amount',coalesce(d.refund_amount,0)) ORDER BY dates.day),'[]') FROM dates LEFT JOIN d USING(day)) daily,
 (SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.failed DESC),'[]') FROM(SELECT m.*,x.id,x.name,x.kyb_status kyb,x.status,x.settings->>'industry' industry FROM m JOIN merchants x ON x.id=m.merchant_id)t) merchants,
 (SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.volume DESC),'[]') FROM(SELECT p.*,a.id,a.name FROM p JOIN provider_accounts a ON a.id=p.provider_account_id ORDER BY p.volume DESC LIMIT 100)t) providers,
 (SELECT coalesce(json_agg(row_to_json(t)),'[]') FROM(SELECT id,merchant_id,provider_account_id,amount,occurred_at FROM s WHERE type='payment' AND status='successful' ORDER BY amount DESC,id LIMIT 12)t) large_payments`,f.values);
 const data={...result.rows[0],currency:q.currency,mode,period:{from:q.from,to:q.to},thresholds,generated_at:new Date().toISOString(),disputes:{available:false,reason:'No PSP dispute or fraud feed is connected. No chargeback rate is inferred from failed payments.'}};
 const resultData={...data,signals:buildSignals(data,thresholds),industries:industryPlaybooks,provider_scope:"Top 100 by successful volume; concentration denominator includes all providers"};
 return mode==='test'?demoDisplay(resultData):resultData;
}
