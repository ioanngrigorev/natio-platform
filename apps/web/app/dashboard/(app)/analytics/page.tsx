import { BreakdownChart, SuccessRateChart, VolumeChart } from "@/components/charts";
import { PeriodPicker, QuerySelect } from "@/components/dashboard/filters";
import { Card, Grid, Kpi, Mono, PageHeader, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatMoney, formatMs, formatNumber, formatPercent, isoDaysAgo, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AnalyticsOverview, BreakdownRow, Breakdowns, ProviderComparisonRow, TimeseriesPoint } from "@/lib/types";

export const metadata = { title: "Analytics" };

function BreakdownTable({ rows, currency, dimension }: { rows: BreakdownRow[]; currency: string | null; dimension: string }) {
  if (!rows.length) return null;
  return (
    <div className="mt-2 border-t border-ink-100">
      <Table>
        <thead>
          <tr>
            <th>{dimension}</th>
            <th className="num">Txns</th>
            <th className="num">Volume</th>
            <th className="num">Success</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.key}>
              <td>{dimension === "Method" ? titleCase(r.key) : r.key}</td>
              <td className="num">{formatNumber(r.transactions)}</td>
              <td className="num">{currency ? formatMoney(r.tpv, currency, { compact: true }) : "—"}</td>
              <td className="num">{formatPercent(r.success_rate)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: { days?: string; currency?: string } }) {
  const api = serverApi();
  const days = searchParams.days ?? "7";
  const from = isoDaysAgo(Number(days) || 7);
  const bucket = days === "1" ? "hour" : "day";
  const currencyParam = searchParams.currency?.toUpperCase();
  const scope = qs({ from, currency: currencyParam });
  const [overview, series, breakdowns, providers] = await Promise.all([
    api.get<AnalyticsOverview>(`/dashboard/analytics/overview${scope}`),
    api.get<{ currency: string | null; bucket: string; points: TimeseriesPoint[] }>(`/dashboard/analytics/timeseries${qs({ from, currency: currencyParam, bucket })}`),
    api.get<Breakdowns>(`/dashboard/analytics/breakdowns${scope}`),
    api.get<{ currency: string | null; rows: ProviderComparisonRow[] }>(`/dashboard/analytics/providers${scope}`),
  ]);
  const cur = overview.currency;
  const currencies = breakdowns.by_currency.rows.map((r) => r.key).filter((k) => k && k !== "unknown");
  const periodLabel = days === "1" ? "Last 24 hours" : `Last ${days} days`;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={`${periodLabel} · ${api.mode === "test" ? "sandbox" : "live"} data · money figures in ${cur ?? "—"}${cur && !currencyParam ? " (largest currency in the period)" : ""}`}
        actions={
          <>
            <QuerySelect name="currency" label="Currency" current={currencyParam} options={currencies.map((c) => ({ value: c, label: c }))} allLabel="Auto" />
            <PeriodPicker current={days} />
          </>
        }
      />

      <Grid cols={4}>
        <Kpi label="Total payment volume" value={cur ? formatMoney(overview.tpv, cur) : "—"} hint={`${formatNumber(overview.successful)} successful payments`} />
        <Kpi label="Transactions" value={formatNumber(overview.transactions)} hint={`${formatNumber(overview.failed)} failed · ${formatNumber(overview.in_flight)} in flight`} />
        <Kpi label="Success rate" value={formatPercent(overview.success_rate)} tone={overview.success_rate === null ? "neutral" : overview.success_rate >= 0.9 ? "ok" : overview.success_rate >= 0.75 ? "warn" : "bad"} hint="Share of decided payments that succeeded" />
        <Kpi label="Approval rate" value={formatPercent(overview.approval_rate)} hint="Attempt level, across all providers" />
        <Kpi label="Net revenue" value={cur ? formatMoney(overview.net_revenue, cur) : "—"} hint={`TPV − ${cur ? formatMoney(overview.refunded, cur) : "—"} refunded`} />
        <Kpi label="Processing cost" value={cur ? formatMoney(overview.processing_cost, cur) : "—"} hint={cur && overview.tpv ? `${formatPercent(overview.processing_cost / overview.tpv, 2)} of TPV in provider fees` : "Provider fees"} />
        <Kpi label="Average ticket" value={cur ? formatMoney(overview.average_ticket, cur) : "—"} hint={`Avg processing ${formatMs(overview.avg_processing_ms)}`} />
        <Kpi label="Provider uptime" value={formatPercent(overview.provider_uptime)} tone={overview.provider_uptime === null ? "neutral" : overview.provider_uptime >= 0.99 ? "ok" : overview.provider_uptime >= 0.95 ? "warn" : "bad"} hint="Attempts without technical failure" />
      </Grid>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Payment volume" description={cur ? `Captured volume in ${cur}, ${bucket === "hour" ? "hourly" : "daily"}` : "No captured volume yet"} className="xl:col-span-2">
          <VolumeChart points={series.points} currency={series.currency} bucket={bucket} />
        </Card>
        <Card title="Success rate" description="Share of decided payments that succeeded">
          <SuccessRateChart points={series.points} bucket={bucket} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="By country" description="Payments by customer country" padded={false}>
          <div className="p-4 pb-0">
            <BreakdownChart rows={breakdowns.by_country.rows} currency={breakdowns.by_country.currency} />
          </div>
          <BreakdownTable rows={breakdowns.by_country.rows} currency={breakdowns.by_country.currency} dimension="Country" />
        </Card>
        <Card title="By currency" description="Payments by presentment currency" padded={false}>
          <div className="p-4 pb-0">
            <BreakdownChart rows={breakdowns.by_currency.rows} currency={breakdowns.by_currency.currency} />
          </div>
          <BreakdownTable rows={breakdowns.by_currency.rows} currency={breakdowns.by_currency.currency} dimension="Currency" />
        </Card>
        <Card title="By provider" description="Payments by final provider" padded={false}>
          <div className="p-4 pb-0">
            <BreakdownChart rows={breakdowns.by_provider.rows} currency={breakdowns.by_provider.currency} />
          </div>
          <BreakdownTable rows={breakdowns.by_provider.rows} currency={breakdowns.by_provider.currency} dimension="Provider" />
        </Card>
        <Card title="By method" description="Payments by payment method" padded={false}>
          <div className="p-4 pb-0">
            <BreakdownChart rows={breakdowns.by_method.rows} currency={breakdowns.by_method.currency} />
          </div>
          <BreakdownTable rows={breakdowns.by_method.rows} currency={breakdowns.by_method.currency} dimension="Method" />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Provider comparison" description="Attempt-level metrics per provider account in the period" className="xl:col-span-2" padded={false}>
          {providers.rows.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Account</th>
                  <th className="num">Volume</th>
                  <th className="num">Transactions</th>
                  <th className="num">Success rate</th>
                  <th className="num">Cost</th>
                  <th className="num">Latency</th>
                  <th className="num">Uptime</th>
                </tr>
              </thead>
              <tbody>
                {providers.rows.map((r) => (
                  <tr key={r.provider_account_id}>
                    <td className="font-medium">{r.provider}</td>
                    <td className="text-ink-600">{r.account}</td>
                    <td className="num">{providers.currency ? formatMoney(r.volume, providers.currency) : "—"}</td>
                    <td className="num">{formatNumber(r.transactions)}</td>
                    <td className="num">{formatPercent(r.success_rate)}</td>
                    <td className="num">{providers.currency ? formatMoney(r.cost, providers.currency) : "—"}</td>
                    <td className="num">{formatMs(r.avg_latency_ms)}</td>
                    <td className="num">{formatPercent(r.uptime)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-ink-500">No provider attempts in this period.</div>
          )}
        </Card>
        <Card title="Decline reasons" description="Failed payments by failure code" padded={false}>
          {breakdowns.decline_reasons.rows.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Category</th>
                  <th className="num">Payments</th>
                </tr>
              </thead>
              <tbody>
                {breakdowns.decline_reasons.rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <Mono className="text-bad">{r.key}</Mono>
                    </td>
                    <td className="text-ink-600">{r.category ? titleCase(r.category) : "—"}</td>
                    <td className="num">{formatNumber(r.transactions)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-ink-500">No failed payments in this period.</div>
          )}
        </Card>
      </div>
    </>
  );
}
