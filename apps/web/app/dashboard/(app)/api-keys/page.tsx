
import {getI18n} from '@/lib/i18n/server';
import { CreateApiKey, RevokeApiKey } from "@/components/dashboard/api-keys";
import { Alert, Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatRelative, titleCase } from "@/lib/format";
import { getMerchantSession, serverApi } from "@/lib/session";
import type { ApiKey } from "@/lib/types";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
 const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const [keys, session] = await Promise.all([api.get<{ data: ApiKey[] }>("/dashboard/api-keys"), getMerchantSession()]);
  const projects = new Map((session?.projects ?? []).map((p) => [p.id, p.name]));
  const kyb = session?.merchant.kyb_status ?? "not_started";
  const active = keys.data.filter((k) => !k.revoked_at);
  const revoked = keys.data.filter((k) => k.revoked_at);

  return (
    <>
      <PageHeader title={translateUi("API keys")} subtitle={translateUi("Secret keys for server-to-server access. Keys are scoped to a project and a mode; the secret is shown only once.")} actions={<CreateApiKey />} />

      <div className="mb-4">
        {translateUi(kyb === "approved" ? (
          <Alert tone="ok" title={translateUi("Live keys available")}>{translateUi("KYB status: ")}<StatusBadge status={kyb} />{translateUi(". Test keys work in the sandbox; live keys process real payments through your live provider accounts.")}</Alert>
        ) : (
          <Alert tone="warn" title={translateUi("Live keys require KYB approval")}>{translateUi("KYB status: ")}<StatusBadge status={kyb} />{translateUi(". Until your business verification is approved, only test keys can be created. Sandbox keys run the full orchestration flow against demo providers.")}</Alert>
        ))}
      </div>

      <Card padded={false}>
        {translateUi(keys.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Name")}</th>
                <th>{translateUi("Mode")}</th>
                <th>{translateUi("Key")}</th>
                <th>{translateUi("Project")}</th>
                <th>{translateUi("Last used")}</th>
                <th>{translateUi("Created")}</th>
                <th>{translateUi("Status")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {translateUi([...active, ...revoked].map((k) => (
                <tr key={k.id} className={k.revoked_at ? "text-ink-400" : ""}>
                  <td className="font-medium">{k.name}</td>
                  <td>
                    <StatusBadge status={k.mode} label={translateUi(k.mode === "test" ? translateUi("Test") : translateUi("Live"))} />
                  </td>
                  <td>
                    <Mono>{translateUi(k.prefix)}…</Mono>
                  </td>
                  <td>{translateUi(projects.get(k.project_id) ?? <Mono>{translateUi(k.project_id)}</Mono>)}</td>
                  <td className="text-ink-500" title={translateUi(k.last_used_at ? formatDateTime(k.last_used_at) : undefined)}>
                    {translateUi(k.last_used_at ? formatRelative(k.last_used_at) : translateUi("Never"))}
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(k.created_at))}</td>
                  <td>{translateUi(k.revoked_at ? <StatusBadge status="revoked" label={translateUi(`Revoked ${formatRelative(k.revoked_at)}`)} /> : <StatusBadge status="active" />)}</td>
                  <td className="text-right">
                    <RevokeApiKey apiKey={k} />
                  </td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No API keys")} description={translateUi("Create a test key to start integrating against the sandbox.")} action={<CreateApiKey />} />
        ))}
      </Card>

      <p className="mt-3 text-[12px] text-ink-500">{translateUi("Keys look like ")}<Mono>{translateUi("sk_")}{translateUi(api.mode)}_…</Mono>{translateUi(" and are sent as ")}<Mono>{translateUi("Authorization: Bearer")}</Mono>. {translateUi(titleCase(api.mode))}{translateUi(" mode is selected in the header; it only changes which data this dashboard shows, not which keys exist.")}</p>
    </>
  );
}
