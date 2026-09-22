import { InviteMember, MemberControls } from "@/components/dashboard/team";
import { Card, PageHeader, StatusBadge, Table, Tag } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { TeamMember } from "@/lib/types";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const api = serverApi();
  const team = await api.get<{ data: TeamMember[]; roles: string[]; assignable_roles: string[] }>("/dashboard/team");

  return (
    <>
      <PageHeader title="Team" subtitle="People with access to this merchant account. Roles map to fixed permission sets; owners cannot be changed here." actions={<InviteMember assignableRoles={team.assignable_roles} />} />

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>MFA</th>
              <th>Last login</th>
              <th>Joined</th>
              <th className="text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {team.data.map((m) => (
              <tr key={m.id} className={m.status === "disabled" ? "text-ink-400" : ""}>
                <td className="font-medium">{m.name}</td>
                <td className="text-ink-600">{m.email}</td>
                <td>
                  <Tag tone={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Tag>
                </td>
                <td>
                  <StatusBadge status={m.status} />
                </td>
                <td>{m.mfa_enabled ? <StatusBadge status="active" label="Enabled" /> : <StatusBadge status="not_started" label="Off" />}</td>
                <td className="text-ink-500" title={m.last_login_at ? formatDateTime(m.last_login_at) : undefined}>
                  {m.last_login_at ? formatRelative(m.last_login_at) : "Never"}
                </td>
                <td className="text-ink-500">{formatDateTime(m.created_at)}</td>
                <td>
                  <MemberControls member={m} assignableRoles={team.assignable_roles} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Roles">
          <ul className="space-y-1 text-[12.5px] text-ink-700">
            {team.roles.map((r) => (
              <li key={r}>
                <span className="font-medium capitalize text-ink-900">{r}</span>
                <span className="text-ink-500"> — {ROLE_DESCRIPTIONS[r] ?? "Custom permission set"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Multi-factor authentication">
          <p className="text-[13px] text-ink-600">MFA enrolment for dashboard users is not yet available in this environment. The MFA column reflects the account flag reported by the API.</p>
        </Card>
      </div>
    </>
  );
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Everything, including assigning the owner role.",
  admin: "Everything except creating owners.",
  developer: "API keys, webhooks, projects, sandbox payments.",
  finance: "Payments, refunds, payouts, settlements, reconciliation.",
  analyst: "Read-only: payments, transactions, settlements, analytics.",
  support: "Payments lookup, refunds, webhook logs.",
  viewer: "Read-only: payments, transactions, analytics.",
};
