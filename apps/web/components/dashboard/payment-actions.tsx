"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button, Field } from "@/components/ui";
import { currencyExponent, formatMoney } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function PaymentActions({ payment: p }: { payment: Payment }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"refund" | "capture" | null>(null);
  const [amount, setAmount] = useState("");

  const exp = currencyExponent(p.currency);
  const refundable = p.captured_amount - p.refunded_amount;
  const canRefund = session.can("refunds.create") && ["successful", "partially_refunded"].includes(p.status) && refundable > 0;
  const canCapture = session.can("payments.write") && p.status === "authorized";
  const canCancel = session.can("payments.write") && (["created", "pending", "authorized"].includes(p.status) || (p.status === "processing" && !!p.next_action));

  async function run(action: string, path: string, body?: unknown) {
    setBusy(action);
    try {
      await session.api(path, { body: body ?? {} });
      session.toast(`${action} completed`, "ok");
      setDialog(null);
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  const toMinor = (v: string) => Math.round(Number.parseFloat(v || "0") * 10 ** exp);

  return (
    <div className="flex items-center gap-2">
      {canCapture ? (
        <Button variant="primary" onClick={() => { setAmount((p.amount / 10 ** exp).toFixed(exp)); setDialog("capture"); }}>
          Capture
        </Button>
      ) : null}
      {canRefund ? (
        <Button onClick={() => { setAmount((refundable / 10 ** exp).toFixed(exp)); setDialog("refund"); }}>
          Refund
        </Button>
      ) : null}
      {canCancel ? (
        <Button variant="danger" loading={busy === "Cancel"} onClick={() => { if (confirm("Cancel this payment?")) void run("Cancel", `/dashboard/payments/${p.id}/cancel`, { reason: "cancelled_from_dashboard" }); }}>
          Cancel
        </Button>
      ) : null}
      {dialog ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink-900/40 px-4 py-10" onClick={() => setDialog(null)}>
          <div className="w-full max-w-[420px] rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-semibold">{dialog === "refund" ? "Refund payment" : "Capture payment"}</h2>
            <p className="mt-1 text-[12.5px] text-ink-500">{dialog === "refund" ? `Up to ${formatMoney(refundable, p.currency)} can be refunded via ${p.route.provider?.name ?? "the provider"}.` : `Authorized amount ${formatMoney(p.amount, p.currency)}. Partial capture is allowed.`}</p>
            <div className="mt-4">
              <Field label={`Amount (${p.currency})`} htmlFor="amount">
                <input id="amount" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Close
              </Button>
              <Button variant="primary" loading={busy !== null} onClick={() => void run(dialog === "refund" ? "Refund" : "Capture", `/dashboard/payments/${p.id}/${dialog}`, { amount: toMinor(amount), ...(dialog === "refund" ? { reason: "requested_by_merchant" } : {}) })}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
