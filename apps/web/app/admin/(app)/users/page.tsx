import Link from "next/link";
import { AdminUserControls, CreateAdminUser } from "@/components/admin/user-actions";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant, AdminUsersResponse } from "@/lib/admin-types";

export const metadata = { title: "Users" };

export default async function AdminUsersPage({ searchParams }: { searchParams: { merchant_id?: string } }) {
  const api = serverApi();
  const [users, merchants] = await Promise.all([api.get<AdminUsersResponse>(`/admin/users${qs({ merchant_id: searchParams.merchant_id })}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?limit=500")]);

  return (
    <>
      <PageHeader title="Users" subtitle="NATIO staff accounts for this panel and the dashboard users of every merchant." actions={<CreateAdminUser roles={users.roles} />} />

      <Card title="Admin users" description="Internal staff. Roles map to the admin permissions enforced by the API." padded={false}>
        {users.admins.length ? (
          <Table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.admins.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-[11px] text-ink-500">{u.email}</div>
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="text-ink-500">{formatDateTime(u.last_login_at)}</td>
                  <td className="text-ink-500">{formatDateTime(u.created_at)}</td>
                  <td>
                    <AdminUserControls user={u} roles={users.roles} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No admin users" />
        )}
      </Card>

      <div className="mt-6">
        <FilterBar filters={[{ name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) }]} />
      </div>

      <Card title="Merchant users" description="Dashboard users across merchants. Their roles are managed by the merchant's own owners and admins." padded={false}>
        {users.merchant_users.length ? (
          <Table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Merchant</th>
                <th>Role</th>
                <th>Status</th>
                <th>MFA</th>
                <th>Last login</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.merchant_users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-ink-600">{u.email}</td>
                  <td>
                    <Link href={`/admin/merchants/${u.merchant_id}`} className="text-brand-600 hover:underline">
                      {u.merchant_name}
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      <Mono className="text-[11px]">{shortId(u.merchant_id, 10)}</Mono>
                    </div>
                  </td>
                  <td>{u.role}</td>
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
          <EmptyState title="No merchant users" description={searchParams.merchant_id ? "This merchant has no dashboard users." : "Merchant users appear as merchants register and invite their team."} />
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">Merchant user roles and access are changed by the merchant in their own dashboard; admins can disable the whole merchant from its detail page.</p>
    </>
  );
}
