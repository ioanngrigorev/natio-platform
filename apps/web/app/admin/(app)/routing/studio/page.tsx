import { RoutingStudio } from "@/components/admin/routing-studio";
import { PageHeader, LinkButton } from "@/components/ui";
import { serverApi } from "@/lib/session";
export const metadata = { title: "Routing studio" };
export default async function RoutingStudioPage() {
  const api = serverApi();
  const merchants = await api.get<{ data: { id: string; name: string }[] }>(
    "/admin/merchants?fields=options&limit=500",
  );
  return (
    <>
      <PageHeader
        title="Routing studio"
        subtitle="Currency-aware routing, bounded cascading and transparent payment economics."
        actions={<LinkButton href="/admin/routing">Manage rules</LinkButton>}
      />
      <RoutingStudio merchants={merchants.data} />
    </>
  );
}
