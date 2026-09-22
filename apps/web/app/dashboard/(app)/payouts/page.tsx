import Link from "next/link";
import { CreatePayout } from "@/components/dashboard/create-payout";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, Pagination, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatMoney, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Paginated, Payout } from "@/lib/types";

export const metadata = { title: "Payouts" };

const STATUSES = ["created", "pending", "processing", "successful", "failed", "cancelled"];

export default async function PayoutsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({
    status: searchParams.status,
    currency: searchParams.currency,
    search: searchParams.search,
    from: searchParams.from ? new Date(searchParams.from).toISOString() : undefined,
    to: searchParams.to ? new Date(searchParams.to).toISOString() : undefined,
    cursor: searchParams.cursor,
    limit: 50,
  });
  const page = await api.get<Paginated<Payout>>(`/dashboard/payouts${query}`);

  return (
    <>
      <PageHeader title="Payouts" subtitle="Transfers to bank accounts, wallets and card tokens, executed by the provider selected by routing." actions={<CreatePayout />} />
      <FilterBar
        filters={[
          { name: "search", label: "Search", type: "text", placeholder: "po_…, reference, provider id" },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "currency", label: "Currency", type: "text", placeholder: "EUR" },
          { name: "from", label: "From", type: "date" },
          { name: "to", label: "To", type: "date" },
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
                <th>Destination</th>
                <th>Provider</th>
                <th className="num">Fee</th>
                <th>Created</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/dashboard/payouts/${p.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{shortId(p.id, 10)}</Mono>
                    </Link>
                    {p.reference ? <div className="text-[11px] text-ink-500">{p.reference}</div> : null}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="num font-medium">{formatMoney(p.amount, p.currency)}</td>
                  <td>
                    {p.destination.display}
                    <div className="text-[11px] text-ink-500">
                      {titleCase(p.destination.type)}
                      {p.destination.country ? ` · ${p.destination.country}` : ""}
                    </div>
                  </td>
                  <td>
                    {p.route.provider_name ?? <span className="text-ink-400">—</span>}
                    {p.route.provider_account_name ? <div className="text-[11px] text-ink-500">{p.route.provider_account_name}</div> : null}
                  </td>
                  <td className="num">{formatMoney(p.fee.amount, p.fee.currency)}</td>
                  <td className="text-ink-500">{formatDateTime(p.created_at)}</td>
                  <td>{p.failure ? <Mono className="text-bad">{p.failure.code}</Mono> : <span className="text-ink-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No payouts" description="Payouts created through the API or this dashboard will appear here." />
        )}
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/dashboard/payouts" params={searchParams} />
      </Card>
    </>
  );
}
