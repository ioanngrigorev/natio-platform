"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/admin/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button, Field } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import type { ReconBatch } from "@/lib/types";

export interface AccountOption {
  id: string;
  name: string;
  provider: string;
  mode: string;
}

function isoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function summary(b: ReconBatch): string {
  const t = b.totals;
  const issues = t.MISSING_PROVIDER + t.MISSING_NATIO + t.AMOUNT_MISMATCH + t.STATUS_MISMATCH;
  return `${t.total} rows · ${t.MATCHED} matched · ${issues} need attention`;
}

// ---------------------------------------------------------------------------
// Sandbox run: reconciles a demo provider's own ledger against NATIO's
// ---------------------------------------------------------------------------
export function RunSandboxReconciliation({ accounts, merchants }: { accounts: AccountOption[]; merchants: Array<{ id: string; name: string }> }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ provider_account_id: accounts[0]?.id ?? "", merchant_id: "" });
  if (!adminCan(session.user.role, "reconciliation.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const b = await session.api<ReconBatch>("/admin/reconciliation/run-sandbox", { body: { provider_account_id: form.provider_account_id, merchant_id: form.merchant_id || undefined } });
      setOpen(false);
      session.toast(`Reconciliation complete — ${summary(b)}`, b.totals.total === b.totals.MATCHED ? "ok" : "info");
      router.push(`/admin/reconciliation/${b.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!accounts.length}>
        Run demo reconciliation
      </Button>
      {open ? (
        <Modal
          title="Run demo reconciliation"
          description="Sandbox only: builds the provider's report from the demo provider's own ledger and matches it against NATIO's transactions. No file needed."
          onClose={() => setOpen(false)}
          onSubmit={submit}
          submitLabel="Run reconciliation"
          loading={loading}
          error={error}
        >
          <div className="space-y-3">
            <Field label="Provider account" htmlFor="rs-account">
              <select id="rs-account" className="input" value={form.provider_account_id} onChange={(e) => setForm({ ...form, provider_account_id: e.target.value })} required>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.provider} — {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Merchant" htmlFor="rs-merchant" help="Optional: limit the batch to one merchant's transactions">
              <select id="rs-merchant" className="input" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}>
                <option value="">All merchants</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// CSV upload
// ---------------------------------------------------------------------------
export function UploadProviderCsv({ accounts, merchants }: { accounts: AccountOption[]; merchants: Array<{ id: string; name: string }> }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ provider_account_id: accounts[0]?.id ?? "", merchant_id: "", period_start: "", period_end: "" });
  const [file, setFile] = useState<File | null>(null);
  if (!adminCan(session.user.role, "reconciliation.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a CSV file.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("provider_account_id", form.provider_account_id);
      if (form.merchant_id) fd.append("merchant_id", form.merchant_id);
      const start = isoOrUndefined(form.period_start);
      const end = isoOrUndefined(form.period_end);
      if (start) fd.append("period_start", start);
      if (end) fd.append("period_end", end);
      fd.append("file", file, file.name);
      const b = await session.api<ReconBatch>("/admin/reconciliation/upload", { formData: fd });
      setOpen(false);
      session.toast(`Reconciliation complete — ${summary(b)}`, b.totals.total === b.totals.MATCHED ? "ok" : "info");
      router.push(`/admin/reconciliation/${b.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={!accounts.length}>
        Upload provider CSV
      </Button>
      {open ? (
        <Modal
          title="Upload a provider report"
          description="Every row of the provider's CSV is matched against NATIO's ledger for that provider account; differences are flagged for follow-up."
          onClose={() => setOpen(false)}
          onSubmit={submit}
          submitLabel="Run reconciliation"
          loading={loading}
          error={error}
          width={560}
        >
          <div className="space-y-3">
            <Field label="Provider account" htmlFor="ru-account">
              <select id="ru-account" className="input" value={form.provider_account_id} onChange={(e) => setForm({ ...form, provider_account_id: e.target.value })} required>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.provider} — {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Merchant" htmlFor="ru-merchant" help="Optional: limit the batch to one merchant's transactions">
              <select id="ru-merchant" className="input" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}>
                <option value="">All merchants</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period start (optional)" htmlFor="ru-from">
                <input id="ru-from" type="datetime-local" className="input" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
              </Field>
              <Field label="Period end (optional)" htmlFor="ru-to">
                <input id="ru-to" type="datetime-local" className="input" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
              </Field>
            </div>
            <Field label="CSV file" htmlFor="ru-file" help="Columns: provider_reference, natio_reference, type, amount, currency, status. Header names are matched case-insensitively.">
              <input id="ru-file" type="file" accept=".csv,text/csv" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Resolve one flagged item
// ---------------------------------------------------------------------------
export function ResolveReconItem({ item }: { item: { id: string; status: string; resolved_at: string | null } }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!adminCan(session.user.role, "reconciliation.manage")) return <span className="text-[11px] text-ink-400">—</span>;
  if (item.resolved_at) return <span className="text-[11px] text-ink-400">resolved</span>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await session.api(`/admin/reconciliation/items/${item.id}/resolve`, { body: { note: note.trim() } });
      session.toast("Item resolved", "ok");
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Resolve
      </Button>
      {open ? (
        <Modal
          title="Resolve reconciliation item"
          description="Records how this difference was handled. The note is stored on the item and written to the audit log; it does not change the ledger."
          onClose={() => setOpen(false)}
          onSubmit={submit}
          submitLabel="Mark resolved"
          loading={loading}
          error={error}
        >
          <Field label="Resolution note" htmlFor="rr-note" help="Required, max 500 characters">
            <textarea id="rr-note" className="input" rows={3} required minLength={1} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Provider confirmed the transaction settles in the next report." />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
