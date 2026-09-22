"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Card, EmptyState, Field, LinkButton, Mono, Table, Tag } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import type { RoutingSimulation } from "@/lib/admin-types";
import type { RoutingRule } from "@/lib/types";

/**
 * Enabled toggle + ordering / delete controls for one routing rule.
 * Renders the last two cells of the rule row (enabled, actions).
 */
export function RoutingRuleControls({ rule, groupIds }: { rule: Pick<RoutingRule, "id" | "name" | "enabled">; groupIds: string[] }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = adminCan(session.user.role, "routing.manage");
  const index = groupIds.indexOf(rule.id);

  async function toggle(enabled: boolean) {
    setBusy("enabled");
    try {
      await session.api(`/admin/routing/rules/${rule.id}`, { method: "PATCH", body: { enabled } });
      session.toast(`${rule.name} ${enabled ? "enabled" : "disabled"}`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function move(delta: number) {
    const target = index + delta;
    if (index < 0 || target < 0 || target >= groupIds.length) return;
    const order = [...groupIds];
    [order[index], order[target]] = [order[target]!, order[index]!];
    setBusy("move");
    try {
      await session.api("/admin/routing/reorder", { body: { order } });
      session.toast(`${rule.name} moved ${delta < 0 ? "up" : "down"}`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete routing rule "${rule.name}"? Transactions that matched it will fall through to the next matching rule.`)) return;
    setBusy("delete");
    try {
      await session.api(`/admin/routing/rules/${rule.id}`, { method: "DELETE" });
      session.toast(`${rule.name} deleted`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <td>
        <label className="flex items-center gap-2 text-[12px] text-ink-500">
          <input type="checkbox" className="h-4 w-4 rounded border-ink-300" checked={rule.enabled} disabled={!canManage || busy !== null} onChange={(e) => void toggle(e.target.checked)} aria-label={`Enable ${rule.name}`} />
          {rule.enabled ? "on" : "off"}
        </label>
      </td>
      <td>
        {canManage ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" disabled={busy !== null || index <= 0} onClick={() => void move(-1)} aria-label="Move up">
              ↑
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null || index < 0 || index >= groupIds.length - 1} onClick={() => void move(1)} aria-label="Move down">
              ↓
            </Button>
            <LinkButton href={`/admin/routing/${rule.id}`} size="sm">
              Edit
            </LinkButton>
            <Button size="sm" variant="danger" loading={busy === "delete"} onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        ) : (
          <div className="text-right text-[11px] text-ink-400">read-only</div>
        )}
      </td>
    </>
  );
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------
export function RoutingSimulator({ merchants }: { merchants: Array<{ id: string; name: string }> }) {
  const session = useSession();
  const [form, setForm] = useState({ merchant_id: merchants[0]?.id ?? "", amount: "50000", currency: "USD", payment_method: "card", country: "", mode: session.mode as string, transaction_type: "payment" });
  const [result, setResult] = useState<RoutingSimulation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = Number.parseInt(form.amount, 10);
    if (Number.isNaN(amount) || amount <= 0) {
      setError("Amount must be a positive integer in minor units.");
      return;
    }
    setLoading(true);
    try {
      const r = await session.api<RoutingSimulation>("/admin/routing/simulate", {
        body: {
          merchant_id: form.merchant_id,
          mode: form.mode,
          transaction_type: form.transaction_type,
          amount,
          currency: form.currency.trim().toUpperCase(),
          payment_method: form.payment_method,
          country: form.country.trim() ? form.country.trim().toUpperCase() : undefined,
        },
      });
      setResult(r);
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Simulate routing" description="Dry-run a transaction context against the current rules. Nothing is charged and no payment is created.">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <Field label="Merchant" htmlFor="sim-merchant">
            <select id="sim-merchant" className="input" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })} required>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-[150px]">
          <Field label="Amount (minor)" htmlFor="sim-amount">
            <input id="sim-amount" className="input" type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
        </div>
        <div className="w-[100px]">
          <Field label="Currency" htmlFor="sim-currency">
            <input id="sim-currency" className="input" maxLength={3} minLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
          </Field>
        </div>
        <div className="w-[150px]">
          <Field label="Method" htmlFor="sim-method">
            <select id="sim-method" className="input" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              {["card", "bank_transfer", "qr", "wallet", "open_banking", "instant", "local"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-[100px]">
          <Field label="Country" htmlFor="sim-country">
            <input id="sim-country" className="input" maxLength={2} placeholder="US" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </Field>
        </div>
        <div className="w-[110px]">
          <Field label="Mode" htmlFor="sim-mode">
            <select id="sim-mode" className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </Field>
        </div>
        <div className="w-[130px]">
          <Field label="Type" htmlFor="sim-type">
            <select id="sim-type" className="input" value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}>
              <option value="payment">payment</option>
              <option value="payout">payout</option>
            </select>
          </Field>
        </div>
        <Button type="submit" variant="primary" loading={loading} disabled={!merchants.length}>
          Simulate
        </Button>
      </form>

      {error ? (
        <div className="mt-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 border-t border-ink-100 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">Matched rule</div>
              <div className="mt-0.5 text-[13px] font-medium text-ink-900">{result.rule ? result.rule.name : <span className="text-ink-400">no rule matched — provider priority order</span>}</div>
              {result.rule ? (
                <div className="text-[11px] text-ink-500">
                  <Mono className="text-[11px]">{result.rule.id}</Mono>
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">Strategy</div>
              <div className="mt-0.5 text-[13px] text-ink-900">{result.strategy}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">Reason</div>
              <div className="mt-0.5 text-[13px] text-ink-700">{result.reason}</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">Resulting provider order</div>
            {result.ordered.length ? (
              <ol className="mt-1 flex flex-wrap items-center gap-2">
                {result.ordered.map((o, i) => (
                  <li key={o.provider_account_id} className="flex items-center gap-2">
                    {i ? <span className="text-ink-300">→</span> : null}
                    <span className="rounded border border-ink-200 px-2 py-1 text-[12px]">
                      <span className="font-medium">{o.provider}</span> <span className="text-ink-500">{o.account}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-[13px] text-bad">No eligible provider account — this transaction would fail with no_provider_available.</p>
            )}
          </div>

          <div className="mt-4 -mx-4 -mb-4 border-t border-ink-100">
            {result.candidates.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Account</th>
                    <th>Eligible</th>
                    <th className="num">Score</th>
                    <th>Reasons</th>
                    <th>Factors</th>
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((c) => (
                    <tr key={c.providerAccountId}>
                      <td className="font-medium">{c.providerName}</td>
                      <td className="text-ink-600">{c.accountName}</td>
                      <td>{c.eligible ? <span className="text-ok">✓</span> : <span className="text-bad">✗</span>}</td>
                      <td className="num">{c.score.toFixed(2)}</td>
                      <td className="!whitespace-normal">
                        {c.reasons.length ? (
                          <span className="flex flex-wrap gap-1">
                            {c.reasons.map((r, i) => (
                              <Tag key={`${r}-${i}`} tone={c.eligible ? "neutral" : "bad"}>
                                {r}
                              </Tag>
                            ))}
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="!whitespace-normal">
                        {c.factors && Object.keys(c.factors).length ? (
                          <span className="flex flex-wrap gap-1">
                            {Object.entries(c.factors).map(([k, v]) => (
                              <Tag key={k}>
                                <Mono className="text-[11px]">
                                  {k}={typeof v === "number" ? Math.round(v * 1000) / 1000 : String(v)}
                                </Mono>
                              </Tag>
                            ))}
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No candidates" description="No provider account exists for this merchant in this mode." />
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
