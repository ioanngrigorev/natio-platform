
import {getI18n} from '@/lib/i18n/server';
import { EntityLink } from "@/components/admin/entity-link";
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

export default async function AdminPayoutsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const query = qs({ merchant_id: searchParams.merchant_id, status: searchParams.status, currency: searchParams.currency, search: searchParams.search, cursor: searchParams.cursor, limit: 50 });
  const [page, merchants] = await Promise.all([api.get<Paginated<Payout>>(`/admin/payouts${query}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500")]);

  return (
    <>
      <PageHeader title={translateUi("Payouts")} subtitle={translateUi(`Merchant-initiated payouts routed to providers with payout capability (${api.mode} mode). Executed and settled by the provider.`)} />
      <FilterBar
        filters={[
          { name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) },
          { name: "search", label: "Search", type: "text", placeholder: "po_…, reference" },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "currency", label: "Currency", type: "text", placeholder: "EUR" },
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
                <th className="num">{translateUi("Fee")}</th>
                <th>{translateUi("Destination")}</th>
                <th>{translateUi("Provider")}</th>
                <th>{translateUi("Error")}</th>
                <th>{translateUi("Created")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(page.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/payouts/${p.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{translateUi(shortId(p.id, 10))}</Mono>
                    </Link>
                    {translateUi(p.reference ? <div className="text-[11px] text-ink-500">{p.reference}</div> : null)}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="num font-medium">{translateUi(formatMoney(p.amount, p.currency))}</td>
                  <td className="num text-ink-500">{translateUi(formatMoney(p.fee.amount, p.currency))}</td>
                  <td>
                    {translateUi(p.destination.display)}
                    <div className="text-[11px] text-ink-500">
                      {translateUi(titleCase(p.destination.type))}
                      {translateUi(p.destination.holder_name ? ` · ${p.destination.holder_name}` : "")}
                      {translateUi(p.destination.country ? ` · ${p.destination.country}` : "")}
                    </div>
                  </td>
                  <td>
                    <EntityLink kind="provider-accounts" id={p.route.provider_account_id}>{translateUi(p.route.provider_name)}</EntityLink>
                    {translateUi(p.route.provider_account_name ? <div className="text-[11px] text-ink-500"><EntityLink kind="provider-accounts" id={p.route.provider_account_id}>{translateUi(p.route.provider_account_name)}</EntityLink></div> : null)}
                  </td>
                  <td>{translateUi(p.failure ? <Mono className="text-bad">{translateUi(p.failure.code)}</Mono> : <span className="text-ink-400">—</span>)}</td>
                  <td className="text-ink-500">{translateUi(formatDateTime(p.created_at))}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No payouts")} description={translateUi("Payouts created through the API appear here.")} />
        ))}
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/admin/payouts" params={searchParams} />
      </Card>
    </>
  );
}
