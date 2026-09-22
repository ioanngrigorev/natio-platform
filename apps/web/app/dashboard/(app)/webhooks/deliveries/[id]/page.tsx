import Link from "next/link";
import { notFound } from "next/navigation";
import { ResendDelivery } from "@/components/dashboard/webhook-endpoints";
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

export default async function WebhookDeliveryPage({ params }: { params: { id: string } }) {
  const api = serverApi();
  let d: Detail;
  try {
    d = await api.get<Detail>(`/dashboard/webhooks/deliveries/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }
  const objectId = (d.payload as { data?: { object?: { id?: string; object?: string } } })?.data?.object;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/dashboard/webhooks" className="hover:underline">
            Webhooks
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Mono className="text-[18px]">{d.event_type}</Mono>
            <StatusBadge status={d.status} />
          </span>
        }
        subtitle={
          <>
            Delivery <Mono>{d.id}</Mono> · event <Mono>{d.event_id}</Mono> · created {formatDateTime(d.created_at)}
          </>
        }
        actions={<ResendDelivery deliveryId={d.id} size="md" />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Delivery">
            <DescriptionList
              cols={3}
              items={[
                { label: "Endpoint", value: <span className="break-all">{d.endpoint_url ?? "—"}</span> },
                { label: "Endpoint id", value: <Mono>{d.endpoint_id}</Mono> },
                { label: "Status", value: <StatusBadge status={d.status} /> },
                { label: "Attempts", value: `${d.attempt_count} of ${d.max_attempts}` },
                { label: "Last HTTP status", value: d.last_response_status ?? "—" },
                { label: "Last error", value: d.last_error ? <span className="text-bad">{d.last_error}</span> : "—" },
                { label: "Next attempt", value: formatDateTimeFull(d.next_attempt_at) },
                { label: "Delivered", value: formatDateTimeFull(d.delivered_at) },
                {
                  label: "Related object",
                  value:
                    objectId?.id && objectId.object === "payment" && objectId.id.startsWith("pay_") ? (
                      <Link href={`/dashboard/payments/${objectId.id}`} className="text-brand-600 hover:underline">
                        <Mono>{objectId.id}</Mono>
                      </Link>
                    ) : objectId?.id && objectId.object === "payout" ? (
                      <Link href={`/dashboard/payouts/${objectId.id}`} className="text-brand-600 hover:underline">
                        <Mono>{objectId.id}</Mono>
                      </Link>
                    ) : objectId?.id ? (
                      <Mono>{objectId.id}</Mono>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Card>

          <Card title="Attempts" description="Every HTTP request NATIO made for this delivery" padded={false}>
            {d.attempts.length ? (
              <Table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th className="num">HTTP</th>
                    <th className="num">Duration</th>
                    <th>Error</th>
                    <th>Trigger</th>
                    <th>Time</th>
                    <th>Response body</th>
                  </tr>
                </thead>
                <tbody>
                  {d.attempts.map((a) => (
                    <tr key={a.id}>
                      <td className="num">{a.attempt_number}</td>
                      <td className="num">{a.response_status !== null ? <span className={a.response_status >= 200 && a.response_status < 300 ? "text-ok" : "text-bad"}>{a.response_status}</span> : "—"}</td>
                      <td className="num">{formatMs(a.duration_ms)}</td>
                      <td className="max-w-[220px] truncate" title={a.error ?? undefined}>
                        {a.error ? <span className="text-bad">{a.error}</span> : "—"}
                      </td>
                      <td>{a.manual ? <Tag tone="brand">manual</Tag> : <Tag>scheduled</Tag>}</td>
                      <td className="text-ink-500">{formatDateTimeFull(a.created_at)}</td>
                      <td className="max-w-[280px] truncate text-ink-600" title={a.response_body ?? undefined}>
                        <Mono>{truncate(a.response_body)}</Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No attempts yet" description={d.status === "pending" ? "The delivery is queued and will be sent shortly." : "No attempt has been recorded for this delivery."} />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Payload" description="Exactly what was POSTed; signed with the endpoint secret">
            <pre className="mono max-h-[640px] overflow-auto whitespace-pre-wrap break-all text-ink-700">{JSON.stringify(d.payload, null, 2)}</pre>
          </Card>
          {d.attempts[0]?.request_headers ? (
            <Card title="Request headers" description="From the first attempt; signature truncated">
              <pre className="mono whitespace-pre-wrap break-all text-ink-700">{JSON.stringify(d.attempts[0].request_headers, null, 2)}</pre>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
