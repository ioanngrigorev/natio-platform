
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import catalog from "@/lib/demo-catalog.json";
import { Card, Grid, Kpi, PageHeader, Table } from "@/components/ui";
export const metadata={title:"Payment catalog"};
export default async function CatalogPage(props:{searchParams:Promise<Record<string,string|undefined>>}) {
 const q = await props.searchParams;
 const {t:translateUi,locale:uiLocale}=(await getI18n());

 const currencies=[...new Set(catalog.map(c=>c.currency))].sort(),countries=[...new Set(catalog.map(c=>c.country))].sort();
 const names=new Intl.DisplayNames(["en"],{type:"region"});
 const rows=catalog.filter(c=>(!q.currency||c.currency===q.currency)&&(!q.country||c.country===q.country)&&(!q.method||c.method===q.method||c.family===q.method)&&(!q.search||`${c.method} ${c.family} ${names.of(c.country)}`.toLowerCase().includes(q.search.toLowerCase())));
 return <><PageHeader title={translateUi("Payment catalog")} subtitle={translateUi("Demo payment methods, currencies and markets. Provider names are fictional; production availability depends on connected integrations.")}/>
 <Grid cols={4} className="mb-5"><Kpi label={translateUi("Payment methods")} value={new Set(catalog.map(c=>c.method)).size}/><Kpi label={translateUi("Currencies")} value={currencies.length}/><Kpi label={translateUi("Countries")} value={countries.length}/><Kpi label={translateUi("Market combinations")} value={catalog.length}/></Grid>
 <form className="mb-5 flex flex-wrap gap-3"><input name="search" className="input max-w-xs" defaultValue={q.search} placeholder={translateUi("Method or country")}/><select name="currency" className="input !w-auto" defaultValue={q.currency||""}><option value="">{translateUi("All currencies")}</option>{translateUi(currencies.map(c=><option key={c} value={c}>{translateUi(c)}</option>))}</select><select name="country" className="input !w-auto" defaultValue={q.country||""}><option value="">{translateUi("All countries")}</option>{translateUi(countries.map(c=><option value={c} key={c}>{translateUi(names.of(c))}</option>))}</select><button className="rounded-md bg-brand-600 px-4 py-2 text-sm text-white">{translateUi("Search catalog")}</button></form>
 <Card padded={false} title={translateUi(`${rows.length} matching combinations`)}><Table><thead><tr><th>{translateUi("Payment method")}</th><th>{translateUi("Family")}</th><th>{translateUi("Country")}</th><th>{translateUi("Currency")}</th><th>{translateUi("Explore")}</th></tr></thead><tbody>{translateUi(rows.map((c,i)=><tr key={i}><td className="font-medium"><Link className="text-brand-600" href={`/admin/bi?currency=${c.currency}&method=${encodeURIComponent(c.method)}`}>{translateUi(c.method)}</Link></td><td>{translateUi(c.family.replaceAll("_"," "))}</td><td>{translateUi(names.of(c.country))} <span className="text-xs text-ink-400">{translateUi(c.country)}</span></td><td className="font-semibold text-brand-600"><Link href={`/admin/bi?currency=${c.currency}`}>{translateUi(c.currency)}</Link></td><td><Link className="text-brand-600" href={`/admin/bi?currency=${c.currency}&method=${encodeURIComponent(c.method)}`}>{translateUi("View transactions & volume →")}</Link></td></tr>))}</tbody></Table></Card></>;
}
