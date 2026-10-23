"use client";
import {useI18n} from '@/lib/i18n/provider';


import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal, SecretReveal } from "@/components/dashboard/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field } from "@/components/ui";
import type { ApiKey } from "@/lib/types";

export function CreateApiKey() {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null);
  const projects = session.projects ?? [];
  const [form, setForm] = useState({ name: "", mode: session.mode, project_id: projects[0]?.id ?? "" });
  if (!session.can("api_keys.manage")) return null;
  const kybApproved = session.merchant?.kyb_status === "approved";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const k = await session.api<ApiKey & { secret: string; note: string }>("/dashboard/api-keys", { body: { name: form.name.trim(), mode: form.mode, project_id: form.project_id || undefined } });
      setOpen(false);
      setSecret({ value: k.secret, name: k.name });
      setForm({ ...form, name: "" });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{translateUi("Create key")}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={translateUi("Create an API key")} description={translateUi("Secret keys authenticate server-to-server calls. The secret is shown once, immediately after creation.")}>
        <form onSubmit={submit}>
          {translateUi(error ? (
            <div className="mt-3">
              <Alert tone="bad">{translateUi(error)}</Alert>
            </div>
          ) : null)}
          <div className="mt-4 space-y-3">
            <Field label={translateUi("Name")} htmlFor="ak-name" help={translateUi("Where the key will live, e.g. “Checkout backend (prod)”")}>
              <input id="ak-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={1} maxLength={80} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={translateUi("Mode")} htmlFor="ak-mode" help={translateUi(form.mode === "live" && !kybApproved ? translateUi("Live keys require KYB approval.") : undefined)}>
                <select id="ak-mode" className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "test" | "live" })}>
                  <option value="test">{translateUi("Test (sandbox)")}</option>
                  <option value="live">{translateUi("Live")}</option>
                </select>
              </Field>
              <Field label={translateUi("Project")} htmlFor="ak-project">
                <select id="ak-project" className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                  {translateUi(projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  )))}
                </select>
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{translateUi("Cancel")}</Button>
            <Button type="submit" variant="primary" loading={loading}>{translateUi("Create key")}</Button>
          </div>
        </form>
      </Modal>
      {translateUi(secret ? (
        <SecretReveal
          open
          onClose={() => setSecret(null)}
          title={translateUi(`Key “${secret.name}” created`)}
          description={translateUi("Use it as a bearer token: Authorization: Bearer <key>.")}
          secret={secret.value}
          warning="Store this key securely now. It will not be shown again. If it is lost, revoke it and create a new one."
        />
      ) : null)}
    </>
  );
}

export function RevokeApiKey({ apiKey }: { apiKey: ApiKey }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!session.can("api_keys.manage") || apiKey.revoked_at) return null;

  async function revoke() {
    if (!confirm(`Revoke “${apiKey.name}” (${apiKey.prefix}…)? Requests using it will fail immediately.`)) return;
    setBusy(true);
    try {
      await session.api(`/dashboard/api-keys/${apiKey.id}`, { method: "DELETE" });
      session.toast("API key revoked", "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="danger" size="sm" loading={busy} onClick={() => void revoke()}>{translateUi("Revoke")}</Button>
  );
}
