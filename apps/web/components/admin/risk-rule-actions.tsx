"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/admin/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button, Field } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import type { Condition } from "@/components/admin/condition-chips";
import type { Mode, RiskRule } from "@/lib/types";

/** Signals the risk engine computes per payment (apps/api/src/modules/risk/service.ts). */
const RISK_FIELDS = ["country", "amount", "currency", "payment_method", "merchant_id", "ip", "device_fingerprint", "customer_email", "velocity_1h", "velocity_24h", "failed_attempts_24h", "amount_24h"] as const;
const RISK_OPS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte"] as const;
const NUMERIC_FIELDS = new Set<string>(["amount", "velocity_1h", "velocity_24h", "failed_attempts_24h", "amount_24h"]);
const FIELD_HINT: Record<string, string> = {
  amount: "minor units",
  amount_24h: "minor units in the last 24h",
  velocity_1h: "payments in the last hour",
  velocity_24h: "payments in the last 24h",
  failed_attempts_24h: "failed attempts in the last 24h",
  country: "ISO 3166-1 alpha-2",
  currency: "ISO 4217",
};

interface ConditionRow {
  field: string;
  op: string;
  value: string;
}

interface RiskForm {
  name: string;
  description: string;
  mode: Mode;
  merchant_id: string;
  priority: string;
  enabled: boolean;
  action: string;
  score: string;
}

function toRows(conditions: RiskRule["conditions"]): ConditionRow[] {
  return conditions.map((c) => ({ field: c.field, op: c.op, value: Array.isArray(c.value) ? c.value.join(", ") : String(c.value) }));
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
  return { field: row.field, op: row.op, value: one(row.value) };
}

function RiskRuleFields({ form, setForm, conditions, setConditions, merchants }: { form: RiskForm; setForm: (f: RiskForm) => void; conditions: ConditionRow[]; setConditions: (c: ConditionRow[]) => void; merchants: Array<{ id: string; name: string }> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Name" htmlFor="rk-name">
            <input id="rk-name" className="input" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Block restricted countries" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Description" htmlFor="rk-description" help="Optional, max 500 characters">
            <input id="rk-description" className="input" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <Field label="Mode" htmlFor="rk-mode">
          <select id="rk-mode" className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as Mode })}>
            <option value="test">test</option>
            <option value="live">live</option>
          </select>
        </Field>
        <Field label="Scope" htmlFor="rk-merchant" help="Global rules apply to every merchant">
          <select id="rk-merchant" className="input" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}>
            <option value="">Global (all merchants)</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Action" htmlFor="rk-action" help={form.action === "block" ? "Payment is declined immediately" : form.action === "review" ? "Payment is held for manual review" : "Payment continues; only the score is added"}>
          <select id="rk-action" className="input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
            <option value="allow">allow</option>
            <option value="review">review</option>
            <option value="block">block</option>
          </select>
        </Field>
        <Field label="Score" htmlFor="rk-score" help="0 – 100, added to the payment's risk score when matched">
          <input id="rk-score" className="input" type="number" min={0} max={100} value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} />
        </Field>
        <Field label="Priority" htmlFor="rk-priority" help="Lower runs first">
          <input id="rk-priority" className="input" type="number" min={0} max={10000} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-[7px] text-[13px] text-ink-800">
            <input type="checkbox" className="h-4 w-4 rounded border-ink-300" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Enabled
          </label>
        </div>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="label !mb-0">Conditions (all must match)</span>
          <Button type="button" size="sm" onClick={() => setConditions([...conditions, { field: "country", op: "eq", value: "" }])}>
            Add condition
          </Button>
        </div>
        {conditions.length ? (
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className="input !w-[170px]" value={c.field} onChange={(e) => setConditions(conditions.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))} aria-label="Field">
                  {RISK_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select className="input !w-[90px]" value={c.op} onChange={(e) => setConditions(conditions.map((x, idx) => (idx === i ? { ...x, op: e.target.value } : x)))} aria-label="Operator">
                  {RISK_OPS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input className="input !w-auto min-w-[140px] flex-1" value={c.value} onChange={(e) => setConditions(conditions.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))} placeholder={c.op === "in" || c.op === "not_in" ? "KP, IR, SY" : FIELD_HINT[c.field] ?? "value"} aria-label="Value" />
                <Button type="button" size="sm" variant="ghost" onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-500">At least one condition is required.</p>
        )}
      </div>
    </div>
  );
}

function buildBody(form: RiskForm, conditions: ConditionRow[]) {
  const parsed = conditions.map(parseCondition);
  if (!parsed.length) throw new Error("Add at least one condition.");
  const priority = Number.parseInt(form.priority, 10);
  const score = Number.parseInt(form.score, 10);
  if (Number.isNaN(priority) || Number.isNaN(score)) throw new Error("Priority and score must be numbers.");
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    merchant_id: form.merchant_id || null,
    mode: form.mode,
    priority,
    enabled: form.enabled,
    conditions: parsed,
    action: form.action,
    score,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export function CreateRiskRule({ merchants }: { merchants: Array<{ id: string; name: string }> }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RiskForm>({ name: "", description: "", mode: session.mode, merchant_id: "", priority: "100", enabled: true, action: "review", score: "40" });
  const [conditions, setConditions] = useState<ConditionRow[]>([{ field: "country", op: "in", value: "" }]);
  if (!adminCan(session.user.role, "risk.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let body: ReturnType<typeof buildBody>;
    try {
      body = buildBody(form, conditions);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    setLoading(true);
    try {
      await session.api("/admin/risk/rules", { body });
      session.toast(`Rule "${body.name}" created`, "ok");
      setOpen(false);
      setForm({ ...form, name: "", description: "" });
      setConditions([{ field: "country", op: "in", value: "" }]);
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
        New risk rule
      </Button>
      {open ? (
        <Modal title="New risk rule" description="Rules are evaluated on every payment before routing, lowest priority number first. Block wins over review." onClose={() => setOpen(false)} onSubmit={submit} submitLabel="Create rule" loading={loading} error={error} width={620}>
          <RiskRuleFields form={form} setForm={setForm} conditions={conditions} setConditions={setConditions} merchants={merchants} />
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-row controls (enabled toggle, edit, delete)
// ---------------------------------------------------------------------------
export function RiskRuleControls({ rule, merchants }: { rule: RiskRule; merchants: Array<{ id: string; name: string }> }) {
  const session = useSession();
  const router = useRouter();
  const canManage = adminCan(session.user.role, "risk.manage");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RiskForm>({ name: rule.name, description: rule.description ?? "", mode: rule.mode, merchant_id: rule.merchantId ?? "", priority: String(rule.priority), enabled: rule.enabled, action: rule.action, score: String(rule.score) });
  const [conditions, setConditions] = useState<ConditionRow[]>(toRows(rule.conditions));

  async function toggle(enabled: boolean) {
    setBusy("enabled");
    try {
      await session.api(`/admin/risk/rules/${rule.id}`, { method: "PATCH", body: { enabled } });
      session.toast(`${rule.name} ${enabled ? "enabled" : "disabled"}`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete risk rule "${rule.name}"? Payments will no longer be scored by it.`)) return;
    setBusy("delete");
    try {
      await session.api(`/admin/risk/rules/${rule.id}`, { method: "DELETE" });
      session.toast(`${rule.name} deleted`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let body: ReturnType<typeof buildBody>;
    try {
      body = buildBody(form, conditions);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    setBusy("edit");
    try {
      await session.api(`/admin/risk/rules/${rule.id}`, { method: "PATCH", body });
      session.toast(`${body.name} updated`, "ok");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
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
            <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(true); }}>
              Edit
            </Button>
            <Button size="sm" variant="danger" loading={busy === "delete"} onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        ) : (
          <div className="text-right text-[11px] text-ink-400">read-only</div>
        )}
        {editing ? (
          <Modal title={`Edit ${rule.name}`} description="Changes apply to payments created after saving." onClose={() => setEditing(false)} onSubmit={save} submitLabel="Save rule" loading={busy === "edit"} error={error} width={620}>
            <RiskRuleFields form={form} setForm={setForm} conditions={conditions} setConditions={setConditions} merchants={merchants} />
          </Modal>
        ) : null}
      </td>
    </>
  );
}
