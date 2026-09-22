"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field } from "@/components/ui";
import type { Payment } from "@/lib/types";

const METHODS = ["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local"];

/** Sandbox-only: creates a real test payment through the orchestration engine. */
export function CreateTestPayment({ scenarios }: { scenarios: Array<{ name: string; description: string }> }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: "100.00", currency: "USD", payment_method: "card", country: "US", test_scenario: "success", reference: "", capture_method: "automatic" });
  if (!session.can("payments.write")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const exp = ["JPY", "KRW", "VND"].includes(form.currency.toUpperCase()) ? 0 : 2;
      const minor = Math.round(Number.parseFloat(form.amount) * 10 ** exp);
      const p = await session.api<Payment>("/dashboard/payments", {
        body: {
          amount: minor,
          currency: form.currency.toUpperCase(),
          payment_method: form.payment_method,
          country: form.country.toUpperCase() || undefined,
          test_scenario: form.test_scenario || undefined,
          reference: form.reference || undefined,
          capture_method: form.capture_method,
          customer: { external_id: "dashboard-demo", email: "demo@example.com", name: "Dashboard demo" },
        },
      });
      setOpen(false);
      session.toast(`Payment ${p.id} → ${p.status}`, p.status === "failed" ? "bad" : "ok");
      router.push(`/dashboard/payments/${p.id}`);
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
        Create test payment
      </Button>
      {open ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink-900/40 px-4 py-10" onClick={() => setOpen(false)}>
          <form onSubmit={submit} className="w-full max-w-[520px] rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-semibold">Create a sandbox payment</h2>
            <p className="mt-1 text-[12.5px] text-ink-500">Runs through risk, routing and the demo providers exactly like an API call. No real funds move.</p>
            {error ? (
              <div className="mt-3">
                <Alert tone="bad">{error}</Alert>
              </div>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Amount" htmlFor="amt">
                <input id="amt" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </Field>
              <Field label="Currency" htmlFor="cur">
                <input id="cur" className="input" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
              </Field>
              <Field label="Payment method" htmlFor="pm">
                <select id="pm" className="input" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Country" htmlFor="ctry">
                <input id="ctry" className="input" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </Field>
              <Field label="Capture" htmlFor="cap">
                <select id="cap" className="input" value={form.capture_method} onChange={(e) => setForm({ ...form, capture_method: e.target.value })}>
                  <option value="automatic">Automatic</option>
                  <option value="manual">Manual (authorize only)</option>
                </select>
              </Field>
              <Field label="Reference" htmlFor="ref">
                <input id="ref" className="input" placeholder="ORD-1001" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Test scenario" htmlFor="sc" help={scenarios.find((s) => s.name === form.test_scenario)?.description}>
                <select id="sc" className="input" value={form.test_scenario} onChange={(e) => setForm({ ...form, test_scenario: e.target.value })}>
                  {scenarios.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={loading}>
                Create payment
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
