
import {getI18n} from '@/lib/i18n/server';
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
 const {t:translateUi,locale:uiLocale}=getI18n();

  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={"text-[12px] " + (muted ? "text-ink-400" : "text-ink-500")}>{translateUi(label)}</span>
      <span className={"tabular text-[13px] " + (strong ? "font-semibold text-ink-900" : muted ? "text-ink-500" : "text-ink-800")}>{translateUi(formatMoney(value, currency))}</span>
    </div>
  );
}

export default async function SettlementsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
 const {t:translateUi,locale:uiLocale}=getI18n();

  const api = serverApi();
  const query = qs({ status: searchParams.status, provider_account_id: searchParams.provider_account_id, limit: 100 });
  const [balances, settlements] = await Promise.all([api.get<{ custodian: boolean; data: Balance[] }>("/dashboard/balances"), api.get<{ data: Settlement[] }>(`/dashboard/settlements${query}`)]);

  return (
    <>
      <PageHeader title={translateUi("Settlements")} subtitle={translateUi("Provider-reported settlement of processed volume, per currency and provider account.")} />

      <div className="mb-4">
        <Alert tone="info">{translateUi(CUSTODIAN_NOTE)}</Alert>
      </div>

      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-ink-900">{translateUi("Balances")}</h2>
          <span className="text-[12px] text-ink-500">{translateUi("Derived from processed transactions and provider settlement reports · ")}{translateUi(api.mode === "test" ? translateUi("sandbox") : translateUi("live"))}{translateUi(" data")}</span>
        </div>
        {translateUi(balances.data.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {translateUi(balances.data.map((b) => (
              <div key={b.currency} className="rounded-lg bg-white px-4 py-3 shadow-card">
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{translateUi(b.currency)}</div>
                  <div className="text-[11px] text-ink-400">{translateUi("processed net")}</div>
                </div>
                <div className="mt-1 text-[22px] font-semibold tabular tracking-tight text-ink-900">{translateUi(formatMoney(b.processed_net, b.currency))}</div>
                <div className="mt-2 divide-y divide-ink-100">
                  <BalanceRow label={translateUi("Processed gross")} value={b.processed_gross} currency={b.currency} />
                  <BalanceRow label={translateUi("Processing fees")} value={-b.fees} currency={b.currency} muted />
                  <BalanceRow label={translateUi("Processed net")} value={b.processed_net} currency={b.currency} strong />
                  <BalanceRow label={translateUi("Settled by providers")} value={b.settled_by_providers} currency={b.currency} />
                  <BalanceRow label={translateUi("Awaiting provider settlement")} value={b.awaiting_provider_settlement} currency={b.currency} />
                  <BalanceRow label={translateUi("Payouts sent")} value={b.payouts_sent} currency={b.currency} />
                </div>
              </div>
            )))}
          </div>
        ) : (
          <Card>
            <EmptyState title={translateUi("No processed volume yet")} description={translateUi("Balances appear once successful payments, refunds or payouts are recorded in this mode.")} />
          </Card>
        ))}
        <p className="mt-2 text-[12px] text-ink-500">{translateUi(balances.data[0]?.note ?? CUSTODIAN_NOTE)}</p>
      </section>

      <Card title={translateUi("How to read this page")} className="mb-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="font-medium text-ink-900">{translateUi("Payment")}</dt>
            <dd className="text-ink-600">{translateUi("A customer transaction NATIO routed and recorded. It creates ledger entries (transactions) with the provider fee.")}</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">{translateUi("Provider")}</dt>
            <dd className="text-ink-600">{translateUi("The licensed acquirer, bank or payment provider that processed the payment and holds the funds.")}</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">{translateUi("Settlement")}</dt>
            <dd className="text-ink-600">{translateUi("A provider's report that a set of transactions was paid out to you for a period, netted of the provider's fees.")}</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">{translateUi("Merchant")}</dt>
            <dd className="text-ink-600">{translateUi("You. Settled funds arrive on your account at the provider's settlement entity; NATIO never holds them.")}</dd>
          </div>
        </dl>
      </Card>

      <FilterBar filters={[{ name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) }, { name: "provider_account_id", label: "Provider account", type: "text", placeholder: "pa_…" }]} />

      <Card title={translateUi("Provider settlements")} description={translateUi("Each row is one settlement report from a provider account for one currency and period")} padded={false}>
        {translateUi(settlements.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Settlement")}</th>
                <th>{translateUi("Provider")}</th>
                <th>{translateUi("Settlement entity")}</th>
                <th>{translateUi("Reference")}</th>
                <th>{translateUi("Period")}</th>
                <th className="num">{translateUi("Gross")}</th>
                <th className="num">{translateUi("Fees")}</th>
                <th className="num">{translateUi("Net")}</th>
                <th className="num">{translateUi("Transactions")}</th>
                <th>{translateUi("Status")}</th>
                <th>{translateUi("Settled at")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(settlements.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/dashboard/settlements/${s.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{translateUi(shortId(s.id, 10))}</Mono>
                    </Link>
                    <div className="text-[11px] text-ink-500">{translateUi(titleCase(s.source))}</div>
                  </td>
                  <td>
                    {translateUi(s.provider_name ?? "—")}
                    {translateUi(s.provider_account_name ? <div className="text-[11px] text-ink-500">{translateUi(s.provider_account_name)}</div> : null)}
                  </td>
                  <td className="max-w-[220px] truncate text-ink-600">{translateUi(s.settlement_entity ?? "—")}</td>
                  <td>{translateUi(s.settlement_reference ? <Mono>{translateUi(s.settlement_reference)}</Mono> : "—")}</td>
                  <td className="text-ink-600">
                    {translateUi(formatDate(s.period_start))} – {translateUi(formatDate(s.period_end))}
                  </td>
                  <td className="num">{translateUi(formatMoney(s.gross_amount, s.currency))}</td>
                  <td className="num text-ink-500">{translateUi(formatMoney(-s.fee_amount, s.currency))}</td>
                  <td className="num font-medium">{translateUi(formatMoney(s.net_amount, s.currency))}</td>
                  <td className="num">{translateUi(formatNumber(s.transaction_count))}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(s.settled_at))}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No settlements reported yet")} description={translateUi("Settlements appear when a provider reports that a period of transactions has been paid out. Until then, processed net volume shows as awaiting provider settlement.")} />
        ))}
      </Card>
    </>
  );
}
