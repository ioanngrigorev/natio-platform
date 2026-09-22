"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/dashboard/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field } from "@/components/ui";
import { currencyExponent } from "@/lib/format";
import type { Payout } from "@/lib/types";

const DESTINATION_TYPES = [
  { value: "bank_account", label: "Bank account" },
  { value: "wallet", label: "Wallet" },
  { value: "card_token", label: "Card token" },
];
const TEST_SCENARIOS = [
  { value: "success", label: "success", help: "Payout is confirmed by the first provider." },
  { value: "technical_error", label: "technical_error", help: "First provider errors; NATIO fails over to the next one." },
  { value: "hard_decline", label: "hard_decline", help: "Provider rejects the payout. No retry; payout fails." },
  { value: "unavailable", label: "unavailable", help: "First provider is unavailable; NATIO fails over." },
  { value: "timeout", label: "timeout", help: "First provider times out; NATIO checks nothing was sent, then fails over." },
];

export function CreatePayout() {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: "250.00", currency: "EUR", type: "bank_account", token: "", display: "IBAN ****4321", holder_name: "", country: "DE", reference: "", description: "", test_scenario: "success" });
  if (!session.can("payouts.create")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const currency = form.currency.toUpperCase();
      const minor = Math.round(Number.parseFloat(form.amount) * 10 ** currencyExponent(currency));
      if (!Number.isFinite(minor) || minor <= 0) throw new Error("Enter a positive amount");
      const p = await session.api<Payout>("/dashboard/payouts", {
        body: {
          amount: minor,
          currency,
          destination: {
            type: form.type,
            token: form.token || undefined,
            display: form.display,
            holder_name: form.holder_name || undefined,
            country: form.country ? form.country.toUpperCase() : undefined,
          },
          reference: form.reference || undefined,
          description: form.description || undefined,
          ...(session.mode === "test" && form.test_scenario ? { test_scenario: form.test_scenario } : {}),
        },
      });
      setOpen(false);
      session.toast(`Payout ${p.id} → ${p.status}`, p.status === "failed" ? "bad" : "ok");
      router.push(`/dashboard/payouts/${p.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Create payout
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create a payout" description={session.mode === "test" ? "Routed to the demo payout providers exactly like an API call. No real funds move." : "Routed to an eligible provider account. The provider executes the transfer; NATIO records the outcome."}>
        <form onSubmit={submit}>
          {error ? (
            <div className="mt-3">
              <Alert tone="bad">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Amount" htmlFor="po-amt">
              <input id="po-amt" className="input" value={form.amount} onChange={set("amount")} required />
            </Field>
            <Field label="Currency" htmlFor="po-cur">
              <input id="po-cur" className="input" maxLength={3} value={form.currency} onChange={set("currency")} required />
            </Field>
            <Field label="Destination type" htmlFor="po-type">
              <select id="po-type" className="input" value={form.type} onChange={set("type")}>
                {DESTINATION_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Destination token" htmlFor="po-token" help="Provider token or tokenised beneficiary. Raw account numbers are not accepted.">
              <input id="po-token" className="input" placeholder="tok_…" value={form.token} onChange={set("token")} />
            </Field>
            <Field label="Display (masked)" htmlFor="po-display" help="Shown in the dashboard and webhooks, e.g. IBAN ****4321">
              <input id="po-display" className="input" value={form.display} onChange={set("display")} required minLength={3} />
            </Field>
            <Field label="Holder name" htmlFor="po-holder">
              <input id="po-holder" className="input" value={form.holder_name} onChange={set("holder_name")} />
            </Field>
            <Field label="Country" htmlFor="po-country">
              <input id="po-country" className="input" maxLength={2} value={form.country} onChange={set("country")} />
            </Field>
            <Field label="Reference" htmlFor="po-ref">
              <input id="po-ref" className="input" placeholder="PO-1001" value={form.reference} onChange={set("reference")} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Description" htmlFor="po-desc">
              <input id="po-desc" className="input" value={form.description} onChange={set("description")} />
            </Field>
          </div>
          {session.mode === "test" ? (
            <div className="mt-3">
              <Field label="Test scenario" htmlFor="po-sc" help={TEST_SCENARIOS.find((s) => s.value === form.test_scenario)?.help}>
                <select id="po-sc" className="input" value={form.test_scenario} onChange={set("test_scenario")}>
                  {TEST_SCENARIOS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              Create payout
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function PayoutActions({ payout }: { payout: Payout }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canCancel = session.can("payouts.create") && ["created", "pending"].includes(payout.status);
  if (!canCancel) return null;

  async function cancel() {
    if (!confirm("Cancel this payout?")) return;
    setBusy(true);
    try {
      await session.api(`/dashboard/payouts/${payout.id}/cancel`, { body: {} });
      session.toast("Payout cancelled", "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="danger" loading={busy} onClick={() => void cancel()}>
      Cancel payout
    </Button>
  );
}
