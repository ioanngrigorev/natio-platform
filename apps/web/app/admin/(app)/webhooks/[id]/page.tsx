
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResendDelivery } from "@/components/admin/webhook-actions";
import { Card, DescriptionList, EmptyState, Mono, PageHeader, StatusBadge, Table, Tag } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime, formatDateTimeFull, formatMs } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { WebhookDelivery } from "@/lib/types";

type Detail = WebhookDelivery & { attempts: NonNullable<WebhookDelivery["attempts"]> };

function truncate(s: string | null, n = 160): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default async function AdminWebhookDeliveryPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  let d: Detail;
  try {
    d = await api.get<Detail>(`/admin/webhooks/deliveries/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }
  const object = (d.payload as { data?: { object?: { id?: string; object?: string } } })?.data?.object;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/admin/webhooks" className="hover:underline">{translateUi("Webhook deliveries")}</Link>
        }
        title={
          translateUi(<span className="flex items-center gap-3">
            <Mono className="text-[18px]">{translateUi(d.event_type)}</Mono>
            <StatusBadge status={d.status} />
          </span>)
        }
        subtitle={
          translateUi(<>{translateUi("Delivery ")}<Mono>{d.id}</Mono>{translateUi(" · event ")}<Mono>{translateUi(d.event_id)}</Mono>{translateUi(" · created ")}{translateUi(formatDateTime(d.created_at))}
          </>)
        }
        actions={<ResendDelivery deliveryId={d.id} size="md" />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={translateUi("Delivery")}>
            <DescriptionList
              cols={3}
              items={[
                { label: "Endpoint", value: <span className="break-all">{translateUi(d.endpoint_url ?? "—")}</span> },
                { label: "Endpoint id", value: <Mono>{translateUi(d.endpoint_id)}</Mono> },
                {
                  label: "Merchant",
                  value: (
                    <Link href={`/admin/merchants/${d.merchant_id}`} className="text-brand-600 hover:underline">
                      <Mono>{translateUi(d.merchant_id)}</Mono>
                    </Link>
                  ),
                },
                { label: "Status", value: <StatusBadge status={d.status} /> },
                { label: "Attempts", value: `${d.attempt_count} of ${d.max_attempts}` },
                { label: "Last HTTP status", value: d.last_response_status ?? "—" },
                { label: "Last error", value: d.last_error ? <span className="text-bad">{translateUi(d.last_error)}</span> : "—" },
                { label: "Next attempt", value: formatDateTimeFull(d.next_attempt_at) },
                { label: "Delivered", value: formatDateTimeFull(d.delivered_at) },
                {
                  label: "Related object",
                  value:
                    object?.id && object.object === "payment" ? (
                      <Link href={`/admin/payments/${object.id}`} className="text-brand-600 hover:underline">
                        <Mono>{object.id}</Mono>
                      </Link>
                    ) : object?.id && object.object === "payout" ? (
                      <Link href={`/admin/payouts/${object.id}`} className="text-brand-600 hover:underline">
                        <Mono>{object.id}</Mono>
                      </Link>
                    ) : object?.id ? (
                      <Mono>{object.id}</Mono>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Card>

          <Card title={translateUi("Attempts")} description={translateUi("Every HTTP request NATIO made for this delivery")} padded={false}>
            {translateUi(d.attempts.length ? (
              <Table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th className="num">{translateUi("HTTP")}</th>
                    <th className="num">{translateUi("Duration")}</th>
                    <th>{translateUi("Error")}</th>
                    <th>{translateUi("Trigger")}</th>
                    <th>{translateUi("Time")}</th>
                    <th>{translateUi("Response body")}</th>
                  </tr>
                </thead>
                <tbody>
                  {translateUi(d.attempts.map((a) => (
                    <tr key={a.id}>
                      <td className="num">{translateUi(a.attempt_number)}</td>
                      <td className="num">{translateUi(a.response_status !== null ? <span className={a.response_status >= 200 && a.response_status < 300 ? "text-ok" : "text-bad"}>{translateUi(a.response_status)}</span> : "—")}</td>
                      <td className="num">{translateUi(formatMs(a.duration_ms))}</td>
                      <td className="max-w-[220px] truncate" title={translateUi(a.error ?? undefined)}>
                        {translateUi(a.error ? <span className="text-bad">{translateUi(a.error)}</span> : "—")}
                      </td>
                      <td>{translateUi(a.manual ? <Tag tone="brand">{translateUi("manual")}</Tag> : <Tag>{translateUi("scheduled")}</Tag>)}</td>
                      <td className="text-ink-500">{translateUi(formatDateTimeFull(a.created_at))}</td>
                      <td className="max-w-[280px] truncate text-ink-600" title={translateUi(a.response_body ?? undefined)}>
                        <Mono>{translateUi(truncate(a.response_body))}</Mono>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title={translateUi("No attempts yet")} description={translateUi(d.status === "pending" ? translateUi("The delivery is queued and will be sent shortly.") : translateUi("No attempt has been recorded for this delivery."))} />
            ))}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={translateUi("Payload")} description={translateUi("Exactly what was POSTed; signed with the endpoint secret")}>
            <pre className="mono max-h-[640px] overflow-auto whitespace-pre-wrap break-all text-ink-700">{JSON.stringify(d.payload, null, 2)}</pre>
          </Card>
          {translateUi(d.attempts[0]?.request_headers ? (
            <Card title={translateUi("Request headers")} description={translateUi("From the first attempt; signature truncated")}>
              <pre className="mono whitespace-pre-wrap break-all text-ink-700">{JSON.stringify(d.attempts[0].request_headers, null, 2)}</pre>
            </Card>
          ) : null)}
        </div>
      </div>
    </>
  );
}
