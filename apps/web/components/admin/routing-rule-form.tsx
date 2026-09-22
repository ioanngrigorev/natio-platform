"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Card, Field, LinkButton, Mono, Tag } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import type { Condition } from "@/components/admin/condition-chips";
import type { ProviderAccount, RoutingRule } from "@/lib/types";

/** Context fields the routing engine can match on (apps/api/src/modules/routing/engine.ts). */
export const ROUTING_FIELDS = ["country", "currency", "merchant_id", "project_id", "payment_method", "amount", "transaction_type", "risk_score", "hour_of_day", "day_of_week", "customer_country"] as const;
export const ROUTING_OPS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between"] as const;
const NUMERIC_FIELDS = new Set<string>(["amount", "risk_score", "hour_of_day", "day_of_week"]);
const FIELD_HINT: Record<string, string> = {
  amount: "minor units (e.g. 500000 = 5,000.00)",
  risk_score: "0 – 100",
  hour_of_day: "0 – 23, UTC",
  day_of_week: "0 = Sunday … 6 = Saturday",
  country: "ISO 3166-1 alpha-2, e.g. VN",
  customer_country: "ISO 3166-1 alpha-2",
  currency: "ISO 4217, e.g. USD",
  payment_method: "card, bank_transfer, qr, wallet, open_banking…",
  transaction_type: "payment or payout",
};

interface ConditionRow {
  field: string;
  op: string;
  value: string;
  value2: string;
}

interface RouteRow {
  provider_account_id: string;
  weight: string;
}

function toRows(conditions: RoutingRule["conditions"]): ConditionRow[] {
  return conditions.map((c) => {
    if (Array.isArray(c.value)) {
      if (c.op === "between") return { field: c.field, op: c.op, value: String(c.value[0] ?? ""), value2: String(c.value[1] ?? "") };
      return { field: c.field, op: c.op, value: c.value.join(", "), value2: "" };
    }
    return { field: c.field, op: c.op, value: String(c.value), value2: "" };
  });
}

function parseCondition(row: ConditionRow): Condition {
  const numeric = NUMERIC_FIELDS.has(row.field);
  const one = (raw: string): string | number => {
    const t = raw.trim();
    if (!t) throw new Error(`${row.field}: a value is required`);
    if (!numeric) return t;
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`${row.field}: "${t}" is not a number`);
    return n;
  };
  if (row.op === "in" || row.op === "not_in") {
    const parts = row.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) throw new Error(`${row.field}: list at least one value, comma separated`);
    return { field: row.field, op: row.op, value: parts.map(one) };
  }
  if (row.op === "between") return { field: row.field, op: row.op, value: [one(row.value), one(row.value2)] };
  return { field: row.field, op: row.op, value: one(row.value) };
}

export function RoutingRuleForm({ rule, accounts, merchants }: { rule?: RoutingRule; accounts: ProviderAccount[]; merchants: Array<{ id: string; name: string }> }) {
  const session = useSession();
  const router = useRouter();
  const canManage = adminCan(session.user.role, "routing.manage");
  const [form, setForm] = useState({
    name: rule?.name ?? "",
    description: rule?.description ?? "",
    mode: rule?.mode ?? session.mode,
    transaction_type: rule?.transactionType ?? "payment",
    priority: String(rule?.priority ?? 100),
    enabled: rule?.enabled ?? true,
    merchant_id: rule?.merchantId ?? "",
    strategy: rule?.strategy ?? "ordered",
  });
  const [conditions, setConditions] = useState<ConditionRow[]>(rule ? toRows(rule.conditions) : []);
  const [routes, setRoutes] = useState<RouteRow[]>(rule ? rule.routes.map((r) => ({ provider_account_id: r.provider_account_id, weight: String(r.weight) })) : []);
  const [addAccount, setAddAccount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modeAccounts = useMemo(() => accounts.filter((a) => a.mode === form.mode), [accounts, form.mode]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const available = modeAccounts.filter((a) => !routes.some((r) => r.provider_account_id === a.id));

  function setCondition(i: number, patch: Partial<ConditionRow>) {
    setConditions((c) => c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function moveRoute(i: number, delta: number) {
    setRoutes((r) => {
      const next = [...r];
      const j = i + delta;
      if (j < 0 || j >= next.length) return r;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let parsed: Condition[];
    try {
      parsed = conditions.map(parseCondition);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    const priority = Number.parseInt(form.priority, 10);
    if (Number.isNaN(priority)) {
      setError("Priority must be a number.");
      return;
    }
    if (!routes.length) {
      setError("Add at least one provider account to the route.");
      return;
    }
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      merchant_id: form.merchant_id || null,
      mode: form.mode,
      priority,
      enabled: form.enabled,
      transaction_type: form.transaction_type,
      conditions: parsed,
      strategy: form.strategy,
      routes: routes.map((r) => (form.strategy === "weighted" ? { provider_account_id: r.provider_account_id, weight: Number.parseInt(r.weight, 10) || 100 } : { provider_account_id: r.provider_account_id })),
    };
    setLoading(true);
    try {
      if (rule) await session.api(`/admin/routing/rules/${rule.id}`, { method: "PATCH", body });
      else await session.api("/admin/routing/rules", { body });
      session.toast(rule ? `Rule "${body.name}" updated` : `Rule "${body.name}" created`, "ok");
      router.push("/admin/routing");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  if (!canManage) return <Alert tone="warn">Your role cannot manage routing rules. Ask an operations or superadmin user to make this change.</Alert>;

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <Alert tone="bad">{error}</Alert> : null}

      <Card title="Rule" description="Rules are evaluated per transaction, lowest priority number first; the first matching rule decides the provider chain.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Field label="Name" htmlFor="rr-name">
              <input id="rr-name" className="input" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cards → Acquirer A, fallback Acquirer B" />
            </Field>
          </div>
          <Field label="Priority" htmlFor="rr-priority" help="Lower runs first">
            <input id="rr-priority" className="input" type="number" min={0} max={10000} required value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
          </Field>
          <div className="xl:col-span-3">
            <Field label="Description" htmlFor="rr-description" help="Optional, max 500 characters — why this rule exists">
              <input id="rr-description" className="input" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Mode" htmlFor="rr-mode" help="Rules only apply in their own mode">
            <select id="rr-mode" className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "test" | "live" })}>
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </Field>
          <Field label="Transaction type" htmlFor="rr-type">
            <select id="rr-type" className="input" value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}>
              <option value="payment">payment</option>
              <option value="payout">payout</option>
            </select>
          </Field>
          <Field label="Scope" htmlFor="rr-merchant" help="Global rules apply to every merchant">
            <select id="rr-merchant" className="input" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}>
              <option value="">Global (all merchants)</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Strategy" htmlFor="rr-strategy" help={form.strategy === "ordered" ? "Try the accounts in the listed order" : form.strategy === "weighted" ? "Split traffic across accounts by weight" : "Rank accounts by cost, approval rate, uptime and latency"}>
            <select id="rr-strategy" className="input" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
              <option value="ordered">ordered</option>
              <option value="weighted">weighted</option>
              <option value="score">score</option>
            </select>
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-[7px] text-[13px] text-ink-800">
              <input type="checkbox" className="h-4 w-4 rounded border-ink-300" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Enabled
            </label>
          </div>
        </div>
      </Card>

      <Card
        title="Conditions"
        description="All conditions must match for the rule to apply. No conditions = always matches."
        actions={
          <Button type="button" size="sm" onClick={() => setConditions([...conditions, { field: "country", op: "eq", value: "", value2: "" }])}>
            Add condition
          </Button>
        }
      >
        {conditions.length ? (
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="w-[170px]">
                  <label className="label" htmlFor={`cond-f-${i}`}>
                    Field
                  </label>
                  <select id={`cond-f-${i}`} className="input" value={c.field} onChange={(e) => setCondition(i, { field: e.target.value })}>
                    {ROUTING_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-[110px]">
                  <label className="label" htmlFor={`cond-o-${i}`}>
                    Operator
                  </label>
                  <select id={`cond-o-${i}`} className="input" value={c.op} onChange={(e) => setCondition(i, { op: e.target.value })}>
                    {ROUTING_OPS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[200px] max-w-[420px] flex-1">
                  <label className="label" htmlFor={`cond-v-${i}`}>
                    {c.op === "in" || c.op === "not_in" ? "Values (comma separated)" : c.op === "between" ? "From" : "Value"}
                  </label>
                  <input id={`cond-v-${i}`} className="input" value={c.value} onChange={(e) => setCondition(i, { value: e.target.value })} placeholder={c.op === "in" || c.op === "not_in" ? "VN, TH, ID" : FIELD_HINT[c.field] ?? ""} />
                </div>
                {c.op === "between" ? (
                  <div className="w-[160px]">
                    <label className="label" htmlFor={`cond-v2-${i}`}>
                      To
                    </label>
                    <input id={`cond-v2-${i}`} className="input" value={c.value2} onChange={(e) => setCondition(i, { value2: e.target.value })} />
                  </div>
                ) : null}
                <Button type="button" variant="ghost" onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}>
                  Remove
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-ink-400">{FIELD_HINT[conditions[conditions.length - 1]?.field ?? ""] ? `${conditions[conditions.length - 1]!.field}: ${FIELD_HINT[conditions[conditions.length - 1]!.field]}` : "Values are matched against the transaction context at routing time."}</p>
          </div>
        ) : (
          <p className="text-[13px] text-ink-500">No conditions — this rule matches every {form.transaction_type} in {form.mode} mode.</p>
        )}
      </Card>

      <Card title="Provider chain" description="Accounts the rule routes to, in order. Fallbacks are used when an attempt fails with a retryable outcome." padded={false}>
        <div className="divide-y divide-ink-100">
          {routes.map((r, i) => {
            const a = byId.get(r.provider_account_id);
            return (
              <div key={r.provider_account_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="w-6 text-[12px] text-ink-400">{i + 1}.</span>
                <div className="min-w-[220px] flex-1">
                  <div className="text-[13px] font-medium">{a ? a.provider_name ?? a.name : r.provider_account_id}</div>
                  <div className="text-[11px] text-ink-500">
                    {a ? a.name : "unknown account"} · <Mono className="text-[11px]">{r.provider_account_id}</Mono>
                    {a && a.mode !== form.mode ? <Tag tone="bad">{a.mode} account</Tag> : null}
                  </div>
                </div>
                {form.strategy === "weighted" ? (
                  <label className="flex items-center gap-2 text-[12px] text-ink-500">
                    Weight
                    <input className="input !w-[90px] !py-[3px] text-[12px]" type="number" min={1} max={1000} value={r.weight} onChange={(e) => setRoutes(routes.map((x, idx) => (idx === i ? { ...x, weight: e.target.value } : x)))} />
                  </label>
                ) : null}
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => moveRoute(i, -1)}>
                    ↑
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={i === routes.length - 1} onClick={() => moveRoute(i, 1)}>
                    ↓
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRoutes(routes.filter((_, idx) => idx !== i))}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
          {routes.length ? null : <div className="px-4 py-6 text-center text-[13px] text-ink-500">No provider accounts yet — a rule without a chain cannot route.</div>}
          <div className="flex flex-wrap items-end gap-2 bg-ink-50 px-4 py-3">
            <div className="min-w-[280px] flex-1">
              <label className="label" htmlFor="rr-add">
                Add provider account ({form.mode} mode)
              </label>
              <select id="rr-add" className="input" value={addAccount} onChange={(e) => setAddAccount(e.target.value)}>
                <option value="">Select an account…</option>
                {available.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.provider_name ?? "Provider"} — {a.name}
                    {a.status !== "active" ? ` (${a.status})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              disabled={!addAccount}
              onClick={() => {
                if (!addAccount) return;
                setRoutes([...routes, { provider_account_id: addAccount, weight: "100" }]);
                setAddAccount("");
              }}
            >
              Add to chain
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={loading}>
          {rule ? "Save rule" : "Create rule"}
        </Button>
        <LinkButton href="/admin/routing" variant="ghost">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
