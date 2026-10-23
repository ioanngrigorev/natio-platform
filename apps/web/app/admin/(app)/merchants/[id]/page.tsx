
import {getI18n} from '@/lib/i18n/server';
import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MerchantActions } from "@/components/admin/merchant-actions";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { Card, DescriptionList, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchantDetail } from "@/lib/admin-types";

export default async function MerchantDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
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
          <Link href="/admin/merchants" className="hover:underline">{translateUi("Merchants")}</Link>
        }
        title={
          translateUi(<span className="flex items-center gap-3">
            {m.name}
            <StatusBadge status={m.status} />
            <StatusBadge status={m.kyb_status} label={translateUi(`KYB ${titleCase(m.kyb_status)}`)} />
          </span>)
        }
        subtitle={
          translateUi(<span>
            <Mono>{m.id}</Mono>{translateUi(" · created ")}{translateUi(formatDateTime(m.created_at))}
          </span>)
        }
        actions={<MerchantActions merchant={m} />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={translateUi("Profile")}>
            <DescriptionList
              cols={3}
              items={[
                { label: "Legal name", value: m.legal_name ?? "—" },
                { label: "Country", value: m.country ?? "—" },
                { label: "Registration number", value: m.registration_number ?? "—" },
                { label: "Contact email", value: m.contact_email ?? "—" },
                { label: "Website", value: m.website ? <a href={m.website} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{translateUi(m.website)}</a> : "—" },
                { label: "Industry", value: typeof settings.industry === "string" ? titleCase(settings.industry) : "—" },
                { label: "Timezone", value: typeof settings.timezone === "string" ? settings.timezone : "—" },
                { label: "Default currency", value: typeof settings.defaultCurrency === "string" ? settings.defaultCurrency : "—" },
                { label: "Updated", value: formatDateTime(m.updated_at) },
              ]}
            />
          </Card>

          <Card title={translateUi("Users")} description={translateUi("Dashboard users of this merchant")} padded={false} actions={<Link href={`/admin/users?merchant_id=${m.id}`} className="text-[12px] font-medium text-brand-600 hover:underline">{translateUi("All users")}</Link>}>
            {translateUi(m.users.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>{translateUi("User")}</th>
                    <th>{translateUi("Role")}</th>
                    <th>{translateUi("Status")}</th>
                    <th>{translateUi("MFA")}</th>
                    <th>{translateUi("Last login")}</th>
                    <th>{translateUi("Created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {translateUi(m.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <EntityLink kind="users" id={u.id}>{u.name}</EntityLink>
                        <div className="text-[11px] text-ink-500">{u.email}</div>
                      </td>
                      <td className="capitalize">{translateUi(u.role)}</td>
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
              <EmptyState title={translateUi("No users")} />
            ))}
          </Card>

          <Card title={translateUi("Projects")} description={translateUi("Each project has its own API keys, webhooks and settings")} padded={false}>
            {translateUi(m.projects.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>{translateUi("Project")}</th>
                    <th>{translateUi("Status")}</th>
                    <th>{translateUi("Default currency")}</th>
                    <th>{translateUi("Capture")}</th>
                    <th>{translateUi("Allowed IPs")}</th>
                    <th>{translateUi("Created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {translateUi(m.projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link className="font-medium text-brand-600 hover:underline" href={`/admin/transactions?merchant_id=${m.id}&project_id=${p.id}`}>{p.name}</Link>
                        <div className="text-[11px] text-ink-500">
                          <Mono className="text-[11px]">{p.id}</Mono> · {translateUi(p.slug)}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td>{translateUi(p.settings.default_currency ?? "—")}</td>
                      <td>{translateUi(titleCase(p.settings.capture_method))}</td>
                      <td>{translateUi(p.settings.allowed_ips.length ? p.settings.allowed_ips.join(", ") : <span className="text-ink-400">{translateUi("any")}</span>)}</td>
                      <td className="text-ink-500">{translateUi(formatDateTime(p.created_at))}</td>
                    </tr>
                  )))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title={translateUi("No projects")} />
            ))}
          </Card>

          <Card title={translateUi("Recent payments")} padded={false} actions={<Link href={`/admin/payments?merchant_id=${m.id}`} className="text-[12px] font-medium text-brand-600 hover:underline">{translateUi("All payments")}</Link>}>
            <PaymentsTable payments={m.recent_payments} hrefBase="/admin/payments" />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={translateUi("Operations")}>
            <ul className="space-y-1 text-[13px]">
              <li>
                <Link href={`/admin/payments?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Payments")}</Link>
              </li>
              <li>
                <Link href={`/admin/transactions?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Transactions")}</Link>
              </li>
              <li>
                <Link href={`/admin/payouts?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Payouts")}</Link>
              </li>
              <li>
                <Link href={`/admin/settlements?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Settlements")}</Link>
              </li>
              <li>
                <Link href={`/admin/reconciliation?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Reconciliation")}</Link>
              </li>
              <li>
                <Link href={`/admin/webhooks?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Webhook deliveries")}</Link>
              </li>
              <li>
                <Link href={`/admin/routing?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Routing rules")}</Link>
              </li>
              <li>
                <Link href={`/admin/audit?merchant_id=${m.id}`} className="text-brand-600 hover:underline">{translateUi("Audit log")}</Link>
              </li>
            </ul>
          </Card>
          <Card title={translateUi("Settings")}>
            <pre className="mono whitespace-pre-wrap text-ink-700">{JSON.stringify(m.settings, null, 2)}</pre>
          </Card>
        </div>
      </div>
    </>
  );
}
