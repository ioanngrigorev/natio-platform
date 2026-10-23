
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { ChangePasswordForm, CreateProject, MerchantProfileForm, ProjectSettingsForm } from "@/components/dashboard/settings-forms";
import { Alert, Card, DescriptionList, EmptyState, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, titleCase } from "@/lib/format";
import { getMerchantSession, serverApi } from "@/lib/session";
import type { Merchant, Project } from "@/lib/types";

export const metadata = { title: "Settings" };

/** Same visual weight as PageHeader, but an h2: the page already has one h1. */
async function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
 const {t:translateUi,locale:uiLocale}=(await getI18n());

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-ink-900">{translateUi(title)}</h2>
        {translateUi(subtitle ? <p className="mt-1 max-w-[720px] text-[13px] text-ink-500">{translateUi(subtitle)}</p> : null)}
      </div>
      {translateUi(actions ? <div className="flex items-center gap-2">{translateUi(actions)}</div> : null)}
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
 const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const [merchant, projects, session] = await Promise.all([api.get<Merchant>("/dashboard/merchant"), api.get<{ data: Project[] }>("/dashboard/projects"), getMerchantSession()]);

  const permissions = session?.permissions ?? [];
  const canEditMerchant = permissions.includes("merchant.update");
  const canManageProjects = permissions.includes("projects.manage");
  const kyb = merchant.kyb_status || "not_started";
  const kybApproved = kyb === "approved";

  return (
    <>
      <PageHeader title={translateUi("Settings")} subtitle={translateUi("Merchant profile, verification status, projects and account security. Changes are written to the audit log.")} />

      {translateUi(!canEditMerchant && !canManageProjects ? (
        <div className="mb-4">
          <Alert tone="info" title={translateUi("Read-only access")}>{translateUi("Your role (")}{translateUi(titleCase(session?.user.role))}{translateUi(") can view these settings but not change them. An owner or admin can update the merchant profile and projects.")}</Alert>
        </div>
      ) : null)}

      {/* ------------------------------------------------------------------ merchant profile + KYB */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={translateUi("Merchant profile")} description={translateUi("Legal and operational details for this merchant account.")}>
            <MerchantProfileForm merchant={merchant} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={translateUi("KYB status")} description={translateUi("Business verification, reviewed by NATIO operations.")}>
            <div className="flex items-center gap-2">
              <StatusBadge status={kyb} />
              <span className="text-[12px] text-ink-500">{translateUi("Account status: ")}{translateUi(titleCase(merchant.status))}</span>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-ink-600">{translateUi(KYB_EXPLANATION[kyb] ?? "Business verification is in progress. Only test keys can be created until it is approved.")}</p>
            <div className="mt-3">
              {translateUi(kybApproved ? (
                <Alert tone="ok" title={translateUi("Live API keys available")}>{translateUi("Create them under")}{translateUi(" ")}
                  <Link href="/dashboard/api-keys" className="underline">{translateUi("API keys")}</Link>{translateUi(". Live keys process real payments through the providers configured for your account.")}</Alert>
              ) : (
                <Alert tone="warn" title={translateUi("Live API keys require KYB approval")}>{translateUi("Until verification is approved only ")}<Mono>{translateUi("natio_sk_test_")}</Mono>{translateUi(" keys can be created. Sandbox keys run the full orchestration flow against demo providers.")}</Alert>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-ink-500">{translateUi("This status is read-only here; it is set by NATIO operations as part of onboarding.")}</p>
          </Card>

          <Card title={translateUi("Account")}>
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
          title={translateUi("Projects")}
          subtitle={translateUi("Projects separate API keys, webhooks and payment settings — for example one per storefront, brand or platform. Each project exists in both test and live mode.")}
          actions={<CreateProject />}
        />
        {translateUi(projects.data.length ? (
          <div className="space-y-4">
            {translateUi(projects.data.map((p) => (
              <Card
                key={p.id}
                title={translateUi(p.name)}
                description={
                  translateUi(<>{translateUi("Created ")}{translateUi(formatDateTime(p.created_at))}{translateUi(" · slug ")}<Mono>{translateUi(p.slug)}</Mono>
                  </>)
                }
                actions={<StatusBadge status={p.status} />}
              >
                <ProjectSettingsForm project={p} />
              </Card>
            )))}
          </div>
        ) : (
          <Card padded={false}>
            <EmptyState title={translateUi("No projects")} description={translateUi(canManageProjects ? translateUi("Create a project to issue API keys and register webhook endpoints.") : translateUi("No projects exist for this merchant yet. An owner, admin or developer can create one."))} action={<CreateProject />} />
          </Card>
        ))}
        {translateUi(!canManageProjects ? <p className="mt-3 text-[12px] text-ink-500">{translateUi("Your role cannot create or change projects.")}</p> : null)}
      </div>

      {/* ------------------------------------------------------------------ security */}
      <div className="mt-8">
        <SectionHeader title={translateUi("Security")} subtitle={translateUi("Credentials for your own dashboard user. API credentials live under API keys.")} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Card title={translateUi("Change password")} description={translateUi("You will stay signed in on this device; other sessions are unaffected.")}>
              <ChangePasswordForm />
            </Card>
          </div>
          <div className="space-y-4">
            <Card title={translateUi("Signed in as")}>
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
            <Card title={translateUi("Multi-factor authentication")}>
              <div className="flex items-center gap-2">
                <StatusBadge status={session?.user.mfa_enabled ? "active" : "not_started"} label={translateUi(session?.user.mfa_enabled ? translateUi("Enabled") : translateUi("Off"))} />
                <span className="text-[12px] text-ink-500">{translateUi("Account flag reported by the API")}</span>
              </div>
              <p className="mt-3 text-[13px] leading-6 text-ink-600">{translateUi("MFA enrolment for dashboard users is planned and not yet available in this environment. When it ships it will be managed here and enforced per role.")}</p>
            </Card>
            <Card title={translateUi("Access and audit")}>
              <p className="text-[13px] leading-6 text-ink-600">{translateUi("Roles and invitations are managed under")}{translateUi(" ")}
                <Link href="/dashboard/team" className="text-brand-600 hover:underline">{translateUi("Team")}</Link>{translateUi(". Profile, project and security changes are recorded with the acting user in the audit log.")}</p>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
