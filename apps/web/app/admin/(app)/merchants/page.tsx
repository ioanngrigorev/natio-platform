import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatMoney, formatNumber, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";

export const metadata = { title: "Merchants" };

export default async function MerchantsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const { data } = await api.get<{ data: AdminMerchant[] }>(`/admin/merchants${qs({ search: searchParams.search, status: searchParams.status, kyb: searchParams.kyb, limit: 200 })}`);

  return (
    <>
      <PageHeader title="Merchants" subtitle="Account access and business verification are separate. Live processing requires an enabled account and approved KYB." />
      <FilterBar
        filters={[
          { name: "search", label: "Search", type: "text", placeholder: "name, mer_…, contact email" },
          { name: "status", label: "Account access", type: "select", options: [{ value: "active", label: "Enabled" }, { value: "disabled", label: "Disabled" }] },
          { name: "kyb", label: "KYB", type: "select", options: ["not_started", "pending", "approved", "rejected"].map((s) => ({ value: s, label: s.replace(/_/g, " ") })) },
        ]}
      />
      <Card padded={false}>
        {data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Country</th>
                <th>KYB verification</th>
                <th>Account access</th><th>Live processing</th>
                <th className="num">Users</th>
                <th className="num">Transactions</th>
                <th className="num">Pay-in volume</th>
                <th className="num">Unsettled balance</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/admin/merchants/${m.id}`} className="font-medium text-brand-600 hover:underline">
                      {m.name}
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      <Mono className="text-[11px]">{shortId(m.id, 12)}</Mono>
                      {m.contact_email ? ` · ${m.contact_email}` : ""}
                    </div>
                  </td>
                  <td>{m.country ?? "—"}</td>
                  <td>
                    <StatusBadge status={m.kyb_status} />
                  </td>
                  <td>
                    <StatusBadge status={m.status} label={m.status === "active" ? "Enabled" : "Disabled"} />
                  </td>
                  <td><StatusBadge status={m.status === "active" && m.kyb_status === "approved" ? "ready" : "pending"} label={m.status === "active" && m.kyb_status === "approved" ? "Eligible" : "Blocked"} /><div className="text-[11px] text-ink-500">{m.status !== "active" ? "Account disabled" : m.kyb_status !== "approved" ? "KYB approval required" : "Subject to provider setup"}</div></td>
                  <td className="num">{formatNumber(m.users)}</td>
                  <td className="num">{formatNumber(m.transactions)}</td>
                  <td className="num">{formatMoney(m.volume,m.currency)}</td>
                  <td className="num">{formatMoney(m.balance,m.currency)}</td>
                  <td className="text-ink-500">{formatDateTime(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No merchants match" description="Adjust the filters or wait for new registrations." />
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">Volumes and unsettled balances are shown in each merchant’s default currency. Open BI for all currencies.</p>
    </>
  );
}
