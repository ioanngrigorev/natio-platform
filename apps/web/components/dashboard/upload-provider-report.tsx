"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/dashboard/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field } from "@/components/ui";
import type { ReconBatch } from "@/lib/types";

export interface AccountOption {
  id: string;
  label: string;
  provider: string;
}

export function UploadProviderReport({ accounts }: { accounts: AccountOption[] }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [file, setFile] = useState<File | null>(null);
  if (!session.can("reconciliation.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a CSV file");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("provider_account_id", accountId);
      if (periodStart) fd.append("period_start", new Date(periodStart).toISOString());
      if (periodEnd) fd.append("period_end", new Date(periodEnd).toISOString());
      fd.append("file", file, file.name);
      const batch = await session.api<ReconBatch>("/dashboard/reconciliation/upload", { formData: fd });
      setOpen(false);
      session.toast(`Reconciled ${batch.totals.total} rows · ${batch.totals.MATCHED} matched`, batch.totals.total === batch.totals.MATCHED ? "ok" : "info");
      router.push(`/dashboard/reconciliation/${batch.id}`);
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
        Upload provider report
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload a provider report" description="NATIO matches every row of the provider's CSV against its own ledger for that provider account and flags differences.">
        <form onSubmit={submit}>
          {error ? (
            <div className="mt-3">
              <Alert tone="bad">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            <Field label="Provider account" htmlFor="rc-acc">
              <select id="rc-acc" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.provider} — {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period start (optional)" htmlFor="rc-from">
                <input id="rc-from" type="datetime-local" className="input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </Field>
              <Field label="Period end (optional)" htmlFor="rc-to">
                <input id="rc-to" type="datetime-local" className="input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </Field>
            </div>
            <Field label="CSV file" htmlFor="rc-file" help="Columns: provider_reference, natio_reference, type, amount, currency, status. Header names are matched case-insensitively.">
              <input id="rc-file" type="file" accept=".csv,text/csv" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              Run reconciliation
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
