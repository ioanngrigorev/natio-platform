
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatMoney, formatNumber, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";

export const metadata = { title: "Merchants" };

export default async function MerchantsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi} = await getI18n();

  const api = (await serverApi());
  const { data } = await api.get<{ data: AdminMerchant[] }>(`/admin/merchants${qs({ search: searchParams.search, status: searchParams.status, kyb: searchParams.kyb, limit: 200 })}`);

  return (
    <>
      <PageHeader title={translateUi("Merchants")} subtitle={translateUi("Account access and business verification are separate. Live processing requires an enabled account and approved KYB.")} />
      <FilterBar
        filters={[
          { name: "search", label: "Search", type: "text", placeholder: "name, mer_…, contact email" },
          { name: "status", label: "Account access", type: "select", options: [{ value: "active", label: "Enabled" }, { value: "disabled", label: "Disabled" }] },
          { name: "kyb", label: "KYB", type: "select", options: ["not_started", "pending", "approved", "rejected"].map((s) => ({ value: s, label: s.replace(/_/g, " ") })) },
        ]}
      />
      <Card padded={false} className="merchant-list-card">
        {data.length ? (
          <table className="data-table merchant-list-table" role="table" aria-label={translateUi("Merchants")}>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">{translateUi("Merchant")}</th>
                <th scope="col" role="columnheader">{translateUi("KYB verification")}</th>
                <th scope="col" role="columnheader">{translateUi("Live processing")}</th>
                <th scope="col" role="columnheader" className="num">{translateUi("Transactions")}</th>
                <th scope="col" role="columnheader" className="num">{translateUi("Pay-in volume")}</th>
                <th scope="col" role="columnheader" className="num">{translateUi("Unsettled balance")}</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data.map((m) => (
                <tr key={m.id} role="row">
                  <td role="cell" className="merchant-identity">
                    <Link href={`/admin/merchants/${m.id}`} className="font-medium text-brand-600 hover:underline">
                      {m.name}
                    </Link>
                    <div className="merchant-detail text-ink-500"><Mono>{shortId(m.id, 12)}</Mono></div>
                    {m.contact_email && <div className="merchant-detail text-ink-500">{m.contact_email}</div>}
                    <div className="merchant-detail text-ink-500">{translateUi("Country")}: {m.country ?? "—"}</div>
                    <div className="merchant-detail text-ink-500">{translateUi("Created")}: <time dateTime={m.created_at}>{formatDateTime(m.created_at)}</time></div>
                  </td>
                  <td role="cell">
                    <span className="merchant-mobile-label">{translateUi("KYB verification")}</span>
                    <StatusBadge status={m.kyb_status} />
                    <div className="merchant-detail merchant-secondary-label text-ink-500">{translateUi("Account access")}</div>
                    <StatusBadge status={m.status} label={translateUi(m.status === "active" ? "Enabled" : "Disabled")} />
                  </td>
                  <td role="cell">
                    <span className="merchant-mobile-label">{translateUi("Live processing")}</span>
                    <StatusBadge status={m.status === "active" && m.kyb_status === "approved" ? "ready" : "pending"} label={translateUi(m.status === "active" && m.kyb_status === "approved" ? "Eligible" : "Blocked")} />
                    <div className="merchant-detail text-ink-500">{translateUi(m.status !== "active" ? "Account disabled" : m.kyb_status !== "approved" ? "KYB approval required" : "Subject to provider setup")}</div>
                  </td>
                  <td role="cell" className="num merchant-activity">
                    <span className="merchant-mobile-label">{translateUi("Transactions")}</span>
                    <span>{formatNumber(m.transactions)}</span>
                    <div className="merchant-detail text-ink-500">{translateUi("Users")}: {formatNumber(m.users)}</div>
                  </td>
                  <td role="cell" className="num">
                    <span className="merchant-mobile-label">{translateUi("Pay-in volume")}</span>
                    <span dir="ltr">{formatMoney(m.volume, m.currency)}</span>
                  </td>
                  <td role="cell" className="num">
                    <span className="merchant-mobile-label">{translateUi("Unsettled balance")}</span>
                    <span dir="ltr">{formatMoney(m.balance, m.currency)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title={translateUi("No merchants match")} description={translateUi("Adjust the filters or wait for new registrations.")} />
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">{translateUi("Volumes and unsettled balances are shown in each merchant’s default currency. Open BI for all currencies.")}</p>
    </>
  );
}
