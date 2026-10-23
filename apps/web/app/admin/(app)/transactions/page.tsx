
import {getI18n} from '@/lib/i18n/server';
import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, Pagination, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatMoney, formatMs, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Paginated, Transaction } from "@/lib/types";

export const metadata = { title: "Transactions" };

const TYPES = ["payment", "refund", "payout", "fee", "adjustment"];
const STATUSES = ["successful", "failed", "pending", "cancelled"];

export default async function AdminTransactionsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const query = qs({ provider_account_id: searchParams.provider_account_id, project_id: searchParams.project_id, merchant_id: searchParams.merchant_id, type: searchParams.type, status: searchParams.status, currency: searchParams.currency, search: searchParams.search, from: searchParams.from ? new Date(searchParams.from).toISOString() : undefined, to: searchParams.to ? new Date(searchParams.to).toISOString() : undefined, cursor: searchParams.cursor, limit: 50 });
  const [page, merchants] = await Promise.all([api.get<Paginated<Transaction>>(`/admin/transactions${query}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500")]);

  return (
    <>
      <PageHeader title={translateUi("Transactions")} subtitle={translateUi(`Ledger of processed payments, refunds and payouts across merchants in ${api.mode} mode. Funds are held and settled by licensed providers.`)} />
      <FilterBar
        filters={[
          { name: "provider_account_id", label: "Provider account", type: "text", placeholder: "Account ID" },
          { name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) },
          { name: "search", label: "Search", type: "text", placeholder: "txn_…, pay_…, provider ref" },
          { name: "type", label: "Type", type: "select", options: TYPES.map((t) => ({ value: t, label: t })) },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "currency", label: "Currency", type: "text", placeholder: "USD" },
          { name: "from", label: "From", type: "date" },
          { name: "to", label: "To", type: "date" },
        ]}
      />
      <Card padded={false}>
        {translateUi(page.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Transaction / External ID")}</th>
                <th>{translateUi("Merchant / Channel")}</th>
                <th>{translateUi("Type")}</th>
                <th>{translateUi("Status")}</th>
                <th className="num">{translateUi("Amount")}</th>
                <th className="num">{translateUi("Received")}</th>
                <th className="num">{translateUi("Fee")}</th>
                <th className="num">{translateUi("Net")}</th>
                <th>{translateUi("Provider")}</th>
                <th>{translateUi("Method")}</th>
                <th>{translateUi("Country")}</th>
                <th className="num">{translateUi("Time")}</th>
                <th>{translateUi("Settlement")}</th>
                <th>{translateUi("Occurred")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(page.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link className="text-brand-600 hover:underline" href={t.payment_id ? `/admin/payments/${t.payment_id}` : t.entity_type === "payout" ? `/admin/payouts/${t.entity_id}` : `/admin/transactions?search=${t.id}`}><Mono>{t.id}</Mono></Link><div className="text-[11px] text-ink-500">{translateUi(t.external_reference)}</div>
                    <div className="text-[11px] text-ink-500">
                      {translateUi(t.payment_id ? (
                        <Link href={`/admin/payments/${t.payment_id}`} className="text-brand-600 hover:underline">
                          {translateUi(shortId(t.payment_id, 10))}
                        </Link>
                      ) : t.entity_type === "payout" ? (
                        <Link href={`/admin/payouts/${t.entity_id}`} className="text-brand-600 hover:underline">
                          {translateUi(shortId(t.entity_id, 10))}
                        </Link>
                      ) : (
                        shortId(t.entity_id, 10)
                      ))}
                    </div>
                  </td>
                  <td><EntityLink kind="merchants" id={t.merchant_id}>{translateUi(t.merchant_name)}</EntityLink><div className="text-xs text-ink-500">{translateUi(t.channel)}</div></td>
                  <td>{translateUi(titleCase(t.type))}</td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="num font-medium">{translateUi(formatMoney(t.amount, t.currency, { sign: true }))}</td>
                  <td className="num">{translateUi(formatMoney(t.received_amount,t.currency))}</td>
                  <td className="num text-ink-500">{translateUi(formatMoney(t.fee_amount, t.currency))}</td>
                  <td className="num">{translateUi(formatMoney(t.net_amount, t.currency, { sign: true }))}</td>
                  <td>
                    <EntityLink kind="providers" id={t.provider_id}>{translateUi(t.provider_name)}</EntityLink><div className="text-[11px] text-ink-400">{translateUi(t.provider_reference)}</div>
                    {translateUi(t.provider_account_name ? <div className="text-[11px] text-ink-500"><EntityLink kind="provider-accounts" id={t.provider_account_id}>{translateUi(t.provider_account_name)}</EntityLink></div> : null)}
                  </td>
                  <td>{translateUi(t.payment_method ? titleCase(t.payment_method) : "—")}</td>
                  <td>{translateUi(t.country ?? "—")}</td>
                  <td className="num">{translateUi(formatMs(t.processing_time_ms))}</td>
                  <td>
                    {translateUi(t.settlement_id ? (
                      <Link href={`/admin/settlements/${t.settlement_id}`} className="text-brand-600 hover:underline">
                        <Mono>{translateUi(shortId(t.settlement_id, 8))}</Mono>
                      </Link>
                    ) : (
                      <span className="text-ink-400">{translateUi("unsettled")}</span>
                    ))}
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(t.occurred_at))}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No transactions")} description={translateUi("Processed payments, refunds and payouts appear here.")} />
        ))}
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/admin/transactions" params={searchParams} />
      </Card>
    </>
  );
}
