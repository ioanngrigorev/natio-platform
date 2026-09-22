"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/admin/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button, Field } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";

const KYB_STATUSES = ["not_started", "pending", "approved", "rejected"] as const;

export function MerchantActions({ merchant }: { merchant: { id: string; name: string; status: string; kyb_status: string } }) {
  const session = useSession();
  const router = useRouter();
  const [dialog, setDialog] = useState<"status" | "kyb" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [kyb, setKyb] = useState<string>(merchant.kyb_status);
  const [note, setNote] = useState("");
  if (!adminCan(session.user.role, "merchants.manage")) return null;

  const nextStatus = merchant.status === "active" ? "disabled" : "active";

  async function submitStatus(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await session.api(`/admin/merchants/${merchant.id}/status`, { body: { status: nextStatus, reason: reason || undefined } });
      session.toast(`Merchant ${nextStatus}`, "ok");
      setDialog(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitKyb(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await session.api(`/admin/merchants/${merchant.id}/kyb`, { body: { kyb_status: kyb, note: note || undefined } });
      session.toast(`KYB status set to ${kyb.replace(/_/g, " ")}`, "ok");
      setDialog(null);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={() => { setError(null); setDialog("kyb"); }}>Set KYB status</Button>
      <Button variant={nextStatus === "disabled" ? "danger" : "primary"} onClick={() => { setError(null); setDialog("status"); }}>
        {nextStatus === "disabled" ? "Disable merchant" : "Enable merchant"}
      </Button>

      {dialog === "status" ? (
        <Modal title={nextStatus === "disabled" ? `Disable ${merchant.name}` : `Enable ${merchant.name}`} description={nextStatus === "disabled" ? "All dashboard sessions of this merchant are revoked and API access is blocked until re-enabled. The reason is written to the audit log." : "Restores dashboard and API access for this merchant."} onClose={() => setDialog(null)} onSubmit={submitStatus} submitLabel={nextStatus === "disabled" ? "Disable" : "Enable"} submitVariant={nextStatus === "disabled" ? "danger" : "primary"} loading={loading} error={error}>
          <Field label="Reason" htmlFor="reason" help="Optional, max 300 characters">
            <input id="reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. compliance review, chargeback ratio" />
          </Field>
        </Modal>
      ) : null}

      {dialog === "kyb" ? (
        <Modal title="Set KYB status" description="Records the verification outcome for this merchant. Live mode requires an approved KYB." onClose={() => setDialog(null)} onSubmit={submitKyb} submitLabel="Update KYB" loading={loading} error={error}>
          <div className="space-y-3">
            <Field label="KYB status" htmlFor="kyb">
              <select id="kyb" className="input" value={kyb} onChange={(e) => setKyb(e.target.value)}>
                {KYB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note" htmlFor="note" help="Optional, max 500 characters">
              <textarea id="note" className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
