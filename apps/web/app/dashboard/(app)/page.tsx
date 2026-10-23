
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { SuccessRateChart, VolumeChart } from "@/components/charts";
import { PeriodPicker } from "@/components/dashboard/filters";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { Card, Grid, Kpi, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatMoney, formatMs, formatNumber, formatPercent, isoDaysAgo } from "@/lib/format";
import { getMerchantSession, serverApi } from "@/lib/session";
import type { AnalyticsOverview, Paginated, Payment, ProviderComparisonRow, TimeseriesPoint } from "@/lib/types";

export const metadata = { title: "Overview" };

interface StatusResponse {
  api: string;
  queue_driver: string;
  providers: Array<{ provider: string; account: string; status: string; health_1h: { attempts: number; approval_rate: number | null; uptime: number | null } | null; health_24h: { attempts: number; approval_rate: number | null; uptime: number | null; avg_latency_ms: number | null } | null }>;
}

export default async function OverviewPage(props: { searchParams: Promise<{ current?: string; days?: string }> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const demo=!!(await getMerchantSession())?.sandbox && searchParams.current!=='1';
  const days = searchParams.days ?? (demo?'30':"1");
  const span=Math.max(1,Math.min(90,Number(days)||1));
  const to=demo?'2025-12-30T23:59:59.999Z':undefined;
  const from=demo?new Date(Date.parse(to!)-(span*86400000-1)).toISOString():isoDaysAgo(span);
  const bucket = days === "1" ? "hour" : "day";
  const [overview, series, providers, recent, status] = await Promise.all([
    api.get<AnalyticsOverview>(`/dashboard/analytics/overview?from=${from}${to?'&to='+to:''}`),
    api.get<{ currency: string | null; points: TimeseriesPoint[] }>(`/dashboard/analytics/timeseries?from=${from}${to?'&to='+to:''}&bucket=${bucket}`),
    api.get<{ currency: string | null; rows: ProviderComparisonRow[] }>(`/dashboard/analytics/providers?from=${from}${to?'&to='+to:''}`),
    api.get<Paginated<Payment>>("/dashboard/payments?limit=8"),
    api.get<StatusResponse>("/dashboard/status"),
  ]);
  const cur = overview.currency;

  return (
    <>
      <PageHeader title={demo?translateUi("Demo period")+" · 2025":translateUi(days === "1" ? translateUi("Today") : `Last ${days} days`)} subtitle={translateUi(`${api.mode === "test" ? "Sandbox" : "Live"} data · figures in ${cur ?? "—"}${cur ? " (largest currency in the period)" : ""}`)} actions={<PeriodPicker current={days} />} />
      {demo?<p className="mb-4 text-xs text-ink-500">{from.slice(0,10)} — {to!.slice(0,10)} UTC · <Link className="text-brand-600" href="?current=1&days=1">{translateUi("Show current period")}</Link></p>:null}
      <Grid cols={4}>
        <Kpi label={translateUi("Total payment volume")} value={cur ? formatMoney(overview.tpv, cur) : "—"} hint={`${formatNumber(overview.successful)} successful payments`} />
        <Kpi label={translateUi("Transactions")} value={formatNumber(overview.transactions)} hint={`${formatNumber(overview.failed)} failed · ${formatNumber(overview.in_flight)} in flight`} />
        <Kpi label={translateUi("Success rate")} value={formatPercent(overview.success_rate)} tone={overview.success_rate === null ? "neutral" : overview.success_rate >= 0.9 ? "ok" : overview.success_rate >= 0.75 ? "warn" : "bad"} hint={`Approval rate ${formatPercent(overview.approval_rate)} at attempt level`} />
        <Kpi label={translateUi("Average ticket")} value={cur ? formatMoney(overview.average_ticket, cur) : "—"} hint={`Avg processing ${formatMs(overview.avg_processing_ms)}`} />
      </Grid>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={translateUi("Payment volume")} description={translateUi(cur ? `Captured volume in ${cur}, ${bucket === "hour" ? "hourly" : "daily"}` : translateUi("No captured volume yet"))} className="xl:col-span-2">
          <VolumeChart points={series.points} currency={series.currency} bucket={bucket} />
        </Card>
        <Card title={translateUi("Success rate")} description={translateUi("Share of decided payments that succeeded")}>
          <SuccessRateChart points={series.points} bucket={bucket} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={translateUi("Provider performance")} description={translateUi("Attempt-level metrics per provider account")} className="xl:col-span-2" padded={false}>
          {translateUi(providers.rows.length ? (
            <Table>
              <thead>
                <tr>
                  <th>{translateUi("Provider")}</th>
                  <th className="num">{translateUi("Volume")}</th>
                  <th className="num">{translateUi("Attempts")}</th>
                  <th className="num">{translateUi("Success")}</th>
                  <th className="num">{translateUi("Cost")}</th>
                  <th className="num">{translateUi("Latency")}</th>
                  <th className="num">{translateUi("Uptime")}</th>
                </tr>
              </thead>
              <tbody>
                {translateUi(providers.rows.map((r) => (
                  <tr key={r.provider_account_id}>
                    <td>
                      <div className="font-medium">{translateUi(r.provider)}</div>
                      <div className="text-[11px] text-ink-500">{translateUi(r.account)}</div>
                    </td>
                    <td className="num">{translateUi(providers.currency ? formatMoney(r.volume, providers.currency) : "—")}</td>
                    <td className="num">{translateUi(formatNumber(r.transactions))}</td>
                    <td className="num">{translateUi(formatPercent(r.success_rate))}</td>
                    <td className="num">{translateUi(providers.currency ? formatMoney(r.cost, providers.currency) : "—")}</td>
                    <td className="num">{translateUi(formatMs(r.avg_latency_ms))}</td>
                    <td className="num">{translateUi(formatPercent(r.uptime))}</td>
                  </tr>
                )))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-ink-500">{translateUi("No provider attempts in this period.")}</div>
          ))}
        </Card>
        <Card title={translateUi("System status")} description={translateUi("Providers available to your account")} padded={false}>
          <ul className="divide-y divide-ink-100">
            <li className="flex items-center justify-between px-4 py-2 text-[13px]">
              <span>{translateUi("NATIO API")}</span>
              <StatusBadge status={status.api === "operational" ? "active" : "error"} label={translateUi(status.api)} />
            </li>
            {translateUi(status.providers.map((p) => (
              <li key={`${p.provider}-${p.account}`} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                <div className="min-w-0">
                  <div className="truncate">{translateUi(p.provider)}</div>
                  <div className="truncate text-[11px] text-ink-500">
                    {translateUi(p.account)}
                    {translateUi(p.health_24h?.attempts ? ` · 24h uptime ${formatPercent(p.health_24h.uptime, 0)} · ${formatMs(p.health_24h.avg_latency_ms)}` : translateUi(" · no traffic in 24h"))}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </li>
            )))}
          </ul>
        </Card>
      </div>

      <Card title={translateUi("Recent payments")} className="mt-4" padded={false} actions={<Link href="/dashboard/payments" className="text-[12px] font-medium text-brand-600 hover:underline">{translateUi("View all")}</Link>}>
        <PaymentsTable payments={recent.data} hrefBase="/dashboard/payments" />
      </Card>
    </>
  );
}
