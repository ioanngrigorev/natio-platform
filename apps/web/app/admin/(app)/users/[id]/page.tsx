
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityLink } from "@/components/admin/entity-link";
import { Card, DescriptionList, PageHeader, StatusBadge } from "@/components/ui";
import { serverApi } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import type { AdminUsersResponse } from "@/lib/admin-types";

export const metadata = { title: "User profile" };
export default async function UserPage({params}:{params:{id:string}}){
 const {t:translateUi,locale:uiLocale}=getI18n();

  const r=await serverApi().get<AdminUsersResponse>("/admin/users");
  const merchantUser=r.merchant_users.find(u=>u.id===params.id), u=merchantUser||r.admins.find(u=>u.id===params.id);
  if(!u)notFound();
  return <><PageHeader breadcrumb={<Link href="/admin/users">{translateUi("← Users")}</Link>} title={translateUi(<span className="flex items-center gap-3">{u.name}<StatusBadge status={u.status}/></span>)} subtitle={translateUi(u.email)}/><Card title={translateUi("Account profile")}><DescriptionList cols={3} items={[{label:"User ID",value:u.id},{label:"Role",value:u.role},{label:"Account type",value:merchantUser?"Merchant user":"NATIO administrator"},{label:"Created",value:formatDateTime(u.created_at)},{label:"Last login",value:formatDateTime(u.last_login_at)},{label:"Merchant",value:merchantUser?<EntityLink kind="merchants" id={merchantUser.merchant_id}>{translateUi(merchantUser.merchant_name)}</EntityLink>:"Platform"}]}/></Card>{translateUi(merchantUser&&<Card className="mt-5" title={translateUi("Merchant activity")}><div className="flex flex-wrap gap-5 text-brand-600">{translateUi([{path:"merchants/"+merchantUser.merchant_id,label:"Merchant profile"},{path:"transactions?merchant_id="+merchantUser.merchant_id,label:"Transactions"},{path:"bi?merchant_id="+merchantUser.merchant_id,label:"BI & reports"},{path:"payments?merchant_id="+merchantUser.merchant_id,label:"Payments"}].map(l=><Link key={l.path} href={`/admin/${l.path}`}>{translateUi(l.label)} →</Link>))}</div></Card>)}</>;
}
