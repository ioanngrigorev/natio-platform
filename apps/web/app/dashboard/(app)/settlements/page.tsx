import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { Alert, Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, formatNumber, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Balance, Settlement } from "@/lib/types";

export const metadata = { title: "Settlements" };

const CUSTODIAN_NOTE = "Funds are held and settled by licensed providers; NATIO reports provider settlement data and does not hold merchant funds.";
const STATUSES = ["pending", "settled", "failed"];

function BalanceRow({ label, value, currency, muted, strong }: { label: string; value: number; currency: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={"text-[12px] " + (muted ? "text-ink-400" : "text-ink-500")}>{label}</span>
      <span className={"tabular text-[13px] " + (strong ? "font-semibold text-ink-900" : muted ? "text-ink-500" : "text-ink-800")}>{formatMoney(value, currency)}</span>
    </div>
  );
}

export default async function SettlementsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({ status: searchParams.status, provider_account_id: searchParams.provider_account_id, limit: 100 });
  const [balances, settlements] = await Promise.all([api.get<{ custodian: boolean; data: Balance[] }>("/dashboard/balances"), api.get<{ data: Settlement[] }>(`/dashboard/settlements${query}`)]);

  return (
    <>
      <PageHeader title="Settlements" subtitle="Provider-reported settlement of processed volume, per currency and provider account." />

      <div className="mb-4">
        <Alert tone="info">{CUSTODIAN_NOTE}</Alert>
      </div>

      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-ink-900">Balances</h2>
          <span className="text-[12px] text-ink-500">Derived from processed transactions and provider settlement reports · {api.mode === "test" ? "sandbox" : "live"} data</span>
        </div>
        {balances.data.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {balances.data.map((b) => (
              <div key={b.currency} className="rounded-lg bg-white px-4 py-3 shadow-card">
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{b.currency}</div>
                  <div className="text-[11px] text-ink-400">processed net</div>
                </div>
                <div className="mt-1 text-[22px] font-semibold tabular tracking-tight text-ink-900">{formatMoney(b.processed_net, b.currency)}</div>
                <div className="mt-2 divide-y divide-ink-100">
                  <BalanceRow label="Processed gross" value={b.processed_gross} currency={b.currency} />
                  <BalanceRow label="Provider fees" value={-b.fees} currency={b.currency} muted />
                  <BalanceRow label="Processed net" value={b.processed_net} currency={b.currency} strong />
                  <BalanceRow label="Settled by providers" value={b.settled_by_providers} currency={b.currency} />
                  <BalanceRow label="Awaiting provider settlement" value={b.awaiting_provider_settlement} currency={b.currency} />
                  <BalanceRow label="Payouts sent" value={b.payouts_sent} currency={b.currency} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState title="No processed volume yet" description="Balances appear once successful payments, refunds or payouts are recorded in this mode." />
          </Card>
        )}
        <p className="mt-2 text-[12px] text-ink-500">{balances.data[0]?.note ?? CUSTODIAN_NOTE}</p>
      </section>

      <Card title="How to read this page" className="mb-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="font-medium text-ink-900">Payment</dt>
            <dd className="text-ink-600">A customer transaction NATIO routed and recorded. It creates ledger entries (transactions) with the provider fee.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Provider</dt>
            <dd className="text-ink-600">The licensed acquirer, bank or payment provider that processed the payment and holds the funds.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Settlement</dt>
            <dd className="text-ink-600">A provider&apos;s report that a set of transactions was paid out to you for a period, netted of the provider&apos;s fees.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Merchant</dt>
            <dd className="text-ink-600">You. Settled funds arrive on your account at the provider&apos;s settlement entity; NATIO never holds them.</dd>
          </div>
        </dl>
      </Card>

      <FilterBar filters={[{ name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) }, { name: "provider_account_id", label: "Provider account", type: "text", placeholder: "pa_…" }]} />

      <Card title="Provider settlements" description="Each row is one settlement report from a provider account for one currency and period" padded={false}>
        {settlements.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Settlement</th>
                <th>Provider</th>
                <th>Settlement entity</th>
                <th>Reference</th>
                <th>Period</th>
                <th className="num">Gross</th>
                <th className="num">Fees</th>
                <th className="num">Net</th>
                <th className="num">Transactions</th>
                <th>Status</th>
                <th>Settled at</th>
              </tr>
            </thead>
            <tbody>
              {settlements.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/dashboard/settlements/${s.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{shortId(s.id, 10)}</Mono>
                    </Link>
                    <div className="text-[11px] text-ink-500">{titleCase(s.source)}</div>
                  </td>
                  <td>
                    {s.provider_name ?? "—"}
                    {s.provider_account_name ? <div className="text-[11px] text-ink-500">{s.provider_account_name}</div> : null}
                  </td>
                  <td className="max-w-[220px] truncate text-ink-600">{s.settlement_entity ?? "—"}</td>
                  <td>{s.settlement_reference ? <Mono>{s.settlement_reference}</Mono> : "—"}</td>
                  <td className="text-ink-600">
                    {formatDate(s.period_start)} – {formatDate(s.period_end)}
                  </td>
                  <td className="num">{formatMoney(s.gross_amount, s.currency)}</td>
                  <td className="num text-ink-500">{formatMoney(-s.fee_amount, s.currency)}</td>
                  <td className="num font-medium">{formatMoney(s.net_amount, s.currency)}</td>
                  <td className="num">{formatNumber(s.transaction_count)}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="text-ink-500">{formatDateTime(s.settled_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No settlements reported yet" description="Settlements appear when a provider reports that a period of transactions has been paid out. Until then, processed net volume shows as awaiting provider settlement." />
        )}
      </Card>
    </>
  );
}
