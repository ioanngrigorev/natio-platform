
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatMoney, formatNumber, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";

export const metadata = { title: "Merchants" };

export default async function MerchantsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

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
      <Card padded={false}>
        {translateUi(data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Merchant")}</th>
                <th>{translateUi("Country")}</th>
                <th>{translateUi("KYB verification")}</th>
                <th>{translateUi("Account access")}</th><th>{translateUi("Live processing")}</th>
                <th className="num">{translateUi("Users")}</th>
                <th className="num">{translateUi("Transactions")}</th>
                <th className="num">{translateUi("Pay-in volume")}</th>
                <th className="num">{translateUi("Unsettled balance")}</th><th>{translateUi("Created")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/admin/merchants/${m.id}`} className="font-medium text-brand-600 hover:underline">
                      {m.name}
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      <Mono className="text-[11px]">{translateUi(shortId(m.id, 12))}</Mono>
                      {translateUi(m.contact_email ? ` · ${m.contact_email}` : "")}
                    </div>
                  </td>
                  <td>{translateUi(m.country ?? "—")}</td>
                  <td>
                    <StatusBadge status={m.kyb_status} />
                  </td>
                  <td>
                    <StatusBadge status={m.status} label={translateUi(m.status === "active" ? translateUi("Enabled") : translateUi("Disabled"))} />
                  </td>
                  <td><StatusBadge status={m.status === "active" && m.kyb_status === "approved" ? "ready" : "pending"} label={translateUi(m.status === "active" && m.kyb_status === "approved" ? translateUi("Eligible") : translateUi("Blocked"))} /><div className="text-[11px] text-ink-500">{translateUi(m.status !== "active" ? translateUi("Account disabled") : m.kyb_status !== "approved" ? translateUi("KYB approval required") : translateUi("Subject to provider setup"))}</div></td>
                  <td className="num">{translateUi(formatNumber(m.users))}</td>
                  <td className="num">{translateUi(formatNumber(m.transactions))}</td>
                  <td className="num">{translateUi(formatMoney(m.volume,m.currency))}</td>
                  <td className="num">{translateUi(formatMoney(m.balance,m.currency))}</td>
                  <td className="text-ink-500">{translateUi(formatDateTime(m.created_at))}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No merchants match")} description={translateUi("Adjust the filters or wait for new registrations.")} />
        ))}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">{translateUi("Volumes and unsettled balances are shown in each merchant’s default currency. Open BI for all currencies.")}</p>
    </>
  );
}
