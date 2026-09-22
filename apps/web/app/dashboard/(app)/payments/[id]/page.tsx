import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentActions } from "@/components/dashboard/payment-actions";
import { Timeline } from "@/components/dashboard/timeline";
import { Card, DescriptionList, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime, formatMoney, formatMs, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Payment, Refund, TimelineEvent, WebhookDelivery } from "@/lib/types";

type Detail = Payment & { timeline: TimelineEvent[]; refunds: Refund[]; webhook_deliveries: WebhookDelivery[] };

export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const api = serverApi();
  let p: Detail;
  try {
    p = await api.get<Detail>(`/dashboard/payments/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/dashboard/payments" className="hover:underline">
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
        subtitle={`${formatMoney(p.amount, p.currency)} · ${titleCase(p.payment_method.type)} · created ${formatDateTime(p.created_at)}`}
        actions={<PaymentActions payment={p} />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Payment">
            <DescriptionList
              cols={3}
              items={[
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
                { label: "Risk score", value: p.risk.score ?? "—" },
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
                { label: "Routing rule", value: p.route.rule ?? "Default scoring" },
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
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : null}
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

          <Card title="Webhook deliveries" description="Notifications sent to your endpoints for this payment" padded={false}>
            {p.webhook_deliveries.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Endpoint</th>
                    <th>Status</th>
                    <th className="num">Attempts</th>
                    <th className="num">HTTP</th>
                    <th>Last attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {p.webhook_deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/dashboard/webhooks/deliveries/${d.id}`} className="text-brand-600 hover:underline">
                          <Mono>{d.event_type}</Mono>
                        </Link>
                      </td>
                      <td className="max-w-[220px] truncate text-ink-600">{d.endpoint_url}</td>
                      <td>
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="num">
                        {d.attempt_count}/{d.max_attempts}
                      </td>
                      <td className="num">{d.last_response_status ?? "—"}</td>
                      <td className="text-ink-500">{formatDateTime(d.delivered_at ?? d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="px-4 py-6 text-[13px] text-ink-500">No webhook endpoints were subscribed when this payment was processed.</div>
            )}
          </Card>
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
