import { CreateApiKey, RevokeApiKey } from "@/components/dashboard/api-keys";
import { Alert, Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatRelative, titleCase } from "@/lib/format";
import { getMerchantSession, serverApi } from "@/lib/session";
import type { ApiKey } from "@/lib/types";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const api = serverApi();
  const [keys, session] = await Promise.all([api.get<{ data: ApiKey[] }>("/dashboard/api-keys"), getMerchantSession()]);
  const projects = new Map((session?.projects ?? []).map((p) => [p.id, p.name]));
  const kyb = session?.merchant.kyb_status ?? "not_started";
  const active = keys.data.filter((k) => !k.revoked_at);
  const revoked = keys.data.filter((k) => k.revoked_at);

  return (
    <>
      <PageHeader title="API keys" subtitle="Secret keys for server-to-server access. Keys are scoped to a project and a mode; the secret is shown only once." actions={<CreateApiKey />} />

      <div className="mb-4">
        {kyb === "approved" ? (
          <Alert tone="ok" title="Live keys available">
            KYB status: <StatusBadge status={kyb} />. Test keys work in the sandbox; live keys process real payments through your live provider accounts.
          </Alert>
        ) : (
          <Alert tone="warn" title="Live keys require KYB approval">
            KYB status: <StatusBadge status={kyb} />. Until your business verification is approved, only test keys can be created. Sandbox keys run the full orchestration flow against demo providers.
          </Alert>
        )}
      </div>

      <Card padded={false}>
        {keys.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Mode</th>
                <th>Key</th>
                <th>Project</th>
                <th>Last used</th>
                <th>Created</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...revoked].map((k) => (
                <tr key={k.id} className={k.revoked_at ? "text-ink-400" : ""}>
                  <td className="font-medium">{k.name}</td>
                  <td>
                    <StatusBadge status={k.mode} label={k.mode === "test" ? "Test" : "Live"} />
                  </td>
                  <td>
                    <Mono>{k.prefix}…</Mono>
                  </td>
                  <td>{projects.get(k.project_id) ?? <Mono>{k.project_id}</Mono>}</td>
                  <td className="text-ink-500" title={k.last_used_at ? formatDateTime(k.last_used_at) : undefined}>
                    {k.last_used_at ? formatRelative(k.last_used_at) : "Never"}
                  </td>
                  <td className="text-ink-500">{formatDateTime(k.created_at)}</td>
                  <td>{k.revoked_at ? <StatusBadge status="revoked" label={`Revoked ${formatRelative(k.revoked_at)}`} /> : <StatusBadge status="active" />}</td>
                  <td className="text-right">
                    <RevokeApiKey apiKey={k} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No API keys" description="Create a test key to start integrating against the sandbox." action={<CreateApiKey />} />
        )}
      </Card>

      <p className="mt-3 text-[12px] text-ink-500">
        Keys look like <Mono>sk_{api.mode}_…</Mono> and are sent as <Mono>Authorization: Bearer</Mono>. {titleCase(api.mode)} mode is selected in the header; it only changes which data this dashboard shows, not which keys exist.
      </p>
    </>
  );
}
