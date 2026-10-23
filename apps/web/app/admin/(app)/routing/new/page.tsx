
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { RoutingRuleForm } from "@/components/admin/routing-rule-form";
import { PageHeader } from "@/components/ui";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Provider } from "@/lib/types";

export const metadata = { title: "New routing rule" };

export default async function NewRoutingRulePage() {
 const {t:translateUi,locale:uiLocale}=getI18n();

  const api = serverApi();
  const [providers, merchants] = await Promise.all([api.get<{ data: Provider[] }>("/admin/providers"), api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500")]);
  const accounts = providers.data.flatMap((p) => p.accounts);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/admin/routing" className="hover:underline">{translateUi("Routing rules")}</Link>
        }
        title={translateUi("New routing rule")}
        subtitle={translateUi("Define when the rule applies and which provider accounts it routes to.")}
      />
      <RoutingRuleForm accounts={accounts} merchants={merchants.data.map((m) => ({ id: m.id, name: m.name }))} />
    </>
  );
}
