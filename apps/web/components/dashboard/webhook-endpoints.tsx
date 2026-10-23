"use client";
import {useI18n} from '@/lib/i18n/provider';


import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal, SecretReveal } from "@/components/dashboard/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field } from "@/components/ui";
import type { WebhookEndpoint } from "@/lib/types";

export function AddWebhookEndpoint({ eventTypes }: { eventTypes: string[] }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ value: string; url: string } | null>(null);
  const [form, setForm] = useState({ url: "", description: "", events: [] as string[] });
  if (!session.can("webhooks.manage")) return null;

  function toggle(ev: string) {
    setForm((f) => ({ ...f, events: f.events.includes(ev) ? f.events.filter((x) => x !== ev) : [...f.events, ev] }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const ep = await session.api<WebhookEndpoint & { secret: string }>("/dashboard/webhooks/endpoints", { body: { url: form.url.trim(), description: form.description.trim() || undefined, events: form.events } });
      setOpen(false);
      setSecret({ value: ep.secret, url: ep.url });
      setForm({ url: "", description: "", events: [] });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{translateUi("Add endpoint")}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={translateUi(`Add a ${session.mode} webhook endpoint`)} description={translateUi("NATIO POSTs signed JSON events to this URL and retries with backoff on non-2xx responses.")}>
        <form onSubmit={submit}>
          {translateUi(error ? (
            <div className="mt-3">
              <Alert tone="bad">{translateUi(error)}</Alert>
            </div>
          ) : null)}
          <div className="mt-4 space-y-3">
            <Field label={translateUi("URL")} htmlFor="wh-url" help={translateUi("HTTPS in production. Must be publicly reachable.")}>
              <input id="wh-url" type="url" className="input" placeholder={translateUi("https://example.com/webhooks/natio")} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
            </Field>
            <Field label={translateUi("Description")} htmlFor="wh-desc">
              <input id="wh-desc" className="input" placeholder={translateUi("Order service")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
            </Field>
            <div>
              <div className="label">{translateUi("Events")}</div>
              <div className="help !mt-0 mb-2">{translateUi("Leave everything unchecked to receive all events.")}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-ink-200 p-3">
                {translateUi(eventTypes.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-[12.5px] text-ink-800">
                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-100" checked={form.events.includes(ev)} onChange={() => toggle(ev)} />
                    <span className="mono">{translateUi(ev)}</span>
                  </label>
                )))}
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{translateUi("Cancel")}</Button>
            <Button type="submit" variant="primary" loading={loading}>{translateUi("Add endpoint")}</Button>
          </div>
        </form>
      </Modal>
      {translateUi(secret ? (
        <SecretReveal
          open
          onClose={() => setSecret(null)}
          title={translateUi("Endpoint added")}
          description={translateUi(`Signing secret for ${secret.url}. Verify the Natio-Signature header with it.`)}
          secret={secret.value}
          warning="Store the signing secret securely. It will not be shown again; you can rotate it later."
        />
      ) : null)}
    </>
  );
}

export function EndpointActions({ endpoint }: { endpoint: WebhookEndpoint }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  if (!session.can("webhooks.manage")) return null;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  const toggleStatus = () =>
    run("status", async () => {
      const next = endpoint.status === "active" ? "disabled" : "active";
      await session.api(`/dashboard/webhooks/endpoints/${endpoint.id}`, { method: "PATCH", body: { status: next } });
      session.toast(`Endpoint ${next}`, "ok");
    });

  const rotate = () =>
    run("rotate", async () => {
      if (!confirm("Rotate the signing secret? The current secret stops working immediately.")) return;
      const r = await session.api<{ secret: string; note: string }>(`/dashboard/webhooks/endpoints/${endpoint.id}/rotate-secret`, { body: {} });
      setSecret(r.secret);
    });

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button size="sm" variant="ghost" loading={busy === "rotate"} onClick={() => void rotate()}>{translateUi("Rotate secret")}</Button>
      <Button size="sm" variant={endpoint.status === "active" ? "danger" : "secondary"} loading={busy === "status"} onClick={() => void toggleStatus()}>
        {translateUi(endpoint.status === "active" ? translateUi("Disable") : translateUi("Enable"))}
      </Button>
      {translateUi(secret ? <SecretReveal open onClose={() => setSecret(null)} title={translateUi("Secret rotated")} description={translateUi(`New signing secret for ${endpoint.url}.`)} secret={secret} warning="Update your integration with the new secret now. The old secret is no longer valid and this one will not be shown again." /> : null)}
    </div>
  );
}

export function ResendDelivery({ deliveryId, size = "sm" }: { deliveryId: string; size?: "sm" | "md" }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!session.can("webhooks.manage")) return null;

  async function resend() {
    setBusy(true);
    try {
      await session.api(`/dashboard/webhooks/deliveries/${deliveryId}/resend`, { body: {} });
      session.toast("Delivery queued for resend", "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size={size} loading={busy} onClick={() => void resend()}>{translateUi("Resend")}</Button>
  );
}
