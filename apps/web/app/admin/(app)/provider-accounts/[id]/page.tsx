import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityLink } from "@/components/admin/entity-link";
import { AccountsTable } from "@/components/admin/provider-actions";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { Card, DescriptionList, Grid, Kpi, PageHeader, StatusBadge, Table } from "@/components/ui";
import { serverApi } from "@/lib/session";
import { ApiRequestError } from "@/lib/api";
import { formatMoney, formatNumber, formatPercent, formatMs } from "@/lib/format";
import type { ProviderAccount, Payment, Paginated } from "@/lib/types";

type Account = ProviderAccount & { balances: Array<{currency:string;transactions:number;volume:number;fees:number;balance:number}> };
export const metadata = { title: "Provider account" };
export default async function ProviderAccountPage({ params }: { params: { id: string } }) {
  const api=serverApi(); let a:Account;
  try { a=await api.get<Account>(`/admin/provider-accounts/${encodeURIComponent(params.id)}`); }
  catch(e) { if(e instanceof ApiRequestError && e.status===404) notFound(); throw e; }
  const payments=await api.get<Paginated<Payment>>(`/admin/payments?provider_account_id=${encodeURIComponent(a.id)}&limit=10`);
  return <><PageHeader breadcrumb={<EntityLink kind="providers" id={a.provider_id}>← {a.provider_name}</EntityLink>} title={<span className="flex items-center gap-3">{a.name}<StatusBadge status={a.status}/></span>} subtitle={`${api.mode === "test" ? "2025 · " : ""}${a.id} · ${a.mode} account`}/>
    <Grid cols={4}><Kpi label="Attempts" value={formatNumber(a.health?.attempts||0)}/><Kpi label="Approval" value={formatPercent(a.health?.approval_rate)}/><Kpi label="Uptime" value={formatPercent(a.health?.uptime)}/><Kpi label="Average latency" value={formatMs(a.health?.avg_latency_ms)}/></Grid>
    <Card className="mt-5" title="Account profile"><DescriptionList cols={3} items={[{label:"Provider",value:<EntityLink kind="providers" id={a.provider_id}>{a.provider_name}</EntityLink>},{label:"Merchant",value:a.merchant_id?<EntityLink kind="merchants" id={a.merchant_id}>{a.merchant_id}</EntityLink>:"Shared account"},{label:"Fee",value:`${a.fee_percent}% + ${a.fee_fixed_minor} minor units`},{label:"Currencies",value:a.currencies.join(", ") || "Provider default"},{label:"Priority",value:a.priority},{label:"Payment method",value:String((a.config as Record<string,unknown>).method || "Provider default")}]}/></Card>
    <Card className="mt-5" title="Balances by currency" description="Successful ledger entries less provider settlements." padded={false}><Table><thead><tr><th>Currency</th><th className="num">Transactions</th><th className="num">Pay-in volume</th><th className="num">Fees</th><th className="num">Unsettled balance</th></tr></thead><tbody>{a.balances.map(b=><tr key={b.currency}><td>{b.currency}</td><td className="num">{formatNumber(b.transactions)}</td><td className="num">{formatMoney(b.volume,b.currency)}</td><td className="num">{formatMoney(b.fees,b.currency)}</td><td className="num">{formatMoney(b.balance,b.currency)}</td></tr>)}</tbody></Table>{!a.balances.length&&<p className="p-4 text-ink-500">No ledger entries for this account.</p>}</Card>
    <div className="my-5 flex flex-wrap gap-4 text-sm text-brand-600"><Link href={`/admin/payments?provider_account_id=${a.id}`}>All payments →</Link><Link href={`/admin/transactions?provider_account_id=${a.id}`}>Transactions →</Link><Link href={`/admin/settlements?provider_account_id=${a.id}`}>Settlements →</Link><Link href={`/admin/reconciliation?provider_account_id=${a.id}`}>Reconciliation →</Link></div>
    <Card title="Recent payments" padded={false}><PaymentsTable payments={payments.data} hrefBase="/admin/payments"/></Card><Card className="mt-5" title="Configuration and events" padded={false}><AccountsTable accounts={[a]}/></Card></>;
}
