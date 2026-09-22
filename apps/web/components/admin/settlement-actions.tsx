"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/admin/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button, Field } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import type { SettlementImportResult } from "@/lib/admin-types";
import { formatMoney } from "@/lib/format";

export interface AccountOption {
  id: string;
  name: string;
  provider: string;
  mode: string;
}

const SOURCES = [
  { value: "provider_report", label: "provider report (file)" },
  { value: "provider_api", label: "provider API" },
  { value: "manual", label: "manual entry" },
];

function isoOrNull(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Builds settlements from a provider's report for a merchant, account and period. */
export function ImportSettlement({ merchants, accounts }: { merchants: Array<{ id: string; name: string }>; accounts: AccountOption[] }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ merchant_id: merchants[0]?.id ?? "", provider_account_id: accounts[0]?.id ?? "", period_start: "", period_end: "", reference: "", source: "provider_report" });
  if (!adminCan(session.user.role, "settlements.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const start = isoOrNull(form.period_start);
    const end = isoOrNull(form.period_end);
    if (!start || !end) {
      setError("Period start and end are required.");
      return;
    }
    if (new Date(start) >= new Date(end)) {
      setError("Period start must be before period end.");
      return;
    }
    setLoading(true);
    try {
      const r = await session.api<SettlementImportResult>("/admin/settlements/import", {
        body: { merchant_id: form.merchant_id, provider_account_id: form.provider_account_id, period_start: start, period_end: end, reference: form.reference.trim() || undefined, source: form.source },
      });
      setOpen(false);
      session.toast(r.data.length ? `${r.data.length} settlement${r.data.length === 1 ? "" : "s"} created · ${r.data.map((s) => formatMoney(s.net_amount, s.currency)).join(", ")}` : "No unsettled transactions in this period", r.data.length ? "ok" : "info");
      if (r.data.length === 1 && r.data[0]) router.push(`/admin/settlements/${r.data[0].id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={!merchants.length || !accounts.length}>
        Import provider settlement report
      </Button>
      {open ? (
        <Modal
          title="Import provider settlement report"
          description="Creates one settlement per currency from the provider's report for this account and period. Funds are held and paid out by the provider's settlement entity; NATIO only records what the provider reports."
          onClose={() => setOpen(false)}
          onSubmit={submit}
          submitLabel="Import settlement"
          loading={loading}
          error={error}
          width={560}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Merchant" htmlFor="si-merchant">
                <select id="si-merchant" className="input" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })} required>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Provider account" htmlFor="si-account" help="Only transactions processed by this account are included">
                <select id="si-account" className="input" value={form.provider_account_id} onChange={(e) => setForm({ ...form, provider_account_id: e.target.value })} required>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.provider} — {a.name} ({a.mode})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Period start" htmlFor="si-start">
              <input id="si-start" type="datetime-local" className="input" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} required />
            </Field>
            <Field label="Period end" htmlFor="si-end">
              <input id="si-end" type="datetime-local" className="input" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} required />
            </Field>
            <Field label="Reference" htmlFor="si-ref" help="The provider's settlement reference (optional)">
              <input id="si-ref" className="input" maxLength={120} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="STL-2026-04-01" />
            </Field>
            <Field label="Source" htmlFor="si-source">
              <select id="si-source" className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
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
