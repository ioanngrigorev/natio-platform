import Link from "next/link";
import { BiCharts } from "@/components/admin/bi-charts";
import { Card, Grid, Kpi, Table } from "@/components/ui";
import { serverApi } from "@/lib/session";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { BiReport } from "@/lib/bi-types";

export const metadata={title:"BI & Reports"};
export default async function BiPage({searchParams:q}:{searchParams:Record<string,string|undefined>}) {
  const api=serverApi();
  const params=new URLSearchParams({from:q.from||"2025-01-01",to:q.to||"2025-12-31",currency:q.currency||"EUR"});
  if(q.merchant_id)params.set("merchant_id",q.merchant_id);if(q.method)params.set("method",q.method);
  const [r,merchants]=await Promise.all([api.get<BiReport>(`/admin/bi?${params}`),api.get<{data:Array<{id:string;name:string}>}>("/admin/merchants?fields=options&limit=200")]);
  return <>
    <div className="admin-hero flex flex-wrap items-center justify-between gap-5"><div><p className="admin-eyebrow">NATIO Intelligence · {api.mode==="test"?"Synthetic data":"Live data"}</p><h1 className="mt-2">A complete view of your payments.</h1><p className="mt-2 text-sm text-ink-500">{formatNumber(r.coverage.transactions)} transactions across {formatNumber(r.coverage.merchants)} merchants and {formatNumber(r.coverage.providers)} providers.</p></div><div className="flex flex-wrap gap-2"><a className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm text-white" href={`/api/admin/bi/export.xlsx?${params}&mode=${api.mode}&kind=summary`}>Download Excel report ↓</a><a className="rounded-lg border border-brand-600 px-4 py-2.5 text-sm text-brand-600" href={`/api/admin/bi/export.xlsx?${params}&mode=${api.mode}&kind=transactions&all_currencies=1`}>Full ledger Excel ↓</a></div></div>
    <form className="mb-6 grid gap-3 rounded-xl border border-ink-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-6" action="/admin/bi">
      <label className="text-xs text-ink-500">From<input className="input mt-1" type="date" name="from" defaultValue={params.get("from")!}/></label>
      <label className="text-xs text-ink-500">To<input className="input mt-1" type="date" name="to" defaultValue={params.get("to")!}/></label>
      <label className="text-xs text-ink-500">Currency<select className="input mt-1" name="currency" defaultValue={r.currency}>{[...new Set([r.currency,...r.options.currencies])].map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="text-xs text-ink-500">Merchant<select className="input mt-1" name="merchant_id" defaultValue={q.merchant_id||""}><option value="">All merchants</option>{merchants.data.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="text-xs text-ink-500">Payment method<select className="input mt-1" name="method" defaultValue={q.method||""}><option value="">All methods</option>{r.options.methods.map(m=><option key={m}>{m}</option>)}</select></label>
      <button className="self-end rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">Apply filters</button>
    </form>
    <Grid cols={4} className="mb-5"><Kpi label="Pay-in volume" value={formatMoney(r.summary.volume,r.currency,{compact:true})} hint="Successful payments"/><Kpi label="Transactions" value={formatNumber(r.summary.transactions)} hint="Within selected filters"/><Kpi label="Provider fees" value={formatMoney(r.summary.fees,r.currency,{compact:true})} hint="Successful operations"/><Kpi label="Unsettled balance" value={formatMoney(r.summary.ledger_net-r.summary.settled,r.currency,{compact:true})} hint="Net ledger less settled funds"/></Grid>
    <BiCharts report={r}/>
    <Card title="Merchant performance" description={`Selected period · ${r.currency}`} className="mt-5" padded={false}><Table><thead><tr><th>Merchant</th><th className="num">Transactions</th><th className="num">Pay-in volume</th><th className="num">Success</th><th className="num">Fees</th><th className="num">Unsettled balance</th></tr></thead><tbody>{r.merchants.map(m=><tr key={m.merchant_id}><td><Link className="text-brand-600" href={`/admin/merchants/${m.merchant_id}`}>{m.label}</Link></td><td className="num">{formatNumber(m.transactions)}</td><td className="num">{formatMoney(m.volume,r.currency)}</td><td className="num">{formatPercent(m.successful+m.failed?m.successful/(m.successful+m.failed):null)}</td><td className="num">{formatMoney(m.fees,r.currency)}</td><td className="num">{formatMoney(m.ledger_net-m.settled,r.currency)}</td></tr>)}</tbody></Table></Card>
    <p className="mt-3 text-xs text-ink-500">Amounts use the selected currency. The Excel report follows all filters. Full ledger Excel includes every currency within the date, merchant and method filters. Amounts remain separate by currency.</p>
  </>;
}
