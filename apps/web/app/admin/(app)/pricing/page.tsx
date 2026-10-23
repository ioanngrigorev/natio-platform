
import {getI18n} from '@/lib/i18n/server';
import { PricingCenter } from "@/components/admin/pricing-center";
import { PageHeader } from "@/components/ui";
import { serverApi } from "@/lib/session";
import type { PricePlan } from "@/components/admin/strategy-types";
export const metadata = { title: "Pricing & margin" };
export default async function PricingPage() {
 const {t:translateUi,locale:uiLocale}=getI18n();

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
        supported_methods: string[];
        supported_countries: string[];
        accounts: { id: string; name: string; currencies: string[]; merchant_id: string | null }[];
      }[];
    }>("/admin/providers?limit=30"),
  ]);
  return (
    <>
      <PageHeader
        title={translateUi("Pricing & margin")}
        subtitle={translateUi("Amount-based merchant fees and PSP costs. Exact minor units, immutable published versions and an auditable margin.")}
      />
      <PricingCenter
        initial={plans.data}
        merchants={merchants.data}
        accounts={providers.data.flatMap((p) =>
          p.accounts.map((a) => ({
            ...a,
            providerId: p.id,
            methods: p.supported_methods,
            countries: p.supported_countries,
            label: `${p.name} · ${a.name}`,
          })),
        )}
      />
    </>
  );
}
