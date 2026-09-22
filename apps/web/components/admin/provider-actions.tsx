"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, type FormEvent } from "react";
import { LevelTag } from "@/components/admin/condition-chips";
import { Modal } from "@/components/admin/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button, EmptyState, Field, Mono, StatusBadge, Table, Tag, cx } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import type { HealthCheckResult, SystemEvent } from "@/lib/admin-types";
import { formatDateTime, formatMoney, formatMs, formatNumber, formatPercent } from "@/lib/format";
import type { Provider, ProviderAccount } from "@/lib/types";

const OUTCOMES = ["provider_unavailable", "timeout", "technical_error", "soft_decline", "hard_decline"];

// ---------------------------------------------------------------------------
// Provider enable / disable
// ---------------------------------------------------------------------------
export function ProviderStatusButton({ provider }: { provider: Pick<Provider, "id" | "name" | "status"> }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!adminCan(session.user.role, "providers.manage")) return null;
  const next = provider.status === "active" ? "disabled" : "active";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await session.api(`/admin/providers/${provider.id}/status`, { body: { status: next, reason: reason || undefined } });
      session.toast(`${provider.name} ${next}`, "ok");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant={next === "disabled" ? "danger" : "primary"} onClick={() => setOpen(true)}>
        {next === "disabled" ? "Disable provider" : "Enable provider"}
      </Button>
      {open ? (
        <Modal title={`${next === "disabled" ? "Disable" : "Enable"} ${provider.name}`} description={next === "disabled" ? "All accounts of this provider become ineligible for routing immediately. Payments in flight continue. The reason is written to the audit log and a system event is emitted." : "Accounts of this provider become eligible for routing again."} onClose={() => setOpen(false)} onSubmit={submit} submitLabel={next === "disabled" ? "Disable" : "Enable"} submitVariant={next === "disabled" ? "danger" : "primary"} loading={loading} error={error}>
          <Field label="Reason" htmlFor="preason" help="Optional, max 300 characters">
            <input id="preason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. scheduled maintenance window" />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Accounts table with per-row actions
// ---------------------------------------------------------------------------
interface AccountForm {
  name: string;
  priority: string;
  fee_percent: string;
  fee_fixed_minor: string;
  min_amount: string;
  max_amount: string;
  currencies: string;
}

function toForm(a: ProviderAccount): AccountForm {
  return { name: a.name, priority: String(a.priority), fee_percent: String(a.fee_percent), fee_fixed_minor: String(a.fee_fixed_minor), min_amount: a.limits.minAmount != null ? String(a.limits.minAmount) : "", max_amount: a.limits.maxAmount != null ? String(a.limits.maxAmount) : "", currencies: a.currencies.join(", ") };
}

function parseCurrencies(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

export function AccountsTable({ accounts }: { accounts: ProviderAccount[] }) {
  const session = useSession();
  const router = useRouter();
  const canManage = adminCan(session.user.role, "providers.manage");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProviderAccount | null>(null);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, SystemEvent[] | "loading">>({});

  async function patch(account: ProviderAccount, label: string, body: unknown) {
    setBusy(`${account.id}:${label}`);
    try {
      await session.api(`/admin/provider-accounts/${account.id}`, { method: "PATCH", body });
      session.toast(`${account.name}: ${label}`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function healthCheck(account: ProviderAccount) {
    setBusy(`${account.id}:health`);
    try {
      const r = await session.api<HealthCheckResult>(`/admin/provider-accounts/${account.id}/health-check`, { body: {} });
      session.toast(`${account.name}: ${r.ok ? "healthy" : "unhealthy"} · ${r.message ?? ""} (${formatMs(r.latencyMs)})`, r.ok ? "ok" : "bad");
      if (expanded === account.id) void loadEvents(account.id, true);
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function loadEvents(id: string, force = false) {
    if (!force && events[id] && events[id] !== "loading") return;
    setEvents((e) => ({ ...e, [id]: "loading" }));
    try {
      const r = await session.api<{ data: SystemEvent[] }>(`/admin/provider-accounts/${id}/events`);
      setEvents((e) => ({ ...e, [id]: r.data }));
    } catch (err) {
      session.toast(errorMessage(err), "bad");
      setEvents((e) => ({ ...e, [id]: [] }));
    }
  }

  function toggleEvents(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    void loadEvents(id);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || !form) return;
    setError(null);
    const limits: { minAmount?: number; maxAmount?: number } = {};
    if (form.min_amount.trim()) limits.minAmount = Number.parseInt(form.min_amount, 10);
    if (form.max_amount.trim()) limits.maxAmount = Number.parseInt(form.max_amount, 10);
    const body = {
      name: form.name.trim(),
      priority: Number.parseInt(form.priority, 10),
      fee_percent: Number.parseFloat(form.fee_percent),
      fee_fixed_minor: Number.parseInt(form.fee_fixed_minor, 10),
      limits,
      currencies: parseCurrencies(form.currencies),
    };
    if ([body.priority, body.fee_percent, body.fee_fixed_minor].some((n) => Number.isNaN(n))) {
      setError("Priority, fee percent and fixed fee must be numbers.");
      return;
    }
    setBusy(`${editing.id}:edit`);
    try {
      await session.api(`/admin/provider-accounts/${editing.id}`, { method: "PATCH", body });
      session.toast(`${body.name} updated`, "ok");
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!accounts.length) return <EmptyState title="No accounts" description="Add a provider account to make this provider routable." />;

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Mode</th>
            <th>Status</th>
            <th className="num">Priority</th>
            <th className="num">Fee</th>
            <th>Limits</th>
            <th>Currencies</th>
            <th>Health 24h</th>
            <th>Simulation</th>
            {canManage ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const sim = a.config.simulation?.forceOutcome ?? "";
            const isBusy = (label: string) => busy === `${a.id}:${label}`;
            return (
              <Fragment key={a.id}>
                <tr className={cx(expanded === a.id && "bg-ink-50")}>
                  <td>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-[11px] text-ink-500">
                      <Mono className="text-[11px]">{a.id}</Mono>
                      {a.merchant_id ? ` · dedicated to ${a.merchant_id}` : " · shared"}
                      {a.has_credentials ? "" : " · no credentials"}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={a.mode} label={a.mode === "test" ? "Test" : "Live"} />
                  </td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="num">{a.priority}</td>
                  <td className="num">
                    {a.fee_percent}%{a.fee_fixed_minor ? ` + ${a.fee_fixed_minor}` : ""}
                  </td>
                  <td className="text-[12px] text-ink-600">
                    {a.limits.minAmount != null || a.limits.maxAmount != null ? `${a.limits.minAmount != null ? formatNumber(a.limits.minAmount) : "0"} – ${a.limits.maxAmount != null ? formatNumber(a.limits.maxAmount) : "∞"}` : <span className="text-ink-400">none</span>}
                  </td>
                  <td className="text-[12px] text-ink-600">{a.currencies.length ? (a.currencies.length > 4 ? `${a.currencies.slice(0, 4).join(", ")} +${a.currencies.length - 4}` : a.currencies.join(", ")) : <span className="text-ink-400">provider default</span>}</td>
                  <td className="text-[12px]">
                    {a.health && a.health.attempts ? (
                      <span>
                        {formatNumber(a.health.attempts)} att · {formatPercent(a.health.approval_rate, 0)} appr · {formatPercent(a.health.uptime, 0)} up · {formatMs(a.health.avg_latency_ms)}
                      </span>
                    ) : (
                      <span className="text-ink-400">no traffic</span>
                    )}
                  </td>
                  <td>
                    {canManage ? (
                      <select className="input h-7 w-[170px] py-0 text-[12px]" value={sim} disabled={isBusy("simulation")} onChange={(e) => void patch(a, "simulation", { config: { simulation: { ...(a.config.simulation ?? {}), forceOutcome: e.target.value || null } } })} aria-label="Simulate outcome">
                        <option value="">none (normal)</option>
                        {OUTCOMES.map((o) => (
                          <option key={o} value={o}>
                            force {o.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    ) : sim ? (
                      <Tag tone="warn">force {sim}</Tag>
                    ) : (
                      <span className="text-ink-400">none</span>
                    )}
                  </td>
                  {canManage ? (
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" loading={isBusy("health")} onClick={() => void healthCheck(a)}>
                          Health check
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleEvents(a.id)}>
                          {expanded === a.id ? "Hide events" : "Events"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(a); setForm(toForm(a)); }}>
                          Edit
                        </Button>
                        <Button size="sm" variant={a.status === "active" ? "danger" : "primary"} loading={isBusy("status")} onClick={() => void patch(a, a.status === "active" ? "disabled" : "enabled", { status: a.status === "active" ? "disabled" : "active" })}>
                          {a.status === "active" ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
                {expanded === a.id ? (
                  <tr className="bg-ink-50">
                    <td colSpan={canManage ? 10 : 9} className="!whitespace-normal">
                      <EventsList items={events[a.id]} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
      {!canManage ? (
        <div className="border-t border-ink-100 px-4 py-2 text-[11px] text-ink-400">
          Read-only: your role cannot manage provider accounts.{" "}
          <button className="underline" onClick={() => accounts[0] && toggleEvents(accounts[0].id)}>
            Show recent events of the first account
          </button>
        </div>
      ) : null}

      {editing && form ? (
        <Modal title={`Edit ${editing.name}`} description="Fees drive the cost factor in score-based routing; limits and currencies drive eligibility." onClose={() => setEditing(null)} onSubmit={saveEdit} loading={busy === `${editing.id}:edit`} error={error}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Name" htmlFor="an">
                <input id="an" className="input" minLength={2} maxLength={80} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
            </div>
            <Field label="Priority" htmlFor="ap" help="Lower = preferred when no rule applies">
              <input id="ap" className="input" type="number" min={0} max={10000} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </Field>
            <Field label="Fee percent" htmlFor="af" help="e.g. 2.4">
              <input id="af" className="input" type="number" step="0.01" min={0} max={100} value={form.fee_percent} onChange={(e) => setForm({ ...form, fee_percent: e.target.value })} />
            </Field>
            <Field label="Fixed fee (minor units)" htmlFor="aff">
              <input id="aff" className="input" type="number" min={0} value={form.fee_fixed_minor} onChange={(e) => setForm({ ...form, fee_fixed_minor: e.target.value })} />
            </Field>
            <Field label="Currencies" htmlFor="ac" help="Comma separated; empty = provider default">
              <input id="ac" className="input" placeholder="USD, EUR" value={form.currencies} onChange={(e) => setForm({ ...form, currencies: e.target.value })} />
            </Field>
            <Field label="Min amount (minor)" htmlFor="amin" help="Empty = no minimum">
              <input id="amin" className="input" type="number" min={0} value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: e.target.value })} />
            </Field>
            <Field label="Max amount (minor)" htmlFor="amax" help="Empty = no maximum">
              <input id="amax" className="input" type="number" min={1} value={form.max_amount} onChange={(e) => setForm({ ...form, max_amount: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function EventsList({ items }: { items: SystemEvent[] | "loading" | undefined }) {
  if (!items || items === "loading") return <div className="px-1 py-2 text-[12px] text-ink-500">Loading events…</div>;
  if (!items.length) return <div className="px-1 py-2 text-[12px] text-ink-500">No system events for this account.</div>;
  return (
    <ul className="divide-y divide-ink-100 py-1">
      {items.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[12px]">
          <LevelTag level={e.level} />
          <Mono className="text-[11px]">{e.type}</Mono>
          <span className="text-ink-700">{e.message}</span>
          <span className="ml-auto text-[11px] text-ink-400">
            {e.source} · {formatDateTime(e.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Add provider account
// ---------------------------------------------------------------------------
export function AddProviderAccount({ providers, merchants }: { providers: Array<Pick<Provider, "id" | "name" | "status">>; merchants: Array<{ id: string; name: string }> }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ provider_id: providers[0]?.id ?? "", mode: "test", name: "", merchant_id: "", priority: "100", fee_percent: "0", fee_fixed_minor: "0", currencies: "", credentials: "{}" });
  if (!adminCan(session.user.role, "providers.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let credentials: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = form.credentials.trim() ? JSON.parse(form.credentials) : undefined;
      if (parsed !== undefined && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) throw new Error("Credentials must be a JSON object");
      credentials = parsed as Record<string, unknown> | undefined;
    } catch (err) {
      setError(`Credentials: ${errorMessage(err)}`);
      return;
    }
    setLoading(true);
    try {
      const acc = await session.api<ProviderAccount>("/admin/provider-accounts", {
        body: {
          provider_id: form.provider_id,
          mode: form.mode,
          name: form.name.trim(),
          merchant_id: form.merchant_id || undefined,
          priority: Number.parseInt(form.priority, 10),
          fee_percent: Number.parseFloat(form.fee_percent),
          fee_fixed_minor: Number.parseInt(form.fee_fixed_minor, 10),
          currencies: parseCurrencies(form.currencies),
          credentials: credentials && Object.keys(credentials).length ? credentials : undefined,
        },
      });
      session.toast(`Account ${acc.name} created`, "ok");
      setOpen(false);
      setForm({ ...form, name: "", credentials: "{}" });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add provider account
      </Button>
      {open ? (
        <Modal title="Add provider account" description="A concrete integration (MID / credentials) for a provider in one mode. Credentials are encrypted at rest and never returned by the API." onClose={() => setOpen(false)} onSubmit={submit} submitLabel="Create account" loading={loading} error={error} width={560}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider" htmlFor="np">
              <select id="np" className="input" value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })} required>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.status !== "active" ? ` (${p.status})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mode" htmlFor="nm">
              <select id="nm" className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="test">test</option>
                <option value="live">live</option>
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="Name" htmlFor="nn">
                <input id="nn" className="input" minLength={2} maxLength={80} required placeholder="Acquirer A · Live EU" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Dedicated merchant" htmlFor="nmer" help="Leave empty for a shared platform account">
                <select id="nmer" className="input" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}>
                  <option value="">Shared (all merchants)</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Priority" htmlFor="npr">
              <input id="npr" className="input" type="number" min={0} max={10000} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </Field>
            <Field label="Currencies" htmlFor="nc" help="Comma separated; empty = provider default">
              <input id="nc" className="input" placeholder="USD, EUR" value={form.currencies} onChange={(e) => setForm({ ...form, currencies: e.target.value })} />
            </Field>
            <Field label="Fee percent" htmlFor="nf">
              <input id="nf" className="input" type="number" step="0.01" min={0} max={100} value={form.fee_percent} onChange={(e) => setForm({ ...form, fee_percent: e.target.value })} />
            </Field>
            <Field label="Fixed fee (minor units)" htmlFor="nff">
              <input id="nff" className="input" type="number" min={0} value={form.fee_fixed_minor} onChange={(e) => setForm({ ...form, fee_fixed_minor: e.target.value })} />
            </Field>
            <div className="col-span-2">
              <Field label="Credentials (JSON, write-only)" htmlFor="ncred" help="Provider API keys / MID as a JSON object. Stored encrypted; cannot be read back.">
                <textarea id="ncred" className="input mono" rows={4} spellCheck={false} value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function feeLabel(a: ProviderAccount, currency?: string | null) {
  return `${a.fee_percent}%${a.fee_fixed_minor ? ` + ${currency ? formatMoney(a.fee_fixed_minor, currency) : a.fee_fixed_minor}` : ""}`;
}
