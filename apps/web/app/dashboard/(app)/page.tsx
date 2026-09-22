import Link from "next/link";
import { SuccessRateChart, VolumeChart } from "@/components/charts";
import { PeriodPicker } from "@/components/dashboard/filters";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { Card, Grid, Kpi, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatMoney, formatMs, formatNumber, formatPercent, isoDaysAgo } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AnalyticsOverview, Paginated, Payment, ProviderComparisonRow, TimeseriesPoint } from "@/lib/types";

export const metadata = { title: "Overview" };

interface StatusResponse {
  api: string;
  queue_driver: string;
  providers: Array<{ provider: string; account: string; status: string; health_1h: { attempts: number; approval_rate: number | null; uptime: number | null } | null; health_24h: { attempts: number; approval_rate: number | null; uptime: number | null; avg_latency_ms: number | null } | null }>;
}

export default async function OverviewPage({ searchParams }: { searchParams: { days?: string } }) {
  const api = serverApi();
  const days = searchParams.days ?? "1";
  const from = isoDaysAgo(Number(days) || 1);
  const bucket = days === "1" ? "hour" : "day";
  const [overview, series, providers, recent, status] = await Promise.all([
    api.get<AnalyticsOverview>(`/dashboard/analytics/overview?from=${from}`),
    api.get<{ currency: string | null; points: TimeseriesPoint[] }>(`/dashboard/analytics/timeseries?from=${from}&bucket=${bucket}`),
    api.get<{ currency: string | null; rows: ProviderComparisonRow[] }>(`/dashboard/analytics/providers?from=${from}`),
    api.get<Paginated<Payment>>("/dashboard/payments?limit=8"),
    api.get<StatusResponse>("/dashboard/status"),
  ]);
  const cur = overview.currency;

  return (
    <>
      <PageHeader title={days === "1" ? "Today" : `Last ${days} days`} subtitle={`${api.mode === "test" ? "Sandbox" : "Live"} data · figures in ${cur ?? "—"}${cur ? " (largest currency in the period)" : ""}`} actions={<PeriodPicker current={days} />} />
      <Grid cols={4}>
        <Kpi label="Total payment volume" value={cur ? formatMoney(overview.tpv, cur) : "—"} hint={`${formatNumber(overview.successful)} successful payments`} />
        <Kpi label="Transactions" value={formatNumber(overview.transactions)} hint={`${formatNumber(overview.failed)} failed · ${formatNumber(overview.in_flight)} in flight`} />
        <Kpi label="Success rate" value={formatPercent(overview.success_rate)} tone={overview.success_rate === null ? "neutral" : overview.success_rate >= 0.9 ? "ok" : overview.success_rate >= 0.75 ? "warn" : "bad"} hint={`Approval rate ${formatPercent(overview.approval_rate)} at attempt level`} />
        <Kpi label="Average ticket" value={cur ? formatMoney(overview.average_ticket, cur) : "—"} hint={`Avg processing ${formatMs(overview.avg_processing_ms)}`} />
      </Grid>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Payment volume" description={cur ? `Captured volume in ${cur}, ${bucket === "hour" ? "hourly" : "daily"}` : "No captured volume yet"} className="xl:col-span-2">
          <VolumeChart points={series.points} currency={series.currency} bucket={bucket} />
        </Card>
        <Card title="Success rate" description="Share of decided payments that succeeded">
          <SuccessRateChart points={series.points} bucket={bucket} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Provider performance" description="Attempt-level metrics per provider account" className="xl:col-span-2" padded={false}>
          {providers.rows.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className="num">Volume</th>
                  <th className="num">Attempts</th>
                  <th className="num">Success</th>
                  <th className="num">Cost</th>
                  <th className="num">Latency</th>
                  <th className="num">Uptime</th>
                </tr>
              </thead>
              <tbody>
                {providers.rows.map((r) => (
                  <tr key={r.provider_account_id}>
                    <td>
                      <div className="font-medium">{r.provider}</div>
                      <div className="text-[11px] text-ink-500">{r.account}</div>
                    </td>
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
        <Card title="System status" description="Providers available to your account" padded={false}>
          <ul className="divide-y divide-ink-100">
            <li className="flex items-center justify-between px-4 py-2 text-[13px]">
              <span>NATIO API</span>
              <StatusBadge status={status.api === "operational" ? "active" : "error"} label={status.api} />
            </li>
            {status.providers.map((p) => (
              <li key={`${p.provider}-${p.account}`} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                <div className="min-w-0">
                  <div className="truncate">{p.provider}</div>
                  <div className="truncate text-[11px] text-ink-500">
                    {p.account}
                    {p.health_24h?.attempts ? ` · 24h uptime ${formatPercent(p.health_24h.uptime, 0)} · ${formatMs(p.health_24h.avg_latency_ms)}` : " · no traffic in 24h"}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Recent payments" className="mt-4" padded={false} actions={<Link href="/dashboard/payments" className="text-[12px] font-medium text-brand-600 hover:underline">View all</Link>}>
        <PaymentsTable payments={recent.data} hrefBase="/dashboard/payments" />
      </Card>
    </>
  );
}
