import Link from "next/link";
import { ConditionChips } from "@/components/admin/condition-chips";
import { RoutingRuleControls, RoutingSimulator } from "@/components/admin/routing-actions";
import { Card, EmptyState, LinkButton, Mono, PageHeader, StatusBadge, Table, Tag } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { RoutingRule } from "@/lib/types";

export const metadata = { title: "Routing rules" };

interface Group {
  key: string;
  mode: string;
  transactionType: string;
  rules: RoutingRule[];
}

function groupRules(rules: RoutingRule[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rules) {
    const key = `${r.mode}:${r.transactionType}`;
    const g = groups.get(key) ?? { key, mode: r.mode, transactionType: r.transactionType, rules: [] };
    g.rules.push(r);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.rules.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  return [...groups.values()].sort((a, b) => a.mode.localeCompare(b.mode) || a.transactionType.localeCompare(b.transactionType));
}

export default async function RoutingRulesPage({ searchParams }: { searchParams: { merchant_id?: string } }) {
  const api = serverApi();
  const [rules, merchants] = await Promise.all([api.get<{ data: RoutingRule[] }>(`/admin/routing/rules?mode=${api.mode}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?limit=500")]);
  const merchantName = new Map(merchants.data.map((m) => [m.id, m.name]));
  const scoped = searchParams.merchant_id ? rules.data.filter((r) => r.merchantId === searchParams.merchant_id || r.merchantId === null) : rules.data;
  const groups = groupRules(scoped);

  return (
    <>
      <PageHeader
        title="Routing rules"
        subtitle={`Which provider account processes which transaction, in ${api.mode} mode. The first matching rule (lowest priority number) decides the provider chain; fallbacks are tried in order.`}
        actions={<LinkButton href="/admin/routing/new" variant="primary">New rule</LinkButton>}
      />

      {searchParams.merchant_id ? (
        <p className="mb-4 text-[12px] text-ink-500">
          Showing global rules and rules scoped to{" "}
          <Link href={`/admin/merchants/${searchParams.merchant_id}`} className="text-brand-600 hover:underline">
            {merchantName.get(searchParams.merchant_id) ?? searchParams.merchant_id}
          </Link>{" "}
          ·{" "}
          <Link href="/admin/routing" className="text-brand-600 hover:underline">
            show all
          </Link>
        </p>
      ) : null}

      <div className="space-y-4">
        {groups.map((g) => {
          const ids = g.rules.map((r) => r.id);
          return (
            <Card
              key={g.key}
              padded={false}
              title={
                <span className="flex items-center gap-2">
                  {titleCase(g.transactionType)} routing
                  <StatusBadge status={g.mode} label={g.mode === "test" ? "Test" : "Live"} />
                </span>
              }
              description={`${g.rules.length} rule${g.rules.length === 1 ? "" : "s"}, evaluated top to bottom`}
            >
              <Table>
                <thead>
                  <tr>
                    <th className="num">Priority</th>
                    <th>Rule</th>
                    <th>Scope</th>
                    <th>Conditions</th>
                    <th>Strategy</th>
                    <th>Provider chain</th>
                    <th>Enabled</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.rules.map((r) => (
                    <tr key={r.id} className={r.enabled ? undefined : "opacity-60"}>
                      <td className="num">{r.priority}</td>
                      <td>
                        <Link href={`/admin/routing/${r.id}`} className="font-medium text-brand-600 hover:underline">
                          {r.name}
                        </Link>
                        <div className="max-w-[320px] truncate text-[11px] text-ink-500" title={r.description ?? undefined}>
                          {r.description ?? <Mono className="text-[11px]">{r.id}</Mono>}
                        </div>
                      </td>
                      <td>{r.merchantId ? <Tag tone="brand">{merchantName.get(r.merchantId) ?? r.merchantId}</Tag> : <span className="text-ink-500">Global</span>}</td>
                      <td className="!whitespace-normal">
                        <ConditionChips conditions={r.conditions} className="max-w-[360px]" />
                      </td>
                      <td>{r.strategy}</td>
                      <td className="!whitespace-normal">
                        {r.routes.length ? (
                          <span className="text-[12px]">
                            {r.routes.map((x) => x.account_name).join(" → ")}
                            {r.strategy === "weighted" ? <span className="text-ink-400"> ({r.routes.map((x) => x.weight).join(" / ")})</span> : null}
                          </span>
                        ) : (
                          <span className="text-bad">no accounts</span>
                        )}
                      </td>
                      <RoutingRuleControls rule={r} groupIds={ids} />
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })}
        {groups.length ? null : (
          <Card>
            <EmptyState title={`No routing rules in ${api.mode} mode`} description="Without a rule, transactions fall back to the provider accounts ordered by their priority." action={<LinkButton href="/admin/routing/new" variant="primary">Create the first rule</LinkButton>} />
          </Card>
        )}
      </div>

      <div className="mt-6">
        <RoutingSimulator merchants={merchants.data.map((m) => ({ id: m.id, name: m.name }))} />
      </div>
    </>
  );
}
