import Link from "next/link";
import { ResendDelivery } from "@/components/admin/webhook-actions";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, Pagination, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Paginated, WebhookDelivery } from "@/lib/types";

export const metadata = { title: "Webhook deliveries" };

const STATUSES = ["pending", "delivering", "succeeded", "failed", "exhausted"];
const EVENT_TYPES = ["payment.created", "payment.processing", "payment.succeeded", "payment.failed", "payment.cancelled", "payment.refunded", "payout.created", "payout.paid", "payout.failed", "refund.succeeded"];

export default async function AdminWebhooksPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({ merchant_id: searchParams.merchant_id, status: searchParams.status, event_type: searchParams.event_type, cursor: searchParams.cursor, limit: 50 });
  const [page, merchants] = await Promise.all([api.get<Paginated<WebhookDelivery>>(`/admin/webhooks/deliveries${query}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?limit=500")]);
  const merchantName = new Map(merchants.data.map((m) => [m.id, m.name]));

  return (
    <>
      <PageHeader title="Webhook deliveries" subtitle={`Every webhook NATIO sent to merchant endpoints in ${api.mode} mode, with its attempts and responses. Failed deliveries retry with exponential backoff until the maximum is reached.`} />

      <FilterBar
        filters={[
          { name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "event_type", label: "Event type", type: "select", options: EVENT_TYPES.map((e) => ({ value: e, label: e })) },
        ]}
      />

      <Card padded={false}>
        {page.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Endpoint</th>
                <th>Merchant</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th className="num">Last HTTP</th>
                <th>Last error</th>
                <th>Created</th>
                <th>Delivered</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/admin/webhooks/${d.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{d.event_type}</Mono>
                    </Link>
                    <div className="text-[11px] text-ink-500">{shortId(d.event_id, 10)}</div>
                  </td>
                  <td className="max-w-[260px] truncate text-ink-600" title={d.endpoint_url ?? undefined}>
                    {d.endpoint_url ?? "—"}
                  </td>
                  <td>
                    <Link href={`/admin/merchants/${d.merchant_id}`} className="text-brand-600 hover:underline">
                      {merchantName.get(d.merchant_id) ?? shortId(d.merchant_id, 10)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="num">
                    {d.attempt_count} / {d.max_attempts}
                  </td>
                  <td className="num">{d.last_response_status !== null ? <span className={d.last_response_status >= 200 && d.last_response_status < 300 ? "text-ok" : "text-bad"}>{d.last_response_status}</span> : <span className="text-ink-400">—</span>}</td>
                  <td className="max-w-[220px] truncate" title={d.last_error ?? undefined}>
                    {d.last_error ? <span className="text-bad">{d.last_error}</span> : <span className="text-ink-400">—</span>}
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
          <EmptyState title="No webhook deliveries" description="Deliveries appear once merchants register endpoints and events are emitted in this mode." />
        )}
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/admin/webhooks" params={searchParams} />
      </Card>
    </>
  );
}
