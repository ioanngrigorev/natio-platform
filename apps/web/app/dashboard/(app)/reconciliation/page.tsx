import Link from "next/link";
import { ReconTotals } from "@/components/dashboard/recon-totals";
import { UploadProviderReport, type AccountOption } from "@/components/dashboard/upload-provider-report";
import { Card, CodeBlock, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Provider, ReconBatch } from "@/lib/types";

export const metadata = { title: "Reconciliation" };

const CSV_EXAMPLE = `provider_reference,natio_reference,type,amount,currency,status
mp_abc123,pay_8f2K1…,payment,12000,USD,settled
mp_abc124,pay_9c7Q2…,payment,4500,USD,failed
mr_xyz900,ref_1a2B3…,refund,-2000,USD,settled`;

export default async function ReconciliationPage() {
  const api = serverApi();
  const [batches, providers] = await Promise.all([api.get<{ data: ReconBatch[] }>("/dashboard/reconciliation/batches"), api.get<{ data: Provider[] }>("/dashboard/providers")]);
  const accounts: AccountOption[] = providers.data.flatMap((p) => p.accounts.filter((a) => a.mode === api.mode).map((a) => ({ id: a.id, label: a.name, provider: p.name })));

  return (
    <>
      <PageHeader title="Reconciliation" subtitle="Compare a provider's transaction report with NATIO's ledger, per provider account." actions={<UploadProviderReport accounts={accounts} />} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title="Batches" description="Every uploaded report becomes a batch with per-row match results" padded={false}>
            {batches.data.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Batch</th>
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
                        <Link href={`/dashboard/reconciliation/${b.id}`} className="font-medium text-brand-600 hover:underline">
                          <Mono>{shortId(b.id, 10)}</Mono>
                        </Link>
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
              <EmptyState title="No reconciliation batches" description="Upload a provider report (CSV) to match it against NATIO's ledger. Each upload creates a batch you can drill into." />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Report format" description="CSV with a header row; extra columns are ignored">
            <ul className="space-y-1 text-[12.5px] text-ink-700">
              <li>
                <Mono>provider_reference</Mono> — the provider&apos;s own transaction id (required)
              </li>
              <li>
                <Mono>natio_reference</Mono> — NATIO payment / refund / payout id, used when the provider reference is unknown
              </li>
              <li>
                <Mono>type</Mono> — payment, refund or payout
              </li>
              <li>
                <Mono>amount</Mono> — minor units when integer (12000), major units when decimal (120.00)
              </li>
              <li>
                <Mono>currency</Mono> — ISO 4217 code (required)
              </li>
              <li>
                <Mono>status</Mono> — settled, captured, paid, failed, declined, pending… (required)
              </li>
            </ul>
            <div className="mt-3">
              <CodeBlock code={CSV_EXAMPLE} language="csv" />
            </div>
          </Card>

          {api.mode === "test" ? (
            <Card title="Demo provider reports" description="Sandbox only: download each demo provider's own ledger as a CSV and upload it to see reconciliation end to end">
              {accounts.length ? (
                <ul className="divide-y divide-ink-100">
                  {accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                      <div className="min-w-0">
                        <div className="truncate">{a.provider}</div>
                        <div className="truncate text-[11px] text-ink-500">{a.label}</div>
                      </div>
                      <a href={`/api/dashboard/reconciliation/sandbox-report/${a.id}`} className="shrink-0 text-[12px] font-medium text-brand-600 hover:underline" download>
                        Download CSV
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] text-ink-500">No test provider accounts are available.</div>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
