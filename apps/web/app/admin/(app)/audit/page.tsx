import { AuditRow } from "@/components/admin/audit-row";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { AuditEntry } from "@/lib/types";

export const metadata = { title: "Audit log" };

const ACTOR_TYPES = ["admin_user", "merchant_user", "api_key", "system"];

export default async function AuditPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({ merchant_id: searchParams.merchant_id, actor_type: searchParams.actor_type, action: searchParams.action, entity_id: searchParams.entity_id, limit: 200 });
  const [audit, merchants] = await Promise.all([api.get<{ data: AuditEntry[] }>(`/admin/audit${query}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?limit=500")]);
  const merchantName = new Map(merchants.data.map((m) => [m.id, m.name]));

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every state-changing action taken by admins, merchant users, API keys and the platform itself, with the before and after snapshot." />

      <FilterBar
        filters={[
          { name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) },
          { name: "actor_type", label: "Actor type", type: "select", options: ACTOR_TYPES.map((a) => ({ value: a, label: a.replace(/_/g, " ") })) },
          { name: "action", label: "Action contains", type: "text", placeholder: "payment.refund" },
          { name: "entity_id", label: "Entity id", type: "text", placeholder: "pay_…, mer_…" },
        ]}
      />

      <Card padded={false} title="Entries" description="Click a row to see what changed">
        {audit.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>IP</th>
                <th>Request id</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {audit.data.map((e) => (
                <AuditRow key={e.id} entry={e} merchantName={e.merchant_id ? merchantName.get(e.merchant_id) : undefined} />
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No audit entries" description="No action matches these filters." />
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">Showing the 200 most recent entries. The audit log is append-only and written by the API for every mutating request.</p>
    </>
  );
}
