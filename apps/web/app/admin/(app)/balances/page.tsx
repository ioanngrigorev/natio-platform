import Link from "next/link";
import { Card, PageHeader, Table } from "@/components/ui";
import { serverApi } from "@/lib/session";
import { formatMoney,formatNumber } from "@/lib/format";
import type { BiReport } from "@/lib/bi-types";
export const metadata={title:"Balances"};
export default async function BalancesPage(){
 const r=await serverApi().get<BiReport>("/admin/bi?from=2025-01-01&to=2025-12-31&currency=EUR");
 return <><PageHeader title="Balances by currency" subtitle="2025 · Successful payments less payouts, fees and provider settlements. Demo balances are calculated from the ledger." actions={<Link href="/admin/bi" className="text-brand-600">Explore in BI →</Link>}/><Card padded={false}><Table><thead><tr><th>Currency</th><th className="num">Transactions</th><th className="num">Pay-in volume</th><th className="num">Payouts</th><th className="num">Fees</th><th className="num">Settled</th><th className="num">Unsettled balance</th></tr></thead><tbody>{r.balances.map(b=><tr key={b.currency}><td><Link className="font-semibold text-brand-600" href={`/admin/bi?currency=${b.currency}`}>{b.currency}</Link></td><td className="num">{formatNumber(b.transactions)}</td>{[b.volume,b.payouts,b.fees,b.settled,b.ledger_net-b.settled].map((v,i)=><td key={i} className={`num ${i===4?"font-semibold text-brand-600":""}`}>{formatMoney(v,b.currency)}</td>)}</tr>)}</tbody></Table></Card><p className="mt-3 text-xs text-ink-500">Balances remain separate by currency. NATIO reports provider processing data and does not hold funds.</p></>;
}
