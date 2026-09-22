import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatNumber, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";

export const metadata = { title: "Merchants" };

export default async function MerchantsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const { data } = await api.get<{ data: AdminMerchant[] }>(`/admin/merchants${qs({ search: searchParams.search, status: searchParams.status, kyb: searchParams.kyb, limit: 200 })}`);

  return (
    <>
      <PageHeader title="Merchants" subtitle="Every merchant onboarded on NATIO, with verification and activity status." />
      <FilterBar
        filters={[
          { name: "search", label: "Search", type: "text", placeholder: "name, mer_…, contact email" },
          { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "active" }, { value: "disabled", label: "disabled" }] },
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
                <th>KYB</th>
                <th>Status</th>
                <th className="num">Users</th>
                <th className="num">Payments 30d</th>
                <th className="num">Live volume 30d</th>
                <th>Created</th>
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
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="num">{formatNumber(m.users)}</td>
                  <td className="num">{formatNumber(m.payments_30d)}</td>
                  <td className="num">{m.live_volume_30d ? formatNumber(m.live_volume_30d) : <span className="text-ink-400">—</span>}</td>
                  <td className="text-ink-500">{formatDateTime(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No merchants match" description="Adjust the filters or wait for new registrations." />
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">Live volume is the sum of successful live-mode payment amounts in minor units across all currencies (scale indicator only).</p>
    </>
  );
}
