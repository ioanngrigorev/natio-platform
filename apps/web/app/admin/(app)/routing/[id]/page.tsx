
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { notFound } from "next/navigation";
import { RoutingRuleForm } from "@/components/admin/routing-rule-form";
import { Mono, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Provider, RoutingRule } from "@/lib/types";

/** There is no single-rule GET endpoint: the list is filtered server-side by id. */
export default async function EditRoutingRulePage({ params }: { params: { id: string } }) {
 const {t:translateUi,locale:uiLocale}=getI18n();

  const api = serverApi();
  const [rules, providers, merchants] = await Promise.all([api.get<{ data: RoutingRule[] }>("/admin/routing/rules"), api.get<{ data: Provider[] }>("/admin/providers"), api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500")]);
  const rule = rules.data.find((r) => r.id === params.id);
  if (!rule) notFound();
  const accounts = providers.data.flatMap((p) => p.accounts);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/admin/routing" className="hover:underline">{translateUi("Routing rules")}</Link>
        }
        title={
          translateUi(<span className="flex items-center gap-3">
            {rule.name}
            <StatusBadge status={rule.mode} label={translateUi(rule.mode === "test" ? translateUi("Test") : translateUi("Live"))} />
            <StatusBadge status={rule.enabled ? "active" : "disabled"} label={translateUi(rule.enabled ? translateUi("Enabled") : translateUi("Disabled"))} />
          </span>)
        }
        subtitle={
          translateUi(<span>
            <Mono>{rule.id}</Mono>{translateUi(" · created ")}{translateUi(formatDateTime(rule.createdAt))}{translateUi(" · priority ")}{translateUi(rule.priority)}
          </span>)
        }
      />
      <RoutingRuleForm rule={rule} accounts={accounts} merchants={merchants.data.map((m) => ({ id: m.id, name: m.name }))} />
    </>
  );
}
