
import {getI18n} from '@/lib/i18n/server';
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

export default async function PayoutsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
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
      <PageHeader title={translateUi("Payouts")} subtitle={translateUi("Transfers to bank accounts, wallets and card tokens, executed by the provider selected by routing.")} actions={<CreatePayout />} />
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
        {translateUi(page.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Payout")}</th>
                <th>{translateUi("Status")}</th>
                <th className="num">{translateUi("Amount")}</th>
                <th>{translateUi("Destination")}</th>
                <th>{translateUi("Provider")}</th>
                <th className="num">{translateUi("Fee")}</th>
                <th>{translateUi("Created")}</th>
                <th>{translateUi("Error")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(page.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/dashboard/payouts/${p.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{translateUi(shortId(p.id, 10))}</Mono>
                    </Link>
                    {translateUi(p.reference ? <div className="text-[11px] text-ink-500">{p.reference}</div> : null)}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="num font-medium">{translateUi(formatMoney(p.amount, p.currency))}</td>
                  <td>
                    {translateUi(p.destination.display)}
                    <div className="text-[11px] text-ink-500">
                      {translateUi(titleCase(p.destination.type))}
                      {translateUi(p.destination.country ? ` · ${p.destination.country}` : "")}
                    </div>
                  </td>
                  <td>
                    {translateUi(p.route.provider_name ?? <span className="text-ink-400">—</span>)}
                    {translateUi(p.route.provider_account_name ? <div className="text-[11px] text-ink-500">{translateUi(p.route.provider_account_name)}</div> : null)}
                  </td>
                  <td className="num">{translateUi(formatMoney(p.fee.amount, p.fee.currency))}</td>
                  <td className="text-ink-500">{translateUi(formatDateTime(p.created_at))}</td>
                  <td>{translateUi(p.failure ? <Mono className="text-bad">{translateUi(p.failure.code)}</Mono> : <span className="text-ink-400">—</span>)}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No payouts")} description={translateUi("Payouts created through the API or this dashboard will appear here.")} />
        ))}
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/dashboard/payouts" params={searchParams} />
      </Card>
    </>
  );
}
