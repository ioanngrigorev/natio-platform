import Link from "next/link";
import { FilterBar } from "@/components/dashboard/filters";
import { AddWebhookEndpoint, EndpointActions, ResendDelivery } from "@/components/dashboard/webhook-endpoints";
import { WebhookTestButton } from "@/components/dashboard/webhook-test-button";
import { Card, EmptyState, Mono, PageHeader, Pagination, StatusBadge, Table, Tag } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Paginated, WebhookDelivery, WebhookEndpoint } from "@/lib/types";

export const metadata = { title: "Webhooks" };

const DELIVERY_STATUSES = ["pending", "delivering", "succeeded", "failed", "exhausted"];

export default async function WebhooksPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({ status: searchParams.status, event_type: searchParams.event_type, endpoint_id: searchParams.endpoint_id, cursor: searchParams.cursor, limit: 50 });
  const [endpoints, deliveries] = await Promise.all([api.get<{ data: WebhookEndpoint[]; event_types: string[] }>("/dashboard/webhooks/endpoints"), api.get<Paginated<WebhookDelivery>>(`/dashboard/webhooks/deliveries${query}`)]);

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle={`Endpoints receiving ${api.mode} events, and the delivery log with retries.`}
        actions={
          <>
            <WebhookTestButton />
            <AddWebhookEndpoint eventTypes={endpoints.event_types} />
          </>
        }
      />

      <Card title="Endpoints" description="Each endpoint has its own signing secret. Disabled endpoints keep their history but receive nothing." padded={false} className="mb-6">
        {endpoints.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Description</th>
                <th>Events</th>
                <th>Status</th>
                <th>Secret</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.data.map((e) => (
                <tr key={e.id}>
                  <td className="max-w-[320px]">
                    <div className="truncate font-medium" title={e.url}>
                      {e.url}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      <Mono>{shortId(e.id, 8)}</Mono>
                    </div>
                  </td>
                  <td className="max-w-[200px] truncate text-ink-600">{e.description ?? "—"}</td>
                  <td className="max-w-[320px] whitespace-normal">
                    {e.events.length ? (
                      <div className="flex flex-wrap gap-1">
                        {e.events.map((ev) => (
                          <Tag key={ev}>{ev}</Tag>
                        ))}
                      </div>
                    ) : (
                      <Tag tone="brand">all events</Tag>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td>
                    <Mono>{e.secret_prefix}…</Mono>
                  </td>
                  <td className="text-ink-500">{formatDateTime(e.created_at)}</td>
                  <td>
                    <EndpointActions endpoint={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={`No ${api.mode} endpoints`} description="Add an endpoint to receive payment, refund, payout and settlement events." action={<AddWebhookEndpoint eventTypes={endpoints.event_types} />} />
        )}
      </Card>

      <h2 className="mb-2 text-[13px] font-semibold text-ink-900">Deliveries</h2>
      <FilterBar
        filters={[
          { name: "status", label: "Status", type: "select", options: DELIVERY_STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "event_type", label: "Event type", type: "select", options: endpoints.event_types.map((t) => ({ value: t, label: t })) },
        ]}
      />
      <Card padded={false}>
        {deliveries.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th className="num">HTTP</th>
                <th>Last error</th>
                <th>Created</th>
                <th>Delivered</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/dashboard/webhooks/deliveries/${d.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{d.event_type}</Mono>
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      <Mono>{shortId(d.id, 8)}</Mono>
                    </div>
                  </td>
                  <td className="max-w-[240px] truncate text-ink-600" title={d.endpoint_url ?? undefined}>
                    {d.endpoint_url ?? "—"}
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="num">
                    {d.attempt_count}/{d.max_attempts}
                  </td>
                  <td className="num">{d.last_response_status ?? "—"}</td>
                  <td className="max-w-[220px] truncate text-ink-600" title={d.last_error ?? undefined}>
                    {d.last_error ? <span className="text-bad">{d.last_error}</span> : "—"}
                  </td>
                  <td className="text-ink-500">{formatDateTime(d.created_at)}</td>
                  <td className="text-ink-500">{formatDateTime(d.delivered_at)}</td>
                  <td className="text-right">
                    <ResendDelivery deliveryId={d.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No deliveries" description="Deliveries are created for every event that matches an endpoint's subscription. Use “Send test event” to generate one." />
        )}
        <Pagination hasMore={deliveries.has_more} nextCursor={deliveries.next_cursor} baseHref="/dashboard/webhooks" params={searchParams} />
      </Card>
    </>
  );
}
