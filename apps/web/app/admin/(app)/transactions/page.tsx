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

export default async function AdminTransactionsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({ merchant_id: searchParams.merchant_id, type: searchParams.type, status: searchParams.status, currency: searchParams.currency, search: searchParams.search, from: searchParams.from ? new Date(searchParams.from).toISOString() : undefined, to: searchParams.to ? new Date(searchParams.to).toISOString() : undefined, cursor: searchParams.cursor, limit: 50 });
  const [page, merchants] = await Promise.all([api.get<Paginated<Transaction>>(`/admin/transactions${query}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?limit=500")]);

  return (
    <>
      <PageHeader title="Transactions" subtitle={`Ledger of processed payments, refunds and payouts across merchants in ${api.mode} mode. Funds are held and settled by licensed providers.`} />
      <FilterBar
        filters={[
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
        {page.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Type</th>
                <th>Status</th>
                <th className="num">Amount</th>
                <th className="num">Fee</th>
                <th className="num">Net</th>
                <th>Provider</th>
                <th>Method</th>
                <th>Country</th>
                <th className="num">Time</th>
                <th>Settlement</th>
                <th>Occurred</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Mono>{shortId(t.id, 10)}</Mono>
                    <div className="text-[11px] text-ink-500">
                      {t.payment_id ? (
                        <Link href={`/admin/payments/${t.payment_id}`} className="text-brand-600 hover:underline">
                          {shortId(t.payment_id, 10)}
                        </Link>
                      ) : t.entity_type === "payout" ? (
                        <Link href={`/admin/payouts/${t.entity_id}`} className="text-brand-600 hover:underline">
                          {shortId(t.entity_id, 10)}
                        </Link>
                      ) : (
                        shortId(t.entity_id, 10)
                      )}
                    </div>
                  </td>
                  <td>{titleCase(t.type)}</td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="num font-medium">{formatMoney(t.amount, t.currency, { sign: true })}</td>
                  <td className="num text-ink-500">{formatMoney(t.fee_amount, t.currency)}</td>
                  <td className="num">{formatMoney(t.net_amount, t.currency, { sign: true })}</td>
                  <td>
                    {t.provider_name ?? <span className="text-ink-400">—</span>}
                    {t.provider_account_name ? <div className="text-[11px] text-ink-500">{t.provider_account_name}</div> : null}
                  </td>
                  <td>{t.payment_method ? titleCase(t.payment_method) : "—"}</td>
                  <td>{t.country ?? "—"}</td>
                  <td className="num">{formatMs(t.processing_time_ms)}</td>
                  <td>
                    {t.settlement_id ? (
                      <Link href={`/admin/settlements/${t.settlement_id}`} className="text-brand-600 hover:underline">
                        <Mono>{shortId(t.settlement_id, 8)}</Mono>
                      </Link>
                    ) : (
                      <span className="text-ink-400">unsettled</span>
                    )}
                  </td>
                  <td className="text-ink-500">{formatDateTime(t.occurred_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No transactions" description="Processed payments, refunds and payouts appear here." />
        )}
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/admin/transactions" params={searchParams} />
      </Card>
    </>
  );
}
