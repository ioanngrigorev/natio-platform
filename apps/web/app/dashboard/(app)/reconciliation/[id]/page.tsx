
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterBar } from "@/components/dashboard/filters";
import { RECON_LABELS, RECON_STATUSES } from "@/components/dashboard/recon-totals";
import { Card, DescriptionList, EmptyState, Grid, Kpi, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { ApiRequestError, qs } from "@/lib/api";
import { formatDateTime, formatDateTimeFull, formatMoney, formatNumber, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { ReconBatch, ReconItem } from "@/lib/types";

type Detail = ReconBatch & { items: ReconItem[]; error?: string | null };

export default async function ReconciliationBatchPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  let b: Detail;
  try {
    b = await api.get<Detail>(`/dashboard/reconciliation/batches/${params.id}${qs({ status: searchParams.status })}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }
  const t = b.totals;
  const issues = t.MISSING_PROVIDER + t.MISSING_NATIO + t.AMOUNT_MISMATCH + t.STATUS_MISMATCH;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/dashboard/reconciliation" className="hover:underline">{translateUi("Reconciliation")}</Link>
        }
        title={
          translateUi(<span className="flex items-center gap-3">
            <Mono className="text-[18px]">{b.id}</Mono>
            <StatusBadge status={b.status} />
            {translateUi(b.mode === "test" ? <StatusBadge status="test" label={translateUi("Sandbox")} /> : null)}
          </span>)
        }
        subtitle={translateUi(`${b.provider_name ?? "Provider"} · ${b.provider_account_name ?? ""} · ${titleCase(b.source)}${b.file_name ? ` · ${b.file_name}` : ""} · ${formatDateTime(b.created_at)}`)}
      />

      <Grid cols={6}>
        <Kpi label={translateUi("Rows compared")} value={formatNumber(t.total)} hint={issues ? `${formatNumber(issues)} need attention` : "No differences"} tone={issues ? "warn" : "ok"} />
        <Kpi label={translateUi("Matched")} value={formatNumber(t.MATCHED)} tone={t.MATCHED === t.total && t.total > 0 ? "ok" : "neutral"} hint={t.total ? `${Math.round((t.MATCHED / t.total) * 100)}% of rows` : undefined} />
        <Kpi label={translateUi("Missing at provider")} value={formatNumber(t.MISSING_PROVIDER)} tone={t.MISSING_PROVIDER ? "bad" : "neutral"} hint="NATIO successful, not in report" />
        <Kpi label={translateUi("Missing at NATIO")} value={formatNumber(t.MISSING_NATIO)} tone={t.MISSING_NATIO ? "bad" : "neutral"} hint="In report, unknown to NATIO" />
        <Kpi label={translateUi("Amount mismatch")} value={formatNumber(t.AMOUNT_MISMATCH)} tone={t.AMOUNT_MISMATCH ? "warn" : "neutral"} hint="Amount or currency differs" />
        <Kpi label={translateUi("Status mismatch")} value={formatNumber(t.STATUS_MISMATCH)} tone={t.STATUS_MISMATCH ? "warn" : "neutral"} hint="Outcome differs" />
      </Grid>

      <div className="mt-4">
        <Card title={translateUi("Batch")}>
          <DescriptionList
            cols={3}
            items={[
              { label: "Provider", value: b.provider_name ?? "—" },
              { label: "Provider account", value: b.provider_account_name ?? "—" },
              { label: "Provider account id", value: <Mono>{translateUi(b.provider_account_id)}</Mono> },
              { label: "Source", value: titleCase(b.source) },
              { label: "File", value: b.file_name ?? "—" },
              { label: "Period", value: b.period_start || b.period_end ? `${formatDateTimeFull(b.period_start)} – ${formatDateTimeFull(b.period_end)}` : "All time" },
              { label: "Created", value: formatDateTimeFull(b.created_at) },
              { label: "Completed", value: formatDateTimeFull(b.completed_at) },
              { label: "Error", value: b.error ? <span className="text-bad">{translateUi(b.error)}</span> : "—" },
            ]}
          />
        </Card>
      </div>

      <div className="mt-6">
        <FilterBar filters={[{ name: "status", label: "Result", type: "select", options: RECON_STATUSES.map((s) => ({ value: s, label: RECON_LABELS[s] })) }]} />
      </div>

      <Card title={translateUi("Items")} description={translateUi(searchParams.status ? `Showing ${RECON_LABELS[searchParams.status as keyof typeof RECON_LABELS] ?? searchParams.status} rows` : translateUi("Every compared row, grouped by result"))} padded={false}>
        {translateUi(b.items.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Result")}</th>
                <th>{translateUi("Transaction")}</th>
                <th>{translateUi("Payment")}</th>
                <th>{translateUi("Provider reference")}</th>
                <th className="num">{translateUi("NATIO amount")}</th>
                <th className="num">{translateUi("Provider amount")}</th>
                <th>{translateUi("Currency")}</th>
                <th>{translateUi("NATIO status")}</th>
                <th>{translateUi("Provider status")}</th>
                <th>{translateUi("Notes")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(b.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <StatusBadge status={it.status} label={translateUi(RECON_LABELS[it.status as keyof typeof RECON_LABELS] ?? titleCase(it.status))} />
                  </td>
                  <td>{translateUi(it.transaction_id ? <Mono>{translateUi(shortId(it.transaction_id, 10))}</Mono> : <span className="text-ink-400">—</span>)}</td>
                  <td>
                    {translateUi(it.payment_id ? (
                      <Link href={`/dashboard/payments/${it.payment_id}`} className="text-brand-600 hover:underline">
                        <Mono>{translateUi(shortId(it.payment_id, 8))}</Mono>
                      </Link>
                    ) : (
                      <span className="text-ink-400">—</span>
                    ))}
                  </td>
                  <td>{translateUi(it.provider_reference ? <Mono>{translateUi(it.provider_reference)}</Mono> : <span className="text-ink-400">—</span>)}</td>
                  <td className="num">{translateUi(formatMoney(it.natio_amount, it.currency))}</td>
                  <td className={"num " + (it.status === "AMOUNT_MISMATCH" ? "font-medium text-warn" : "")}>{translateUi(formatMoney(it.provider_amount, it.currency))}</td>
                  <td>{translateUi(it.currency ?? "—")}</td>
                  <td>{translateUi(it.natio_status ? <StatusBadge status={it.natio_status} /> : <span className="text-ink-400">—</span>)}</td>
                  <td>{translateUi(it.provider_status ? <Mono className={it.status === "STATUS_MISMATCH" ? "text-warn" : ""}>{translateUi(it.provider_status)}</Mono> : <span className="text-ink-400">—</span>)}</td>
                  <td className="max-w-[280px] truncate text-ink-600" title={translateUi(it.notes ?? undefined)}>
                    {translateUi(it.notes ?? "—")}
                  </td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No items")} description={translateUi(searchParams.status ? translateUi("No rows with this result in the batch.") : translateUi("The report and NATIO's ledger had nothing to compare for this account and period."))} />
        ))}
      </Card>
    </>
  );
}
