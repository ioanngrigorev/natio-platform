import Link from "next/link";
import { RunSandboxReconciliation, UploadProviderCsv, type AccountOption } from "@/components/admin/reconciliation-actions";
import { FilterBar } from "@/components/dashboard/filters";
import { ReconTotals } from "@/components/dashboard/recon-totals";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDate, formatDateTime, formatNumber, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Provider, ReconBatch } from "@/lib/types";

export const metadata = { title: "Reconciliation" };

export default async function AdminReconciliationPage({ searchParams }: { searchParams: { merchant_id?: string } }) {
  const api = serverApi();
  const [batches, merchants, providers] = await Promise.all([
    api.get<{ data: ReconBatch[] }>(`/admin/reconciliation/batches${qs({ merchant_id: searchParams.merchant_id })}`),
    api.get<{ data: AdminMerchant[] }>("/admin/merchants?limit=500"),
    api.get<{ data: Provider[] }>("/admin/providers"),
  ]);
  const merchantList = merchants.data.map((m) => ({ id: m.id, name: m.name }));
  const merchantName = new Map(merchantList.map((m) => [m.id, m.name]));
  const accounts: AccountOption[] = providers.data.flatMap((p) => p.accounts.filter((a) => a.mode === api.mode).map((a) => ({ id: a.id, name: a.name, provider: p.name, mode: a.mode })));

  return (
    <>
      <PageHeader
        title="Reconciliation"
        subtitle={`Match a provider's transaction report against NATIO's ledger, per provider account · ${api.mode} mode.`}
        actions={
          <>
            {api.mode === "test" ? <RunSandboxReconciliation accounts={accounts} merchants={merchantList} /> : null}
            <UploadProviderCsv accounts={accounts} merchants={merchantList} />
          </>
        }
      />

      <FilterBar filters={[{ name: "merchant_id", label: "Merchant", type: "select", options: merchantList.map((m) => ({ value: m.id, label: m.name })) }]} />

      <Card title="Batches" description="Every report becomes a batch with per-row match results" padded={false}>
        {batches.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Merchant</th>
                <th>Provider account</th>
                <th>Source</th>
                <th>File</th>
                <th>Period</th>
                <th className="num">Rows</th>
                <th>Results</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {batches.data.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/admin/reconciliation/${b.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{shortId(b.id, 10)}</Mono>
                    </Link>
                  </td>
                  <td>
                    {b.merchant_id ? (
                      <Link href={`/admin/merchants/${b.merchant_id}`} className="text-brand-600 hover:underline">
                        {merchantName.get(b.merchant_id) ?? shortId(b.merchant_id, 10)}
                      </Link>
                    ) : (
                      <span className="text-ink-400">all merchants</span>
                    )}
                  </td>
                  <td>
                    {b.provider_name ?? "—"}
                    {b.provider_account_name ? <div className="text-[11px] text-ink-500">{b.provider_account_name}</div> : null}
                  </td>
                  <td>{titleCase(b.source)}</td>
                  <td className="max-w-[180px] truncate text-ink-600">{b.file_name ?? "—"}</td>
                  <td className="text-ink-600">{b.period_start || b.period_end ? `${formatDate(b.period_start)} – ${formatDate(b.period_end)}` : "All time"}</td>
                  <td className="num">{formatNumber(b.totals.total)}</td>
                  <td>
                    <ReconTotals totals={b.totals} />
                  </td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="text-ink-500">{formatDateTime(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="No reconciliation batches"
            description={api.mode === "test" ? "Run a demo reconciliation to match a sandbox provider's own ledger against NATIO, or upload a provider CSV." : "Upload a provider report (CSV) to match it against NATIO's ledger."}
          />
        )}
      </Card>
    </>
  );
}
