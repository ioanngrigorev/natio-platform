import Link from "next/link";
import { notFound } from "next/navigation";
import { MerchantActions } from "@/components/admin/merchant-actions";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { Card, DescriptionList, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchantDetail } from "@/lib/admin-types";

export default async function MerchantDetailPage({ params }: { params: { id: string } }) {
  const api = serverApi();
  let m: AdminMerchantDetail;
  try {
    m = await api.get<AdminMerchantDetail>(`/admin/merchants/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }
  const settings = m.settings as Record<string, unknown>;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/admin/merchants" className="hover:underline">
            Merchants
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {m.name}
            <StatusBadge status={m.status} />
            <StatusBadge status={m.kyb_status} label={`KYB ${titleCase(m.kyb_status)}`} />
          </span>
        }
        subtitle={
          <span>
            <Mono>{m.id}</Mono> · created {formatDateTime(m.created_at)}
          </span>
        }
        actions={<MerchantActions merchant={m} />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Profile">
            <DescriptionList
              cols={3}
              items={[
                { label: "Legal name", value: m.legal_name ?? "—" },
                { label: "Country", value: m.country ?? "—" },
                { label: "Registration number", value: m.registration_number ?? "—" },
                { label: "Contact email", value: m.contact_email ?? "—" },
                { label: "Website", value: m.website ? <a href={m.website} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{m.website}</a> : "—" },
                { label: "Industry", value: typeof settings.industry === "string" ? titleCase(settings.industry) : "—" },
                { label: "Timezone", value: typeof settings.timezone === "string" ? settings.timezone : "—" },
                { label: "Default currency", value: typeof settings.defaultCurrency === "string" ? settings.defaultCurrency : "—" },
                { label: "Updated", value: formatDateTime(m.updated_at) },
              ]}
            />
          </Card>

          <Card title="Users" description="Dashboard users of this merchant" padded={false} actions={<Link href={`/admin/users?merchant_id=${m.id}`} className="text-[12px] font-medium text-brand-600 hover:underline">All users</Link>}>
            {m.users.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>MFA</th>
                    <th>Last login</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {m.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-[11px] text-ink-500">{u.email}</div>
                      </td>
                      <td className="capitalize">{u.role}</td>
                      <td>
                        <StatusBadge status={u.status} />
                      </td>
                      <td>{u.mfa_enabled ? "On" : <span className="text-ink-400">Off</span>}</td>
                      <td className="text-ink-500">{formatDateTime(u.last_login_at)}</td>
                      <td className="text-ink-500">{formatDateTime(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No users" />
            )}
          </Card>

          <Card title="Projects" description="Each project has its own API keys, webhooks and settings" padded={false}>
            {m.projects.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Default currency</th>
                    <th>Capture</th>
                    <th>Allowed IPs</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {m.projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[11px] text-ink-500">
                          <Mono className="text-[11px]">{p.id}</Mono> · {p.slug}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td>{p.settings.default_currency ?? "—"}</td>
                      <td>{titleCase(p.settings.capture_method)}</td>
                      <td>{p.settings.allowed_ips.length ? p.settings.allowed_ips.join(", ") : <span className="text-ink-400">any</span>}</td>
                      <td className="text-ink-500">{formatDateTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No projects" />
            )}
          </Card>

          <Card title="Recent payments" padded={false} actions={<Link href={`/admin/payments?merchant_id=${m.id}`} className="text-[12px] font-medium text-brand-600 hover:underline">All payments</Link>}>
            <PaymentsTable payments={m.recent_payments} hrefBase="/admin/payments" />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Operations">
            <ul className="space-y-1 text-[13px]">
              <li>
                <Link href={`/admin/payments?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Payments</Link>
              </li>
              <li>
                <Link href={`/admin/transactions?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Transactions</Link>
              </li>
              <li>
                <Link href={`/admin/payouts?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Payouts</Link>
              </li>
              <li>
                <Link href={`/admin/settlements?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Settlements</Link>
              </li>
              <li>
                <Link href={`/admin/reconciliation?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Reconciliation</Link>
              </li>
              <li>
                <Link href={`/admin/webhooks?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Webhook deliveries</Link>
              </li>
              <li>
                <Link href={`/admin/routing?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Routing rules</Link>
              </li>
              <li>
                <Link href={`/admin/audit?merchant_id=${m.id}`} className="text-brand-600 hover:underline">Audit log</Link>
              </li>
            </ul>
          </Card>
          <Card title="Settings">
            <pre className="mono whitespace-pre-wrap text-ink-700">{JSON.stringify(m.settings, null, 2)}</pre>
          </Card>
        </div>
      </div>
    </>
  );
}
