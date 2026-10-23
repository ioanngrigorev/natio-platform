
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { Card, PageHeader, Table } from "@/components/ui";
import { serverApi } from "@/lib/session";
import { formatMoney,formatNumber } from "@/lib/format";
import type { BiReport } from "@/lib/bi-types";
export const metadata={title:"Balances"};
export default async function BalancesPage(){
 const {t:translateUi,locale:uiLocale}=getI18n();

 const r=await serverApi().get<BiReport>("/admin/bi?from=2025-01-01&to=2025-12-31&currency=EUR");
 return <><PageHeader title={translateUi("Balances by currency")} subtitle={translateUi("2025 · Successful payments less payouts, fees and provider settlements. Demo balances are calculated from the ledger.")} actions={<Link href="/admin/bi" className="text-brand-600">{translateUi("Explore in BI →")}</Link>}/><Card padded={false}><Table><thead><tr><th>{translateUi("Currency")}</th><th className="num">{translateUi("Transactions")}</th><th className="num">{translateUi("Pay-in volume")}</th><th className="num">{translateUi("Payouts")}</th><th className="num">{translateUi("Fees")}</th><th className="num">{translateUi("Settled")}</th><th className="num">{translateUi("Unsettled balance")}</th></tr></thead><tbody>{translateUi(r.balances.map(b=><tr key={b.currency}><td><Link className="font-semibold text-brand-600" href={`/admin/bi?currency=${b.currency}`}>{translateUi(b.currency)}</Link></td><td className="num">{translateUi(formatNumber(b.transactions))}</td>{translateUi([b.volume,b.payouts,b.fees,b.settled,b.ledger_net-b.settled].map((v,i)=><td key={i} className={`num ${i===4?"font-semibold text-brand-600":""}`}>{translateUi(formatMoney(v,b.currency))}</td>))}</tr>))}</tbody></Table></Card><p className="mt-3 text-xs text-ink-500">{translateUi("Balances remain separate by currency. NATIO reports provider processing data and does not hold funds.")}</p></>;
}
