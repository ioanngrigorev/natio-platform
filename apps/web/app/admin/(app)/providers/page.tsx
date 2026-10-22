import { Suspense } from "react";
import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { AccountsTable, AddProviderAccount, ProviderStatusButton } from "@/components/admin/provider-actions";
import { PeriodPicker } from "@/components/dashboard/filters";
import { Card, DescriptionList, EmptyState, Mono, PageHeader, StatusBadge, Table, Tag } from "@/components/ui";
import { formatMoney, formatMs, formatNumber, formatPercent, formatDate, titleCase } from "@/lib/format";
import { getAdminPeriod } from "@/lib/admin-reporting";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Provider, ProviderComparisonRow } from "@/lib/types";

export const metadata = { title: "Providers" };

function capabilityTags(capabilities: Record<string, boolean>) {
  const on = Object.entries(capabilities)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!on.length) return <span className="text-ink-400">none declared</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {on.map((c) => (
        <Tag key={c}>{c.replace(/([A-Z])/g, " $1").toLowerCase()}</Tag>
      ))}
    </span>
  );
}

function listSummary(values: string[], allLabel: string) {
  if (!values.length) return <span className="text-ink-400">{allLabel}</span>;
  const head = values.slice(0, 6).join(", ");
  return (
    <span>
      {formatNumber(values.length)} · <span className="text-ink-600">{head}</span>
      {values.length > 6 ? <span className="text-ink-400"> +{values.length - 6}</span> : null}
    </span>
  );
}

export default async function AdminProvidersPage({ searchParams }: { searchParams: { days?: string; search?: string; page?: string } }) {
  const api = serverApi();
  const {days, from, to, label} = await getAdminPeriod(searchParams.days);
  const page = Math.max(1,Math.floor(Number(searchParams.page)||1));
  const search = searchParams.search || "";
  const comparisonRequest = api.get<{ currency: string | null; rows: ProviderComparisonRow[] }>(`/admin/providers/comparison?from=${from}&to=${to}&currency=EUR`);
  const [providers, merchants] = await Promise.all([
    api.get<{ data: Provider[]; total:number; has_more:boolean }>(`/admin/providers?limit=20&offset=${(page-1)*20}&search=${encodeURIComponent(search)}&from=${from}&to=${to}`),
    api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500"),
  ]);

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle={`Connected acquirers, banks and payment providers and their ${api.mode} accounts. Providers hold the funds and settle them; NATIO routes traffic and reports their figures.`}
        actions={<AddProviderAccount providers={providers.data.map((p) => ({ id: p.id, name: p.name, status: p.status }))} merchants={merchants.data.map((m) => ({ id: m.id, name: m.name }))} />}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-500">{label} · {formatDate(from)} — {formatDate(to)}</p><PeriodPicker current={days} demo={api.mode === "test"}/></div>
      <form className="mb-4 flex flex-wrap items-center gap-3"><input type="hidden" name="days" value={days}/><input className="input max-w-md" name="search" defaultValue={search} placeholder="Search provider, method, country or currency"/><button className="rounded-md bg-brand-600 px-4 py-2 text-sm text-white">Search</button><span className="text-sm text-ink-500">{formatNumber(providers.total)} providers · page {page}</span></form>
      <div className="space-y-4">
        {providers.data.map((p) => (
          <Card
            key={p.id}
            padded={false}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <EntityLink kind="providers" id={p.id}>{p.name} →</EntityLink>
                <StatusBadge status={p.status} />
                {p.adapter_registered ? <Tag tone="ok">adapter registered</Tag> : <Tag tone="bad">adapter missing</Tag>}
              </span>
            }
            description={
              <span>
                <Mono className="text-[11px]">{p.code}</Mono> · {titleCase(p.type)}
                {p.description ? ` · ${p.description}` : ""}
              </span>
            }
            actions={<ProviderStatusButton provider={p} />}
          >
            <div className="border-b border-ink-100 px-4 py-3">
              <DescriptionList
                cols={3}
                items={[
                  { label: "Adapter key", value: <Mono>{p.adapter_key}</Mono> },
                  { label: "Capabilities", value: capabilityTags(p.capabilities) },
                  { label: "Settlement entity", value: p.settlement_entity ?? "—" },
                  { label: "Supported methods", value: listSummary(p.supported_methods, "none declared") },
                  { label: "Supported currencies", value: listSummary(p.supported_currencies, "any currency") },
                  { label: "Supported countries", value: listSummary(p.supported_countries, "any country") },
                ]}
              />
            </div>
            <AccountsTable accounts={p.accounts} />
          </Card>
        ))}
        {providers.data.length ? null : (
          <Card>
            <EmptyState title="No providers" description="Providers are registered with an adapter in the platform configuration." />
          </Card>
        )}
      </div>

      <div className="my-5 flex justify-between text-sm text-brand-600">{page>1?<Link href={`/admin/providers?page=${page-1}&search=${encodeURIComponent(search)}&days=${days}`}>← Previous</Link>:<span/>}{providers.has_more?<Link href={`/admin/providers?page=${page+1}&search=${encodeURIComponent(search)}&days=${days}`}>Next →</Link>:null}</div>
      <Suspense fallback={<Card title="Provider comparison" className="mt-6"><p role="status" className="py-6 text-sm text-ink-500">Calculating performance for the selected period… You can browse providers above.</p></Card>}>
        <ProviderComparisonCard result={comparisonRequest} label={label}/>
      </Suspense>
    </>
  );
}

async function ProviderComparisonCard({ result, label }: { result: Promise<{ currency: string | null; rows: ProviderComparisonRow[] }>; label: string }) {
  const comparison = await result;
  return <>      <Card
        title="Provider comparison"
        description={`Attempt-level metrics · ${label}${comparison.currency ? ` · money in ${comparison.currency}` : ""}`}
        className="mt-6"
        padded={false}

      >
        {comparison.rows.length ? (
          <Table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Account</th>
                <th className="num">Volume</th>
                <th className="num">Transactions</th>
                <th className="num">Success rate</th>
                <th className="num">Cost</th>
                <th className="num">Avg latency</th>
                <th className="num">Uptime</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((r) => (
                <tr key={r.provider_account_id}>
                  <td className="font-medium"><EntityLink kind="provider-accounts" id={r.provider_account_id}>{r.provider}</EntityLink></td>
                  <td className="text-ink-600"><EntityLink kind="provider-accounts" id={r.provider_account_id}>{r.account}</EntityLink></td>
                  <td className="num">{comparison.currency ? formatMoney(r.volume, comparison.currency) : "—"}</td>
                  <td className="num">{formatNumber(r.transactions)}</td>
                  <td className="num">{formatPercent(r.success_rate)}</td>
                  <td className="num text-ink-500">{comparison.currency ? formatMoney(r.cost, comparison.currency) : "—"}</td>
                  <td className="num">{formatMs(r.avg_latency_ms)}</td>
                  <td className="num">{formatPercent(r.uptime, 0)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="px-4 py-8 text-center text-[13px] text-ink-500">No provider attempts in this period.</div>
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">Volume counts successful payments in the comparison currency only; cost includes fees in the comparison currency only.</p>
</>;
}
