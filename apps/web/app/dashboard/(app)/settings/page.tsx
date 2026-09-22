import Link from "next/link";
import { ChangePasswordForm, CreateProject, MerchantProfileForm, ProjectSettingsForm } from "@/components/dashboard/settings-forms";
import { Alert, Card, DescriptionList, EmptyState, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, titleCase } from "@/lib/format";
import { getMerchantSession, serverApi } from "@/lib/session";
import type { Merchant, Project } from "@/lib/types";

export const metadata = { title: "Settings" };

/** Same visual weight as PageHeader, but an h2: the page already has one h1. */
function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-ink-900">{title}</h2>
        {subtitle ? <p className="mt-1 max-w-[720px] text-[13px] text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const KYB_EXPLANATION: Record<string, string> = {
  not_started: "Business verification has not been submitted yet. Only test keys can be created until it is approved.",
  pending: "Business verification has been submitted and is being reviewed. Only test keys can be created until it is approved.",
  in_review: "Business verification is being reviewed by NATIO operations. Only test keys can be created until it is approved.",
  approved: "Business verification is approved. Live API keys can be created and routed to your live provider accounts.",
  rejected: "Business verification was not approved. Contact NATIO operations before creating live keys.",
};

export default async function SettingsPage() {
  const api = serverApi();
  const [merchant, projects, session] = await Promise.all([api.get<Merchant>("/dashboard/merchant"), api.get<{ data: Project[] }>("/dashboard/projects"), getMerchantSession()]);

  const permissions = session?.permissions ?? [];
  const canEditMerchant = permissions.includes("merchant.update");
  const canManageProjects = permissions.includes("projects.manage");
  const kyb = merchant.kyb_status || "not_started";
  const kybApproved = kyb === "approved";

  return (
    <>
      <PageHeader title="Settings" subtitle="Merchant profile, verification status, projects and account security. Changes are written to the audit log." />

      {!canEditMerchant && !canManageProjects ? (
        <div className="mb-4">
          <Alert tone="info" title="Read-only access">
            Your role ({titleCase(session?.user.role)}) can view these settings but not change them. An owner or admin can update the merchant profile and projects.
          </Alert>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ merchant profile + KYB */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title="Merchant profile" description="Legal and operational details for this merchant account.">
            <MerchantProfileForm merchant={merchant} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="KYB status" description="Business verification, reviewed by NATIO operations.">
            <div className="flex items-center gap-2">
              <StatusBadge status={kyb} />
              <span className="text-[12px] text-ink-500">Account status: {titleCase(merchant.status)}</span>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-ink-600">{KYB_EXPLANATION[kyb] ?? "Business verification is in progress. Only test keys can be created until it is approved."}</p>
            <div className="mt-3">
              {kybApproved ? (
                <Alert tone="ok" title="Live API keys available">
                  Create them under{" "}
                  <Link href="/dashboard/api-keys" className="underline">
                    API keys
                  </Link>
                  . Live keys process real payments through the providers configured for your account.
                </Alert>
              ) : (
                <Alert tone="warn" title="Live API keys require KYB approval">
                  Until verification is approved only <Mono>natio_sk_test_</Mono> keys can be created. Sandbox keys run the full orchestration flow against demo providers.
                </Alert>
              )}
            </div>
            <p className="mt-3 text-[12px] text-ink-500">This status is read-only here; it is set by NATIO operations as part of onboarding.</p>
          </Card>

          <Card title="Account">
            <DescriptionList
              cols={1}
              items={[
                { label: "Merchant id", value: <Mono>{merchant.id}</Mono> },
                { label: "Country", value: merchant.country ?? "—" },
                { label: "Created", value: formatDateTime(merchant.created_at) },
                { label: "Last updated", value: formatDateTime(merchant.updated_at) },
              ]}
            />
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------------------------ projects */}
      <div className="mt-8">
        <SectionHeader
          title="Projects"
          subtitle="Projects separate API keys, webhooks and payment settings — for example one per storefront, brand or platform. Each project exists in both test and live mode."
          actions={<CreateProject />}
        />
        {projects.data.length ? (
          <div className="space-y-4">
            {projects.data.map((p) => (
              <Card
                key={p.id}
                title={p.name}
                description={
                  <>
                    Created {formatDateTime(p.created_at)} · slug <Mono>{p.slug}</Mono>
                  </>
                }
                actions={<StatusBadge status={p.status} />}
              >
                <ProjectSettingsForm project={p} />
              </Card>
            ))}
          </div>
        ) : (
          <Card padded={false}>
            <EmptyState title="No projects" description={canManageProjects ? "Create a project to issue API keys and register webhook endpoints." : "No projects exist for this merchant yet. An owner, admin or developer can create one."} action={<CreateProject />} />
          </Card>
        )}
        {!canManageProjects ? <p className="mt-3 text-[12px] text-ink-500">Your role cannot create or change projects.</p> : null}
      </div>

      {/* ------------------------------------------------------------------ security */}
      <div className="mt-8">
        <SectionHeader title="Security" subtitle="Credentials for your own dashboard user. API credentials live under API keys." />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Card title="Change password" description="You will stay signed in on this device; other sessions are unaffected.">
              <ChangePasswordForm />
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Signed in as">
              <DescriptionList
                cols={1}
                items={[
                  { label: "Name", value: session?.user.name ?? "—" },
                  { label: "Email", value: session?.user.email ?? "—" },
                  { label: "Role", value: titleCase(session?.user.role) },
                  { label: "Last login", value: session?.user.last_login_at ? formatDateTime(session.user.last_login_at) : "—" },
                ]}
              />
            </Card>
            <Card title="Multi-factor authentication">
              <div className="flex items-center gap-2">
                <StatusBadge status={session?.user.mfa_enabled ? "active" : "not_started"} label={session?.user.mfa_enabled ? "Enabled" : "Off"} />
                <span className="text-[12px] text-ink-500">Account flag reported by the API</span>
              </div>
              <p className="mt-3 text-[13px] leading-6 text-ink-600">MFA enrolment for dashboard users is planned and not yet available in this environment. When it ships it will be managed here and enforced per role.</p>
            </Card>
            <Card title="Access and audit">
              <p className="text-[13px] leading-6 text-ink-600">
                Roles and invitations are managed under{" "}
                <Link href="/dashboard/team" className="text-brand-600 hover:underline">
                  Team
                </Link>
                . Profile, project and security changes are recorded with the acting user in the audit log.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
