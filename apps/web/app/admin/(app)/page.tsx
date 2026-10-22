import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { BiCharts } from "@/components/admin/bi-charts";
import type { BiReport } from "@/lib/bi-types";
import { LevelTag } from "@/components/admin/condition-chips";
import { PeriodPicker } from "@/components/dashboard/filters";
import { Card, Grid, Kpi, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatMoney, formatMs, formatNumber, formatPercent, isoDaysAgo } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminOverview } from "@/lib/admin-types";

export const metadata = { title: "Admin overview" };

export default async function AdminOverviewPage({ searchParams }: { searchParams: { days?: string } }) {
  const api = serverApi();
  const days = searchParams.days ?? (api.mode === "test" ? "2025" : "1");
  const from = days === "2025" ? "2025-01-01T00:00:00.000Z" : isoDaysAgo(Number(days) || 1);
  const to = days === "2025" ? "2025-12-31T23:59:59.999Z" : new Date().toISOString();
  const [o,bi] = await Promise.all([api.get<AdminOverview>(`/admin/overview?from=${from}&to=${to}`),api.get<BiReport>(`/admin/bi?from=${from.slice(0,10)}&to=${to.slice(0,10)}&currency=EUR`)]);
  const accounts = o.providers.flatMap((p) => p.accounts.map((a) => ({ ...a, provider: p })));
  const successRate = o.payments.successful + o.payments.failed ? o.payments.successful / (o.payments.successful + o.payments.failed) : null;

  return (
    <>
      <div className="admin-hero"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="admin-eyebrow">NATIO · {api.mode === "test" ? "Investor demo" : "Operations"}</p><h1 className="mt-2">Payments, in perspective.</h1><p className="mt-2 text-sm text-ink-500">{days === "2025" ? "1 January — 31 December 2025" : `Last ${days} days`} · {api.mode === "test" ? "Synthetic transaction history" : "Live processing"}</p></div><div className="flex items-center gap-3"><Link href="/admin?days=2025" className="rounded-md bg-brand-600 px-3 py-1 text-xs text-white">2025</Link><PeriodPicker current={days}/></div></div><div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-4">{[{value:bi.coverage.transactions,label:"Transactions",href:"/admin/transactions"},{value:bi.coverage.merchants,label:"Merchants",href:"/admin/merchants"},{value:bi.coverage.providers,label:"Payment providers",href:"/admin/providers"},{value:bi.coverage.users,label:"Merchant users",href:"/admin/users"}].map(m=><Link className="admin-metric" key={m.label} href={m.href}><strong>{formatNumber(m.value)}</strong><span>{m.label} →</span></Link>)}</div></div>

      <Grid cols={4}>
        <Kpi label="Merchants" value={formatNumber(o.merchants.total)} hint={`${formatNumber(o.merchants.active)} active · ${formatNumber(o.payments.merchants)} transacting in period`} />
        <Kpi label="KYB pending" value={formatNumber(o.merchants.kybPending)} tone={o.merchants.kybPending ? "warn" : "neutral"} hint={<Link href="/admin/merchants?kyb=pending" className="text-brand-600 hover:underline">Review merchants</Link>} />
        <Kpi label="Payments" value={formatNumber(o.payments.total)} hint={`${formatNumber(o.payments.successful)} successful · ${formatNumber(o.payments.failed)} failed`} />
        <Kpi label="Success rate" value={formatPercent(successRate)} tone={successRate === null ? "neutral" : successRate >= 0.9 ? "ok" : successRate >= 0.75 ? "warn" : "bad"} hint="Share of decided payments" />
      </Grid>
      <Grid cols={4} className="mt-4">
        <Kpi label="Pending review" value={formatNumber(o.payments.pending)} tone={o.payments.pending ? "warn" : "neutral"} hint={<Link href="/admin/payments?status=pending" className="text-brand-600 hover:underline">Open review queue</Link>} />
        <Kpi label="Processing" value={formatNumber(o.payments.processing)} hint={<Link href="/admin/payments?status=processing" className="text-brand-600 hover:underline">In-flight payments</Link>} />
        <Kpi label="Failed" value={formatNumber(o.payments.failed)} tone={o.payments.failed ? "bad" : "neutral"} hint={<Link href="/admin/payments?status=failed" className="text-brand-600 hover:underline">Failed payments</Link>} />
        <Kpi label="Provider accounts" value={formatNumber(o.provider_count)} hint={`Payment providers in ${api.mode} mode`} />
      </Grid>

      <div className="my-5"><BiCharts report={bi} overview /></div>
      <div className="mb-5 flex justify-end"><Link href="/admin/bi" className="text-sm font-medium text-brand-600">Explore BI, balances and Excel reports →</Link></div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Provider accounts" description="Sample of providers · performance in selected period" className="xl:col-span-2" padded={false} actions={<Link href="/admin/providers" className="text-[12px] font-medium text-brand-600 hover:underline">Manage providers</Link>}>
          {accounts.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th className="num">Attempts</th>
                  <th className="num">Approval</th>
                  <th className="num">Uptime</th>
                  <th className="num">Latency</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <EntityLink kind="providers" id={a.provider.id}>{a.provider.name}</EntityLink>
                      <div className="text-[11px] text-ink-500">
                        <EntityLink kind="provider-accounts" id={a.id}>{a.name}</EntityLink> · <Mono className="text-[11px]">{a.provider.adapter_key}</Mono>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <StatusBadge status={a.status} />
                        {a.provider.status !== "active" ? <StatusBadge status={a.provider.status} label={`provider ${a.provider.status}`} /> : null}
                        {a.config.simulation?.forceOutcome ? <StatusBadge status="warning" label={`sim: ${a.config.simulation.forceOutcome}`} /> : null}
                      </div>
                    </td>
                    <td className="num">{a.health ? formatNumber(a.health.attempts) : <span className="text-ink-400">0</span>}</td>
                    <td className="num">{formatPercent(a.health?.approval_rate)}</td>
                    <td className="num">{formatPercent(a.health?.uptime, 0)}</td>
                    <td className="num">{formatMs(a.health?.avg_latency_ms)}</td>
                    <td className="text-ink-500">{a.health?.last_error_at ? formatDateTime(a.health.last_error_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-ink-500">No provider accounts in {api.mode} mode.</div>
          )}
        </Card>

        <Card title="Volume by currency" description="Successful payment volume and provider fees in the period" padded={false}>
          {o.payments.volumes.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Currency</th>
                  <th className="num">Volume</th>
                  <th className="num">Fees</th>
                </tr>
              </thead>
              <tbody>
                {o.payments.volumes.slice(0,10).map((v) => (
                  <tr key={v.currency}>
                    <td className="font-medium">{v.currency}</td>
                    <td className="num">{formatMoney(v.tpv, v.currency)}</td>
                    <td className="num text-ink-500">{formatMoney(v.fees, v.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-ink-500">No successful payments in this period.</div>
          )}
        </Card>
      </div>

      <Card title="Recent system events" description="Latest platform events from providers, workers and admin actions" className="mt-4" padded={false} actions={<Link href="/admin/system-events" className="text-[12px] font-medium text-brand-600 hover:underline">View all</Link>}>
        {o.recent_events.length ? (
          <Table>
            <thead>
              <tr>
                <th>Level</th>
                <th>Source</th>
                <th>Type</th>
                <th>Message</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {o.recent_events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <LevelTag level={e.level} />
                  </td>
                  <td>{e.source}</td>
                  <td>
                    <Mono>{e.type}</Mono>
                  </td>
                  <td className="max-w-[520px] truncate text-ink-700" title={e.message}>
                    {e.message}
                  </td>
                  <td className="text-ink-500">{formatDateTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="px-4 py-8 text-center text-[13px] text-ink-500">No system events recorded yet.</div>
        )}
      </Card>
    </>
  );
}
