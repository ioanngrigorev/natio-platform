
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountsTable, ProviderStatusButton } from "@/components/admin/provider-actions";
import { Card, DescriptionList, PageHeader, StatusBadge, Tag } from "@/components/ui";
import { serverApi } from "@/lib/session";
import { ApiRequestError } from "@/lib/api";
import type { Provider } from "@/lib/types";

export const metadata = { title: "Provider profile" };
export default async function ProviderPage(props: { params: Promise<{ id: string }> }) {
 const params = await props.params;
 const {t:translateUi,locale:uiLocale}=(await getI18n());

 let p: Provider;
 try { p = await (await serverApi()).get<Provider>(`/admin/providers/${encodeURIComponent(params.id)}`); }
 catch(e) { if (e instanceof ApiRequestError && e.status === 404) notFound(); throw e; }
 return <><PageHeader breadcrumb={<Link href="/admin/providers">{translateUi("← Providers")}</Link>} title={translateUi(<span className="flex items-center gap-3">{p.name}<StatusBadge status={p.status}/></span>)} subtitle={translateUi(p.description)} actions={<ProviderStatusButton provider={p}/>}/>
   <Card title={translateUi("Provider profile")}><DescriptionList cols={3} items={[{label:"Provider ID",value:p.id},{label:"Code",value:p.code},{label:"Type",value:p.type},{label:"Settlement entity",value:p.settlement_entity || p.name},{label:"Adapter",value:p.adapter_key},{label:"Accounts",value:p.accounts.length}]}/></Card>
   <div className="my-5 grid gap-5 md:grid-cols-3">{translateUi([{label:"Payment methods",values:p.supported_methods,key:"method"},{label:"Currencies",values:p.supported_currencies,key:"currency"},{label:"Countries",values:p.supported_countries,key:"country"}].map(g=><Card key={g.label} title={translateUi(g.label)}><div className="flex flex-wrap gap-2">{translateUi(g.values.map(v=><Link key={v} href={`/admin/catalog?${g.key}=${encodeURIComponent(v)}`}><Tag>{translateUi(v)}</Tag></Link>))}</div></Card>))}</div>
   <Card title={translateUi("Provider accounts")} description={translateUi("Open an account to inspect balances, fees and its payment history.")} padded={false}><AccountsTable accounts={p.accounts}/></Card></>;
}
