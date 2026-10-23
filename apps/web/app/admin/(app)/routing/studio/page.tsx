
import {getI18n} from '@/lib/i18n/server';
import { RoutingStudio } from "@/components/admin/routing-studio";
import { PageHeader, LinkButton } from "@/components/ui";
import { serverApi } from "@/lib/session";
export const metadata = { title: "Routing studio" };
export default async function RoutingStudioPage() {
 const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const merchants = await api.get<{ data: { id: string; name: string }[] }>(
    "/admin/merchants?fields=options&limit=500",
  );
  return (
    <>
      <PageHeader
        title={translateUi("Routing studio")}
        subtitle={translateUi("Currency-aware routing, bounded cascading and transparent payment economics.")}
        actions={<LinkButton href="/admin/routing">{translateUi("Manage rules")}</LinkButton>}
      />
      <RoutingStudio merchants={merchants.data} />
    </>
  );
}
