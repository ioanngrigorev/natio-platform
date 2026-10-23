
import {getI18n} from '@/lib/i18n/server';
import { PaymentPricing } from "@/components/admin/payment-pricing";
import { EntityLink } from "@/components/admin/entity-link";
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
 const {t:translateUi,locale:uiLocale}=getI18n();

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
          <Link href="/admin/payments" className="hover:underline">{translateUi("Payments")}</Link>
        }
        title={
          translateUi(<span className="flex items-center gap-3">
            <Mono className="text-[18px]">{p.id}</Mono>
            <StatusBadge status={p.status} />
            {translateUi(p.mode === "test" ? <StatusBadge status="test" label={translateUi("Sandbox")} /> : null)}
          </span>)
        }
        subtitle={
          translateUi(<span>
            {translateUi(formatMoney(p.amount, p.currency))} · {translateUi(titleCase(p.payment_method.type))}{translateUi(" · created ")}{translateUi(formatDateTime(p.created_at))}
            {translateUi(p.merchant ? (
              <>
                {translateUi(" · ")}
                <Link href={`/admin/merchants/${p.merchant.id}`} className="text-brand-600 hover:underline">
                  {p.merchant.name}
                </Link>
              </>
            ) : null)}
          </span>)
        }
        actions={<PaymentAdminActions payment={p} />}
      />

      {translateUi(p.status === "pending" ? (
        <div className="mb-4 rounded-md border border-warn/20 bg-warn-bg px-3 py-2 text-[13px] text-warn">{translateUi("This payment is held for manual review")}{translateUi(rk ? ` (risk score ${rk.score}, ${rk.matchedRules.length} matched rule${rk.matchedRules.length === 1 ? "" : "s"})` : "")}{translateUi(". Approve to route it to a provider, or reject to fail it.")}</div>
      ) : null)}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <PaymentPricing id={p.id}/>
          <Card title={translateUi("Payment")}>
            <DescriptionList
              cols={3}
              items={[
                { label: "Merchant", value: p.merchant ? <Link href={`/admin/merchants/${p.merchant.id}`} className="text-brand-600 hover:underline">{p.merchant.name}</Link> : "—" },
                { label: "Amount", value: <span className="font-medium">{translateUi(formatMoney(p.amount, p.currency))}</span> },
                { label: "Captured", value: formatMoney(p.captured_amount, p.currency) },
                { label: "Refunded", value: formatMoney(p.refunded_amount, p.currency) },
                { label: "Merchant fee", value: formatMoney(p.fee.amount, p.currency) },
                { label: "Capture method", value: titleCase(p.capture_method) },
                { label: "Processing time", value: formatMs(p.processing_time_ms) },
                { label: "Country", value: p.country ?? "—" },
                { label: "Reference", value: p.reference ?? "—" },
                { label: "Description", value: p.description ?? "—" },
                { label: "Customer", value: p.customer ? <span>{p.customer.email ?? p.customer.name ?? p.customer.id}{translateUi(p.customer.external_id ? <span className="text-ink-500"> · {translateUi(p.customer.external_id)}</span> : null)}</span> : "—" },
                { label: "Test scenario", value: p.test_scenario ? <Mono>{translateUi(p.test_scenario)}</Mono> : "—" },
              ]}
            />
            {translateUi(p.failure ? (
              <div className="mt-4 rounded-md border border-bad/20 bg-bad-bg px-3 py-2 text-[13px] text-bad">
                <span className="font-medium">{translateUi(p.failure.code)}</span> · {translateUi(p.failure.message)} <span className="text-[11px] uppercase tracking-wide">({translateUi(p.failure.category)}{translateUi(" decline)")}</span>
              </div>
            ) : null)}
            {translateUi(p.next_action ? (
              <div className="mt-4 rounded-md border border-info/20 bg-info-bg px-3 py-2 text-[13px] text-info">{translateUi("Awaiting customer action (")}{translateUi(p.next_action.type)}).{translateUi(" ")}
                {translateUi(p.next_action.url ? (
                  <a href={p.next_action.url} target="_blank" rel="noreferrer" className="font-medium underline">{translateUi("Open sandbox hosted page")}</a>
                ) : null)}
              </div>
            ) : null)}
          </Card>

          <Card title={translateUi("Route")} description={translateUi("Provider selection and every attempt made for this payment")}>
            <DescriptionList
              cols={3}
              items={[
                { label: "Routing rule", value: p.route.rule ? (rd?.routingRuleId ? <Link href={`/admin/routing/${rd.routingRuleId}`} className="text-brand-600 hover:underline">{translateUi(p.route.rule)}</Link> : p.route.rule) : "Default scoring" },
                { label: "Provider", value: p.route.provider?.name ?? "—" },
                { label: "Provider account", value: <EntityLink kind="provider-accounts" id={p.route.provider_account_id}>{translateUi(p.route.provider_account_name)}</EntityLink> },
                { label: "Provider payment id", value: p.route.provider_payment_id ? <Mono>{translateUi(p.route.provider_payment_id)}</Mono> : "—" },
                { label: "Attempts", value: p.route.attempts },
                { label: "Routing decision", value: p.route.routing_decision_id ? <Mono>{translateUi(p.route.routing_decision_id)}</Mono> : "—" },
              ]}
            />
            {translateUi(p.attempts?.length ? (
              <div className="mt-4">
                <Table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{translateUi("Provider")}</th>
                      <th>{translateUi("Status")}</th>
                      <th>{translateUi("Outcome")}</th>
                      <th>{translateUi("Provider response")}</th>
                      <th className="num">{translateUi("Latency")}</th>
                      <th className="num">{translateUi("Fee")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {translateUi(p.attempts.map((a) => (
                      <tr key={a.id}>
                        <td>{translateUi(a.attempt_number)}</td>
                        <td>
                          {translateUi(a.provider_name)}
                          <div className="text-[11px] text-ink-500">{translateUi(a.provider_account_name)}</div>
                        </td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                        <td>{translateUi(a.outcome ? <Mono>{translateUi(a.outcome)}</Mono> : "—")}</td>
                        <td className="max-w-[260px] truncate text-ink-600">{translateUi([a.provider_code, a.provider_message].filter(Boolean).join(" · ") || (a.provider_payment_id ? <Mono>{translateUi(a.provider_payment_id)}</Mono> : "—"))}</td>
                        <td className="num">{translateUi(formatMs(a.latency_ms))}</td>
                        <td className="num">{translateUi(formatMoney(a.fee_amount, p.currency))}</td>
                        <td className="text-right">{translateUi(a.status === "unknown" ? <AttemptSyncButton attemptId={a.id} /> : null)}</td>
                      </tr>
                    )))}
                  </tbody>
                </Table>
              </div>
            ) : null)}
          </Card>

          <Card title={translateUi("Routing decision")} description={translateUi(rd ? `${rd.ruleName ? `Rule "${rd.ruleName}"` : "No rule matched"} · strategy ${rd.strategy} · evaluated ${formatDateTimeFull(rd.evaluatedAt)}` : translateUi("Recorded when the engine selects a provider"))} padded={false}>
            {translateUi(rd ? (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-ink-100 px-4 py-3 text-[12px] sm:grid-cols-4">
                  {translateUi(Object.entries(rd.context).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{translateUi(k.replace(/_/g, " "))}</div>
                      <div className="truncate text-ink-800" title={translateUi(ctxValue(v))}>
                        {translateUi(ctxValue(v))}
                      </div>
                    </div>
                  )))}
                </div>
                {translateUi(rd.candidates.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <th>{translateUi("Provider")}</th>
                        <th>{translateUi("Eligible")}</th>
                        <th className="num">{translateUi("Score")}</th>
                        <th>{translateUi("Reasons")}</th>
                        <th>{translateUi("Factors")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {translateUi(rd.candidates.map((c) => (
                        <tr key={c.providerAccountId} className={c.providerAccountId === rd.selectedProviderAccountId ? "bg-brand-50/60" : undefined}>
                          <td>
                            <div className="font-medium">
                              {translateUi(c.providerName)}
                              {translateUi(c.providerAccountId === rd.selectedProviderAccountId ? <Tag tone="brand">{translateUi("selected")}</Tag> : null)}
                            </div>
                            <div className="text-[11px] text-ink-500">{translateUi(c.accountName)}</div>
                          </td>
                          <td>
                            <StatusBadge status={c.eligible ? "ok" : "rejected"} label={translateUi(c.eligible ? translateUi("eligible") : translateUi("excluded"))} />
                          </td>
                          <td className="num">{translateUi(c.score.toFixed(3))}</td>
                          <td>
                            {translateUi(c.reasons.length ? (
                              <span className="flex flex-wrap gap-1">
                                {translateUi(c.reasons.map((r) => (
                                  <Tag key={r} tone="bad">
                                    {translateUi(r)}
                                  </Tag>
                                )))}
                              </span>
                            ) : (
                              <span className="text-ink-400">—</span>
                            ))}
                          </td>
                          <td className="text-[11.5px] text-ink-600">
                            {translateUi(c.factors
                              ? Object.entries(c.factors)
                                  .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                                  .join(" · ")
                              : "—")}
                          </td>
                        </tr>
                      )))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="px-4 py-6 text-[13px] text-ink-500">{translateUi("No candidates were evaluated.")}</div>
                ))}
              </>
            ) : (
              <div className="px-4 py-6 text-[13px] text-ink-500">{translateUi("No routing decision yet (payment not routed).")}</div>
            ))}
          </Card>

          <Card title={translateUi("Risk decision")} description={translateUi(rk ? `Evaluated ${formatDateTimeFull(rk.createdAt)}` : translateUi("Recorded when the risk engine assesses the payment"))}>
            {translateUi(rk ? (
              <>
                <DescriptionList
                  cols={3}
                  items={[
                    { label: "Decision", value: <StatusBadge status={rk.decision} /> },
                    { label: "Score", value: rk.score },
                    { label: "Review outcome", value: rk.reviewOutcome ? <span>{translateUi(titleCase(rk.reviewOutcome))}{translateUi(rk.reviewedAt ? <span className="text-ink-500"> · {translateUi(formatDateTime(rk.reviewedAt))}</span> : null)}</span> : "—" },
                  ]}
                />
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{translateUi("Matched rules")}</div>
                    {translateUi(rk.matchedRules.length ? (
                      <ul className="space-y-1 text-[13px]">
                        {translateUi(rk.matchedRules.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2">
                            <span>{r.name}</span>
                            <span className="flex items-center gap-1">
                              <StatusBadge status={r.action} />
                              <span className="tabular text-ink-500">+{translateUi(r.score)}</span>
                            </span>
                          </li>
                        )))}
                      </ul>
                    ) : (
                      <div className="text-[13px] text-ink-400">{translateUi("No rules matched.")}</div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{translateUi("Signals")}</div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                      {translateUi(Object.entries(rk.signals).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-ink-500">{translateUi(k.replace(/_/g, " "))}</dt>
                          <dd className="tabular text-ink-800">{translateUi(ctxValue(v))}</dd>
                        </div>
                      )))}
                    </dl>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-[13px] text-ink-500">{translateUi("No risk decision recorded.")}</div>
            ))}
          </Card>

          {translateUi(p.refunds.length ? (
            <Card title={translateUi("Refunds")} padded={false}>
              <Table>
                <thead>
                  <tr>
                    <th>{translateUi("Refund")}</th>
                    <th>{translateUi("Status")}</th>
                    <th className="num">{translateUi("Amount")}</th>
                    <th>{translateUi("Reason")}</th>
                    <th>{translateUi("Provider ref")}</th>
                    <th>{translateUi("Created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {translateUi(p.refunds.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Mono>{r.id}</Mono>
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="num">{translateUi(formatMoney(r.amount, r.currency))}</td>
                      <td>{translateUi(r.reason ?? "—")}</td>
                      <td>{translateUi(r.provider_refund_id ? <Mono>{translateUi(r.provider_refund_id)}</Mono> : "—")}</td>
                      <td className="text-ink-500">{translateUi(formatDateTime(r.created_at))}</td>
                    </tr>
                  )))}
                </tbody>
              </Table>
            </Card>
          ) : null)}
        </div>

        <div className="space-y-4">
          <Card title={translateUi("Timeline")} description={translateUi("What NATIO did, step by step")}>
            <Timeline events={p.timeline} />
          </Card>
          {translateUi(Object.keys(p.metadata ?? {}).length ? (
            <Card title={translateUi("Metadata")}>
              <pre className="mono whitespace-pre-wrap text-ink-700">{JSON.stringify(p.metadata, null, 2)}</pre>
            </Card>
          ) : null)}
        </div>
      </div>
    </>
  );
}
