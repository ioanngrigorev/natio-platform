import Link from "next/link";
import { WebhookTestButton } from "@/components/dashboard/webhook-test-button";
import { Card, CodeBlock, DescriptionList, LinkButton, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { formatMs, formatPercent } from "@/lib/format";
import { getMerchantSession, serverApi } from "@/lib/session";
import type { ApiKey, SystemStatus, TestScenario, WebhookEndpoint } from "@/lib/types";

export const metadata = { title: "Developers" };

export default async function DevelopersPage() {
  const api = serverApi();
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const [session, scenarios, status, keys, endpoints] = await Promise.all([
    getMerchantSession(),
    api.get<{ data: TestScenario[] }>("/dashboard/payments/scenarios"),
    api.get<SystemStatus>("/dashboard/status"),
    api.get<{ data: ApiKey[] }>("/dashboard/api-keys").catch(() => ({ data: [] as ApiKey[] })),
    api.get<{ data: WebhookEndpoint[] }>("/dashboard/webhooks/endpoints").catch(() => ({ data: [] as WebhookEndpoint[] })),
  ]);
  const activeKeys = keys.data.filter((k) => !k.revoked_at && k.mode === api.mode).length;
  const activeEndpoints = endpoints.data.filter((e) => e.status === "active").length;
  const keyPlaceholder = api.mode === "live" ? "natio_sk_live_…" : "natio_sk_test_…";

  const curl = `curl -X POST ${baseUrl}/v1/payments \\
  -H "Authorization: Bearer ${keyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1001" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "payment_method": "card",
    "country": "US",
    "reference": "ORD-1001",
    "customer": { "external_id": "cus_42", "email": "jane@example.com" }${api.mode === "test" ? `,
    "test_scenario": "success"` : ""}
  }'`;

  return (
    <>
      <PageHeader title="Developers" subtitle="Everything needed to integrate: keys, webhooks, the sandbox and the API reference." actions={<WebhookTestButton />} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Integration status">
            <DescriptionList
              cols={3}
              items={[
                { label: "Current mode", value: <StatusBadge status={api.mode} label={api.mode === "test" ? "Sandbox" : "Live"} /> },
                { label: "API base URL", value: <Mono>{baseUrl}</Mono> },
                { label: "Project", value: session?.projects[0] ? `${session.projects[0].name} (${session.projects.length})` : "—" },
                { label: `Active ${api.mode} keys`, value: activeKeys },
                { label: `Active ${api.mode} webhook endpoints`, value: activeEndpoints },
                { label: "KYB status", value: <StatusBadge status={session?.merchant.kyb_status} /> },
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href="/dashboard/api-keys">API keys</LinkButton>
              <LinkButton href="/dashboard/webhooks">Webhooks</LinkButton>
              <LinkButton href="/docs">Documentation</LinkButton>
              <LinkButton href="/docs/api-reference">API reference</LinkButton>
            </div>
            {api.mode === "live" && session?.merchant.kyb_status !== "approved" ? <p className="mt-3 text-[12px] text-warn">Live keys are issued only after KYB approval. Use the sandbox until then.</p> : null}
          </Card>

          <Card title="Create a payment" description={`Authenticate with a ${api.mode === "test" ? "sandbox" : "live"} secret key. Amounts are in minor units (10000 = 100.00 USD).`}>
            <CodeBlock code={curl} language="bash" />
            <p className="mt-3 text-[12px] text-ink-500">
              Replace <Mono>{keyPlaceholder}</Mono> with a key from{" "}
              <Link href="/dashboard/api-keys" className="text-brand-600 hover:underline">
                API keys
              </Link>
              . The response contains the payment id, status, the route taken and any <Mono>next_action</Mono> for customer redirects. Send the same <Mono>Idempotency-Key</Mono> to safely retry.
            </p>
          </Card>

          <Card title="Sandbox test scenarios" description="Pass test_scenario on a test-mode request to force a provider outcome. Live mode ignores the field." padded={false}>
            <Table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Behaviour</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.data.map((s) => (
                  <tr key={s.name}>
                    <td>
                      <Mono>{s.name}</Mono>
                    </td>
                    <td className="whitespace-normal text-ink-700">{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="System status" description="NATIO API and the providers connected to your account" padded={false}>
            <ul className="divide-y divide-ink-100">
              <li className="flex items-center justify-between px-4 py-2 text-[13px]">
                <span>NATIO API</span>
                <StatusBadge status={status.api === "operational" ? "active" : "error"} label={status.api} />
              </li>
              <li className="flex items-center justify-between px-4 py-2 text-[13px]">
                <span>Webhook queue</span>
                <Mono className="text-ink-500">{status.queue_driver}</Mono>
              </li>
              {status.providers.map((p) => (
                <li key={`${p.provider}-${p.account}`} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                  <div className="min-w-0">
                    <div className="truncate">{p.provider}</div>
                    <div className="truncate text-[11px] text-ink-500">
                      {p.account}
                      {p.health_24h?.attempts ? ` · 24h uptime ${formatPercent(p.health_24h.uptime, 0)} · ${formatMs(p.health_24h.avg_latency_ms)}` : " · no traffic in 24h"}
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Webhooks" description="Signed with your endpoint secret (Natio-Signature header)">
            <p className="text-[13px] text-ink-600">Send a synthetic <Mono>payment.successful</Mono> event to every active endpoint of the current mode and check the delivery log.</p>
            <div className="mt-3 flex gap-2">
              <WebhookTestButton variant="primary" />
              <LinkButton href="/dashboard/webhooks">Delivery log</LinkButton>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
