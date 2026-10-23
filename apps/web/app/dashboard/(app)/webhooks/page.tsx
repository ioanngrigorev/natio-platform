
import {getI18n} from '@/lib/i18n/server';
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

export default async function WebhooksPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const query = qs({ status: searchParams.status, event_type: searchParams.event_type, endpoint_id: searchParams.endpoint_id, cursor: searchParams.cursor, limit: 50 });
  const [endpoints, deliveries] = await Promise.all([api.get<{ data: WebhookEndpoint[]; event_types: string[] }>("/dashboard/webhooks/endpoints"), api.get<Paginated<WebhookDelivery>>(`/dashboard/webhooks/deliveries${query}`)]);

  return (
    <>
      <PageHeader
        title={translateUi("Webhooks")}
        subtitle={translateUi(`Endpoints receiving ${api.mode} events, and the delivery log with retries.`)}
        actions={
          <>
            <WebhookTestButton />
            <AddWebhookEndpoint eventTypes={endpoints.event_types} />
          </>
        }
      />

      <Card title={translateUi("Endpoints")} description={translateUi("Each endpoint has its own signing secret. Disabled endpoints keep their history but receive nothing.")} padded={false} className="mb-6">
        {translateUi(endpoints.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("URL")}</th>
                <th>{translateUi("Description")}</th>
                <th>{translateUi("Events")}</th>
                <th>{translateUi("Status")}</th>
                <th>{translateUi("Secret")}</th>
                <th>{translateUi("Created")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {translateUi(endpoints.data.map((e) => (
                <tr key={e.id}>
                  <td className="max-w-[320px]">
                    <div className="truncate font-medium" title={translateUi(e.url)}>
                      {translateUi(e.url)}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      <Mono>{translateUi(shortId(e.id, 8))}</Mono>
                    </div>
                  </td>
                  <td className="max-w-[200px] truncate text-ink-600">{translateUi(e.description ?? "—")}</td>
                  <td className="max-w-[320px] whitespace-normal">
                    {translateUi(e.events.length ? (
                      <div className="flex flex-wrap gap-1">
                        {translateUi(e.events.map((ev) => (
                          <Tag key={ev}>{translateUi(ev)}</Tag>
                        )))}
                      </div>
                    ) : (
                      <Tag tone="brand">{translateUi("all events")}</Tag>
                    ))}
                  </td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td>
                    <Mono>{translateUi(e.secret_prefix)}…</Mono>
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(e.created_at))}</td>
                  <td>
                    <EndpointActions endpoint={e} />
                  </td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi(`No ${api.mode} endpoints`)} description={translateUi("Add an endpoint to receive payment, refund, payout and settlement events.")} action={<AddWebhookEndpoint eventTypes={endpoints.event_types} />} />
        ))}
      </Card>

      <h2 className="mb-2 text-[13px] font-semibold text-ink-900">{translateUi("Deliveries")}</h2>
      <FilterBar
        filters={[
          { name: "status", label: "Status", type: "select", options: DELIVERY_STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "event_type", label: "Event type", type: "select", options: endpoints.event_types.map((t) => ({ value: t, label: t })) },
        ]}
      />
      <Card padded={false}>
        {translateUi(deliveries.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Event")}</th>
                <th>{translateUi("Endpoint")}</th>
                <th>{translateUi("Status")}</th>
                <th className="num">{translateUi("Attempts")}</th>
                <th className="num">{translateUi("HTTP")}</th>
                <th>{translateUi("Last error")}</th>
                <th>{translateUi("Created")}</th>
                <th>{translateUi("Delivered")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {translateUi(deliveries.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/dashboard/webhooks/deliveries/${d.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{translateUi(d.event_type)}</Mono>
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      <Mono>{translateUi(shortId(d.id, 8))}</Mono>
                    </div>
                  </td>
                  <td className="max-w-[240px] truncate text-ink-600" title={translateUi(d.endpoint_url ?? undefined)}>
                    {translateUi(d.endpoint_url ?? "—")}
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="num">
                    {translateUi(d.attempt_count)}/{translateUi(d.max_attempts)}
                  </td>
                  <td className="num">{translateUi(d.last_response_status ?? "—")}</td>
                  <td className="max-w-[220px] truncate text-ink-600" title={translateUi(d.last_error ?? undefined)}>
                    {translateUi(d.last_error ? <span className="text-bad">{translateUi(d.last_error)}</span> : "—")}
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(d.created_at))}</td>
                  <td className="text-ink-500">{translateUi(formatDateTime(d.delivered_at))}</td>
                  <td className="text-right">
                    <ResendDelivery deliveryId={d.id} />
                  </td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No deliveries")} description={translateUi("Deliveries are created for every event that matches an endpoint's subscription. Use “Send test event” to generate one.")} />
        ))}
        <Pagination hasMore={deliveries.has_more} nextCursor={deliveries.next_cursor} baseHref="/dashboard/webhooks" params={searchParams} />
      </Card>
    </>
  );
}
