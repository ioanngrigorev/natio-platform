import Link from "next/link";
import { notFound } from "next/navigation";
import { AttemptSyncButton, PaymentAdminActions } from "@/components/admin/payment-admin-actions";
import { Timeline } from "@/components/dashboard/timeline";
import { Card, DescriptionList, Mono, PageHeader, StatusBadge, Table, Tag } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime, formatDateTimeFull, formatMoney, formatMs, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminPaymentDetail } from "@/lib/admin-types";

function ctxValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default async function AdminPaymentDetailPage({ params }: { params: { id: string } }) {
  const api = serverApi();
  let p: AdminPaymentDetail;
  try {
    p = await api.get<AdminPaymentDetail>(`/admin/payments/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }
  const rd = p.routing_decision;
  const rk = p.risk_decision;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/admin/payments" className="hover:underline">
            Payments
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Mono className="text-[18px]">{p.id}</Mono>
            <StatusBadge status={p.status} />
            {p.mode === "test" ? <StatusBadge status="test" label="Sandbox" /> : null}
          </span>
        }
        subtitle={
          <span>
            {formatMoney(p.amount, p.currency)} · {titleCase(p.payment_method.type)} · created {formatDateTime(p.created_at)}
            {p.merchant ? (
              <>
                {" · "}
                <Link href={`/admin/merchants/${p.merchant.id}`} className="text-brand-600 hover:underline">
                  {p.merchant.name}
                </Link>
              </>
            ) : null}
          </span>
        }
        actions={<PaymentAdminActions payment={p} />}
      />

      {p.status === "pending" ? (
        <div className="mb-4 rounded-md border border-warn/20 bg-warn-bg px-3 py-2 text-[13px] text-warn">
          This payment is held for manual review{rk ? ` (risk score ${rk.score}, ${rk.matchedRules.length} matched rule${rk.matchedRules.length === 1 ? "" : "s"})` : ""}. Approve to route it to a provider, or reject to fail it.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Payment">
            <DescriptionList
              cols={3}
              items={[
                { label: "Merchant", value: p.merchant ? <Link href={`/admin/merchants/${p.merchant.id}`} className="text-brand-600 hover:underline">{p.merchant.name}</Link> : "—" },
                { label: "Amount", value: <span className="font-medium">{formatMoney(p.amount, p.currency)}</span> },
                { label: "Captured", value: formatMoney(p.captured_amount, p.currency) },
                { label: "Refunded", value: formatMoney(p.refunded_amount, p.currency) },
                { label: "Fee (provider)", value: formatMoney(p.fee.amount, p.currency) },
                { label: "Capture method", value: titleCase(p.capture_method) },
                { label: "Processing time", value: formatMs(p.processing_time_ms) },
                { label: "Country", value: p.country ?? "—" },
                { label: "Reference", value: p.reference ?? "—" },
                { label: "Description", value: p.description ?? "—" },
                { label: "Customer", value: p.customer ? <span>{p.customer.email ?? p.customer.name ?? p.customer.id}{p.customer.external_id ? <span className="text-ink-500"> · {p.customer.external_id}</span> : null}</span> : "—" },
                { label: "Test scenario", value: p.test_scenario ? <Mono>{p.test_scenario}</Mono> : "—" },
              ]}
            />
            {p.failure ? (
              <div className="mt-4 rounded-md border border-bad/20 bg-bad-bg px-3 py-2 text-[13px] text-bad">
                <span className="font-medium">{p.failure.code}</span> · {p.failure.message} <span className="text-[11px] uppercase tracking-wide">({p.failure.category} decline)</span>
              </div>
            ) : null}
            {p.next_action ? (
              <div className="mt-4 rounded-md border border-info/20 bg-info-bg px-3 py-2 text-[13px] text-info">
                Awaiting customer action ({p.next_action.type}).{" "}
                {p.next_action.url ? (
                  <a href={p.next_action.url} target="_blank" rel="noreferrer" className="font-medium underline">
                    Open sandbox hosted page
                  </a>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card title="Route" description="Provider selection and every attempt made for this payment">
            <DescriptionList
              cols={3}
              items={[
                { label: "Routing rule", value: p.route.rule ? (rd?.routingRuleId ? <Link href={`/admin/routing/${rd.routingRuleId}`} className="text-brand-600 hover:underline">{p.route.rule}</Link> : p.route.rule) : "Default scoring" },
                { label: "Provider", value: p.route.provider?.name ?? "—" },
                { label: "Provider account", value: p.route.provider_account_name ?? "—" },
                { label: "Provider payment id", value: p.route.provider_payment_id ? <Mono>{p.route.provider_payment_id}</Mono> : "—" },
                { label: "Attempts", value: p.route.attempts },
                { label: "Routing decision", value: p.route.routing_decision_id ? <Mono>{p.route.routing_decision_id}</Mono> : "—" },
              ]}
            />
            {p.attempts?.length ? (
              <div className="mt-4">
                <Table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Outcome</th>
                      <th>Provider response</th>
                      <th className="num">Latency</th>
                      <th className="num">Fee</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.attempts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.attempt_number}</td>
                        <td>
                          {a.provider_name}
                          <div className="text-[11px] text-ink-500">{a.provider_account_name}</div>
                        </td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                        <td>{a.outcome ? <Mono>{a.outcome}</Mono> : "—"}</td>
                        <td className="max-w-[260px] truncate text-ink-600">{[a.provider_code, a.provider_message].filter(Boolean).join(" · ") || (a.provider_payment_id ? <Mono>{a.provider_payment_id}</Mono> : "—")}</td>
                        <td className="num">{formatMs(a.latency_ms)}</td>
                        <td className="num">{formatMoney(a.fee_amount, p.currency)}</td>
                        <td className="text-right">{a.status === "unknown" ? <AttemptSyncButton attemptId={a.id} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : null}
          </Card>

          <Card title="Routing decision" description={rd ? `${rd.ruleName ? `Rule "${rd.ruleName}"` : "No rule matched"} · strategy ${rd.strategy} · evaluated ${formatDateTimeFull(rd.evaluatedAt)}` : "Recorded when the engine selects a provider"} padded={false}>
            {rd ? (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-ink-100 px-4 py-3 text-[12px] sm:grid-cols-4">
                  {Object.entries(rd.context).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{k.replace(/_/g, " ")}</div>
                      <div className="truncate text-ink-800" title={ctxValue(v)}>
                        {ctxValue(v)}
                      </div>
                    </div>
                  ))}
                </div>
                {rd.candidates.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Eligible</th>
                        <th className="num">Score</th>
                        <th>Reasons</th>
                        <th>Factors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rd.candidates.map((c) => (
                        <tr key={c.providerAccountId} className={c.providerAccountId === rd.selectedProviderAccountId ? "bg-brand-50/60" : undefined}>
                          <td>
                            <div className="font-medium">
                              {c.providerName}
                              {c.providerAccountId === rd.selectedProviderAccountId ? <Tag tone="brand">selected</Tag> : null}
                            </div>
                            <div className="text-[11px] text-ink-500">{c.accountName}</div>
                          </td>
                          <td>
                            <StatusBadge status={c.eligible ? "ok" : "rejected"} label={c.eligible ? "eligible" : "excluded"} />
                          </td>
                          <td className="num">{c.score.toFixed(3)}</td>
                          <td>
                            {c.reasons.length ? (
                              <span className="flex flex-wrap gap-1">
                                {c.reasons.map((r) => (
                                  <Tag key={r} tone="bad">
                                    {r}
                                  </Tag>
                                ))}
                              </span>
                            ) : (
                              <span className="text-ink-400">—</span>
                            )}
                          </td>
                          <td className="text-[11.5px] text-ink-600">
                            {c.factors
                              ? Object.entries(c.factors)
                                  .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                                  .join(" · ")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="px-4 py-6 text-[13px] text-ink-500">No candidates were evaluated.</div>
                )}
              </>
            ) : (
              <div className="px-4 py-6 text-[13px] text-ink-500">No routing decision yet (payment not routed).</div>
            )}
          </Card>

          <Card title="Risk decision" description={rk ? `Evaluated ${formatDateTimeFull(rk.createdAt)}` : "Recorded when the risk engine assesses the payment"}>
            {rk ? (
              <>
                <DescriptionList
                  cols={3}
                  items={[
                    { label: "Decision", value: <StatusBadge status={rk.decision} /> },
                    { label: "Score", value: rk.score },
                    { label: "Review outcome", value: rk.reviewOutcome ? <span>{titleCase(rk.reviewOutcome)}{rk.reviewedAt ? <span className="text-ink-500"> · {formatDateTime(rk.reviewedAt)}</span> : null}</span> : "—" },
                  ]}
                />
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">Matched rules</div>
                    {rk.matchedRules.length ? (
                      <ul className="space-y-1 text-[13px]">
                        {rk.matchedRules.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2">
                            <span>{r.name}</span>
                            <span className="flex items-center gap-1">
                              <StatusBadge status={r.action} />
                              <span className="tabular text-ink-500">+{r.score}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[13px] text-ink-400">No rules matched.</div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">Signals</div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                      {Object.entries(rk.signals).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-ink-500">{k.replace(/_/g, " ")}</dt>
                          <dd className="tabular text-ink-800">{ctxValue(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-[13px] text-ink-500">No risk decision recorded.</div>
            )}
          </Card>

          {p.refunds.length ? (
            <Card title="Refunds" padded={false}>
              <Table>
                <thead>
                  <tr>
                    <th>Refund</th>
                    <th>Status</th>
                    <th className="num">Amount</th>
                    <th>Reason</th>
                    <th>Provider ref</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {p.refunds.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Mono>{r.id}</Mono>
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="num">{formatMoney(r.amount, r.currency)}</td>
                      <td>{r.reason ?? "—"}</td>
                      <td>{r.provider_refund_id ? <Mono>{r.provider_refund_id}</Mono> : "—"}</td>
                      <td className="text-ink-500">{formatDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card title="Timeline" description="What NATIO did, step by step">
            <Timeline events={p.timeline} />
          </Card>
          {Object.keys(p.metadata ?? {}).length ? (
            <Card title="Metadata">
              <pre className="mono whitespace-pre-wrap text-ink-700">{JSON.stringify(p.metadata, null, 2)}</pre>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
