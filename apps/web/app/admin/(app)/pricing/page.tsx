import { PricingCenter } from "@/components/admin/pricing-center";
import { PageHeader } from "@/components/ui";
import { serverApi } from "@/lib/session";
import type { PricePlan } from "@/components/admin/strategy-types";
export const metadata = { title: "Pricing & margin" };
export default async function PricingPage() {
  const api = serverApi();
  const [plans, merchants, providers] = await Promise.all([
    api.get<{ data: PricePlan[] }>("/admin/pricing"),
    api.get<{ data: { id: string; name: string }[] }>(
      "/admin/merchants?fields=options&limit=500",
    ),
    api.get<{
      data: {
        id: string;
        name: string;
        accounts: { id: string; name: string; currencies: string[] }[];
      }[];
    }>("/admin/providers?limit=30"),
  ]);
  return (
    <>
      <PageHeader
        title="Pricing & margin"
        subtitle="Amount-based merchant fees and PSP costs. Exact minor units, immutable published versions and an auditable margin."
      />
      <PricingCenter
        initial={plans.data}
        merchants={merchants.data}
        accounts={providers.data.flatMap((p) =>
          p.accounts.map((a) => ({
            ...a,
            providerId: p.id,
            label: `${p.name} · ${a.name}`,
          })),
        )}
      />
    </>
  );
}
