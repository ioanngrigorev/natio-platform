
import {getI18n} from '@/lib/i18n/server';
import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { AdminUserControls, CreateAdminUser } from "@/components/admin/user-actions";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant, AdminUsersResponse } from "@/lib/admin-types";

export const metadata = { title: "Users" };

export default async function AdminUsersPage(props: { searchParams: Promise<{ merchant_id?: string }> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const [users, merchants] = await Promise.all([api.get<AdminUsersResponse>(`/admin/users${qs({ merchant_id: searchParams.merchant_id })}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500")]);

  return (
    <>
      <PageHeader title={translateUi("Users")} subtitle={translateUi("NATIO staff accounts for this panel and the dashboard users of every merchant.")} actions={<CreateAdminUser roles={users.roles} />} />

      <Card title={translateUi("Admin users")} description={translateUi("Internal staff. Roles map to the admin permissions enforced by the API.")} padded={false}>
        {translateUi(users.admins.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("User")}</th>
                <th>{translateUi("Status")}</th>
                <th>{translateUi("Last login")}</th>
                <th>{translateUi("Created")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {translateUi(users.admins.map((u) => (
                <tr key={u.id}>
                  <td>
                    <EntityLink kind="users" id={u.id}>{u.name}</EntityLink>
                    <div className="text-[11px] text-ink-500">{u.email}</div>
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(u.last_login_at))}</td>
                  <td className="text-ink-500">{translateUi(formatDateTime(u.created_at))}</td>
                  <td>
                    <AdminUserControls user={u} roles={users.roles} />
                  </td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No admin users")} />
        ))}
      </Card>

      <div className="mt-6">
        <FilterBar filters={[{ name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) }]} />
      </div>

      <Card title={translateUi("Merchant users")} description={translateUi("Dashboard users across merchants. Their roles are managed by the merchant's own owners and admins.")} padded={false}>
        {translateUi(users.merchant_users.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("User")}</th>
                <th>{translateUi("Email")}</th>
                <th>{translateUi("Merchant")}</th>
                <th>{translateUi("Role")}</th>
                <th>{translateUi("Status")}</th>
                <th>{translateUi("MFA")}</th>
                <th>{translateUi("Last login")}</th>
                <th>{translateUi("Created")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(users.merchant_users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium"><EntityLink kind="users" id={u.id}>{u.name}</EntityLink></td>
                  <td className="text-ink-600">{u.email}</td>
                  <td>
                    <Link href={`/admin/merchants/${u.merchant_id}`} className="text-brand-600 hover:underline">
                      {translateUi(u.merchant_name)}
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      <Mono className="text-[11px]">{translateUi(shortId(u.merchant_id, 10))}</Mono>
                    </div>
                  </td>
                  <td>{translateUi(u.role)}</td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td>{translateUi(u.mfa_enabled ? translateUi("On") : <span className="text-ink-400">{translateUi("Off")}</span>)}</td>
                  <td className="text-ink-500">{translateUi(formatDateTime(u.last_login_at))}</td>
                  <td className="text-ink-500">{translateUi(formatDateTime(u.created_at))}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No merchant users")} description={translateUi(searchParams.merchant_id ? translateUi("This merchant has no dashboard users.") : translateUi("Merchant users appear as merchants register and invite their team."))} />
        ))}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">{translateUi("Merchant user roles and access are changed by the merchant in their own dashboard; admins can disable the whole merchant from its detail page.")}</p>
    </>
  );
}
