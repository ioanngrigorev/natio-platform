import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, Pagination, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatMoney, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Paginated, Payout } from "@/lib/types";

export const metadata = { title: "Payouts" };

const STATUSES = ["created", "pending", "processing", "successful", "failed", "cancelled"];

export default async function AdminPayoutsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({ merchant_id: searchParams.merchant_id, status: searchParams.status, currency: searchParams.currency, search: searchParams.search, cursor: searchParams.cursor, limit: 50 });
  const [page, merchants] = await Promise.all([api.get<Paginated<Payout>>(`/admin/payouts${query}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?limit=500")]);

  return (
    <>
      <PageHeader title="Payouts" subtitle={`Merchant-initiated payouts routed to providers with payout capability (${api.mode} mode). Executed and settled by the provider.`} />
      <FilterBar
        filters={[
          { name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) },
          { name: "search", label: "Search", type: "text", placeholder: "po_…, reference" },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "currency", label: "Currency", type: "text", placeholder: "EUR" },
        ]}
      />
      <Card padded={false}>
        {page.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Payout</th>
                <th>Status</th>
                <th className="num">Amount</th>
                <th className="num">Fee</th>
                <th>Destination</th>
                <th>Provider</th>
                <th>Error</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/payouts/${p.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{shortId(p.id, 10)}</Mono>
                    </Link>
                    {p.reference ? <div className="text-[11px] text-ink-500">{p.reference}</div> : null}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="num font-medium">{formatMoney(p.amount, p.currency)}</td>
                  <td className="num text-ink-500">{formatMoney(p.fee.amount, p.currency)}</td>
                  <td>
                    {p.destination.display}
                    <div className="text-[11px] text-ink-500">
                      {titleCase(p.destination.type)}
                      {p.destination.holder_name ? ` · ${p.destination.holder_name}` : ""}
                      {p.destination.country ? ` · ${p.destination.country}` : ""}
                    </div>
                  </td>
                  <td>
                    {p.route.provider_name ?? <span className="text-ink-400">—</span>}
                    {p.route.provider_account_name ? <div className="text-[11px] text-ink-500">{p.route.provider_account_name}</div> : null}
                  </td>
                  <td>{p.failure ? <Mono className="text-bad">{p.failure.code}</Mono> : <span className="text-ink-400">—</span>}</td>
                  <td className="text-ink-500">{formatDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No payouts" description="Payouts created through the API appear here." />
        )}
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/admin/payouts" params={searchParams} />
      </Card>
    </>
  );
}
