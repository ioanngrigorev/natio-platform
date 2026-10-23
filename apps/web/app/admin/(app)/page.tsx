
import {getI18n} from '@/lib/i18n/server';
import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { BiCharts } from "@/components/admin/bi-charts";
import type { BiReport } from "@/lib/bi-types";
import { LevelTag } from "@/components/admin/condition-chips";
import { PeriodPicker } from "@/components/dashboard/filters";
import { Card, Grid, Kpi, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatMoney, formatMs, formatNumber, formatPercent, formatDate } from "@/lib/format";
import { getAdminPeriod } from "@/lib/admin-reporting";
import { serverApi } from "@/lib/session";
import type { AdminOverview } from "@/lib/admin-types";

export const metadata = { title: "Admin overview" };

export default async function AdminOverviewPage({ searchParams }: { searchParams: { days?: string } }) {
 const {t:translateUi,locale:uiLocale}=getI18n();

  const api = serverApi();
  const {days, from, to, label} = await getAdminPeriod(searchParams.days);
  const [o,bi] = await Promise.all([api.get<AdminOverview>(`/admin/overview?from=${from}&to=${to}`),api.get<BiReport>(`/admin/bi?from=${from.slice(0,10)}&to=${to.slice(0,10)}&currency=EUR`)]);
  const accounts = o.providers.flatMap((p) => p.accounts.map((a) => ({ ...a, provider: p })));
  const successRate = o.payments.successful + o.payments.failed ? o.payments.successful / (o.payments.successful + o.payments.failed) : null;

  return (
    <>
      <PageHeader title={translateUi("Overview")} subtitle={translateUi("Payment performance and the queues that need your attention.")} actions={<PeriodPicker current={days} demo={api.mode === "test"}/>}/>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white px-4 py-3">
        <div><p className="text-sm font-medium text-ink-900">{translateUi(label)}</p><p className="mt-1 text-xs text-ink-500">{translateUi(formatDate(from))} — {translateUi(formatDate(to))}{translateUi(" · UTC · ")}{translateUi(api.mode === "test" ? translateUi("Synthetic data from 2025") : translateUi("Live data"))}</p></div>
        <Link className="text-sm font-medium text-brand-600" href={`/admin/bi?from=${from.slice(0,10)}&to=${to.slice(0,10)}`}>{translateUi("Explore BI & reports →")}</Link>
      </div>
      <Grid cols={4}>
        <Link href={`/admin/bi?from=${from.slice(0,10)}&to=${to.slice(0,10)}&currency=EUR`}><Kpi label={translateUi("Pay-in volume · EUR")} value={formatMoney(bi.summary.volume,"EUR",{compact:true})} hint="Successful pay-ins · selected period"/></Link>
        <Link href={`/admin/payments?from=${from}&to=${to}`}><Kpi label={translateUi("Payments")} value={formatNumber(o.payments.total)} hint={`${formatNumber(o.payments.successful)} successful · all currencies`}/></Link>
        <Link href={`/admin/payments?status=failed&from=${from}&to=${to}`}><Kpi label={translateUi("Success rate")} value={formatPercent(successRate)} hint="Successful / decided payments"/></Link>
        <Link href="/admin/merchants"><Kpi label={translateUi("Transacting merchants")} value={formatNumber(o.payments.merchants)} hint={`${formatNumber(o.merchants.total)} merchants in the workspace`}/></Link>
      </Grid>
      <div className="my-5"><BiCharts report={bi} overview /></div>
      <div className="mb-3 mt-6"><h2 className="text-sm font-semibold text-ink-900">{translateUi("Needs attention")}</h2><p className="mt-1 text-xs text-ink-500">{translateUi("Payment queues follow the selected period. KYB shows the current review queue.")}</p></div>
      <Grid cols={4}>
        <Link href={`/admin/payments?status=pending&from=${from}&to=${to}`}><Kpi label={translateUi("Pending review")} value={formatNumber(o.payments.pending)} tone="warn" hint="Open review queue →"/></Link>
        <Link href={`/admin/payments?status=processing&from=${from}&to=${to}`}><Kpi label={translateUi("Processing")} value={formatNumber(o.payments.processing)} hint="In-flight payments →"/></Link>
        <Link href={`/admin/payments?status=failed&from=${from}&to=${to}`}><Kpi label={translateUi("Failed")} value={formatNumber(o.payments.failed)} tone="bad" hint="Investigate failures →"/></Link>
        <Link href="/admin/merchants?kyb=pending"><Kpi label={translateUi("KYB pending")} value={formatNumber(o.merchants.kybPending)} tone="warn" hint="Review merchants →"/></Link>
      </Grid>
      <div className="my-5 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-ink-200 px-4 py-3 text-xs text-ink-500"><span className="font-medium">{translateUi("Workspace totals")}</span>{translateUi([{value:bi.coverage.transactions,label:"transactions",href:"/admin/transactions"},{value:bi.coverage.merchants,label:"merchants",href:"/admin/merchants"},{value:bi.coverage.providers,label:"providers",href:"/admin/providers"},{value:bi.coverage.users,label:"users",href:"/admin/users"}].map(m=><Link className="text-brand-600" href={m.href} key={m.label}>{translateUi(formatNumber(m.value))} {translateUi(m.label)} →</Link>))}</div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={translateUi("Provider accounts")} description={translateUi("Sample of providers · performance in selected period")} className="xl:col-span-2" padded={false} actions={<Link href="/admin/providers" className="text-[12px] font-medium text-brand-600 hover:underline">{translateUi("Manage providers")}</Link>}>
          {translateUi(accounts.length ? (
            <Table>
              <thead>
                <tr>
                  <th>{translateUi("Provider")}</th>
                  <th>{translateUi("Status")}</th>
                  <th className="num">{translateUi("Attempts")}</th>
                  <th className="num">{translateUi("Approval")}</th>
                  <th className="num">{translateUi("Uptime")}</th>
                  <th className="num">{translateUi("Latency")}</th>
                  <th>{translateUi("Last error")}</th>
                </tr>
              </thead>
              <tbody>
                {translateUi(accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <EntityLink kind="providers" id={a.provider.id}>{a.provider.name}</EntityLink>
                      <div className="text-[11px] text-ink-500">
                        <EntityLink kind="provider-accounts" id={a.id}>{a.name}</EntityLink> · <Mono className="text-[11px]">{translateUi(a.provider.adapter_key)}</Mono>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <StatusBadge status={a.status} />
                        {translateUi(a.provider.status !== "active" ? <StatusBadge status={a.provider.status} label={translateUi(`provider ${a.provider.status}`)} /> : null)}
                        {translateUi(a.config.simulation?.forceOutcome ? <StatusBadge status="warning" label={translateUi(`sim: ${a.config.simulation.forceOutcome}`)} /> : null)}
                      </div>
                    </td>
                    <td className="num">{translateUi(a.health ? formatNumber(a.health.attempts) : <span className="text-ink-400">0</span>)}</td>
                    <td className="num">{translateUi(formatPercent(a.health?.approval_rate))}</td>
                    <td className="num">{translateUi(formatPercent(a.health?.uptime, 0))}</td>
                    <td className="num">{translateUi(formatMs(a.health?.avg_latency_ms))}</td>
                    <td className="text-ink-500">{translateUi(a.health?.last_error_at ? formatDateTime(a.health.last_error_at) : "—")}</td>
                  </tr>
                )))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-ink-500">{translateUi("No provider accounts in ")}{translateUi(api.mode)}{translateUi(" mode.")}</div>
          ))}
        </Card>

        <Card title={translateUi("Volume by currency")} description={translateUi("Successful payment volume and merchant fees in the period")} padded={false}>
          {translateUi(o.payments.volumes.length ? (
            <Table>
              <thead>
                <tr>
                  <th>{translateUi("Currency")}</th>
                  <th className="num">{translateUi("Volume")}</th>
                  <th className="num">{translateUi("Fees")}</th>
                </tr>
              </thead>
              <tbody>
                {translateUi(o.payments.volumes.slice(0,10).map((v) => (
                  <tr key={v.currency}>
                    <td className="font-medium">{translateUi(v.currency)}</td>
                    <td className="num">{translateUi(formatMoney(v.tpv, v.currency))}</td>
                    <td className="num text-ink-500">{translateUi(formatMoney(v.fees, v.currency))}</td>
                  </tr>
                )))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-ink-500">{translateUi("No successful payments in this period.")}</div>
          ))}
        </Card>
      </div>

      <Card title={translateUi("Recent system events")} description={translateUi("Latest platform events from providers, workers and admin actions")} className="mt-4" padded={false} actions={<Link href="/admin/system-events" className="text-[12px] font-medium text-brand-600 hover:underline">{translateUi("View all")}</Link>}>
        {translateUi(o.recent_events.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Level")}</th>
                <th>{translateUi("Source")}</th>
                <th>{translateUi("Type")}</th>
                <th>{translateUi("Message")}</th>
                <th>{translateUi("Time")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(o.recent_events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <LevelTag level={e.level} />
                  </td>
                  <td>{translateUi(e.source)}</td>
                  <td>
                    <Mono>{translateUi(e.type)}</Mono>
                  </td>
                  <td className="max-w-[520px] truncate text-ink-700" title={translateUi(e.message)}>
                    {translateUi(e.message)}
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(e.createdAt))}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <div className="px-4 py-8 text-center text-[13px] text-ink-500">{translateUi("No system events recorded yet.")}</div>
        ))}
      </Card>
    </>
  );
}
