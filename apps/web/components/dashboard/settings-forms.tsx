"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/dashboard/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field } from "@/components/ui";
import type { Merchant, Project } from "@/lib/types";

// ---------------------------------------------------------------------------
// Merchant profile
// ---------------------------------------------------------------------------
export function MerchantProfileForm({ merchant }: { merchant: Merchant }) {
  const session = useSession();
  const router = useRouter();
  const canEdit = session.can("merchant.update");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: merchant.name,
    legal_name: merchant.legal_name ?? "",
    country: merchant.country ?? "",
    website: merchant.website ?? "",
    registration_number: merchant.registration_number ?? "",
    contact_email: merchant.contact_email ?? "",
    default_currency: merchant.settings.defaultCurrency ?? "",
    timezone: merchant.settings.timezone ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await session.api("/dashboard/merchant", {
        method: "PATCH",
        body: {
          name: form.name.trim(),
          legal_name: form.legal_name.trim(),
          country: form.country.trim() ? form.country.trim().toUpperCase() : undefined,
          website: form.website.trim(),
          registration_number: form.registration_number.trim(),
          contact_email: form.contact_email.trim() || undefined,
          settings: {
            default_currency: form.default_currency.trim() ? form.default_currency.trim().toUpperCase() : undefined,
            timezone: form.timezone.trim() || undefined,
          },
        },
      });
      session.toast("Merchant profile saved", "ok");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error ? (
        <div className="mb-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
      <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Display name" htmlFor="m-name">
          <input id="m-name" className="input" value={form.name} onChange={set("name")} required minLength={2} maxLength={120} />
        </Field>
        <Field label="Legal name" htmlFor="m-legal">
          <input id="m-legal" className="input" value={form.legal_name} onChange={set("legal_name")} maxLength={200} />
        </Field>
        <Field label="Country" htmlFor="m-country" help="ISO 3166-1 alpha-2">
          <input id="m-country" className="input" value={form.country} onChange={set("country")} maxLength={2} />
        </Field>
        <Field label="Website" htmlFor="m-web">
          <input id="m-web" type="url" className="input" placeholder="https://" value={form.website} onChange={set("website")} />
        </Field>
        <Field label="Registration number" htmlFor="m-reg">
          <input id="m-reg" className="input" value={form.registration_number} onChange={set("registration_number")} maxLength={64} />
        </Field>
        <Field label="Contact email" htmlFor="m-email">
          <input id="m-email" type="email" className="input" value={form.contact_email} onChange={set("contact_email")} />
        </Field>
        <Field label="Default currency" htmlFor="m-cur" help="Used for analytics when no currency is selected">
          <input id="m-cur" className="input" value={form.default_currency} onChange={set("default_currency")} maxLength={3} />
        </Field>
        <Field label="Timezone" htmlFor="m-tz" help="IANA name, e.g. Europe/London">
          <input id="m-tz" className="input" value={form.timezone} onChange={set("timezone")} maxLength={64} />
        </Field>
      </fieldset>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-ink-500">{canEdit ? "Changes are audited." : "Your role cannot edit the merchant profile."}</span>
        {canEdit ? (
          <Button type="submit" variant="primary" loading={loading}>
            Save profile
          </Button>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export function CreateProject() {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session.can("projects.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const p = await session.api<Project>("/dashboard/projects", { body: { name: name.trim() } });
      setOpen(false);
      setName("");
      session.toast(`Project “${p.name}” created`, "ok");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create project</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create a project" description="Projects separate API keys, webhooks and settings, e.g. one per storefront or platform." width="max-w-[420px]">
        <form onSubmit={submit}>
          {error ? (
            <div className="mt-3">
              <Alert tone="bad">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-4">
            <Field label="Name" htmlFor="pj-name">
              <input id="pj-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder="Mobile app" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ProjectSettingsForm({ project }: { project: Project }) {
  const session = useSession();
  const router = useRouter();
  const canEdit = session.can("projects.manage");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rp = project.settings.retry_policy ?? {};
  const [form, setForm] = useState({
    name: project.name,
    capture_method: project.settings.capture_method ?? "automatic",
    default_currency: project.settings.default_currency ?? "",
    max_attempts: String(rp.maxAttempts ?? 3),
    retry_on_soft_decline: rp.retryOnSoftDecline ?? true,
    retry_on_timeout: rp.retryOnTimeout ?? true,
    allowed_ips: (project.settings.allowed_ips ?? []).join("\n"),
    allowed_domains: (project.settings.allowed_domains ?? []).join("\n"),
    statement_descriptor: project.settings.statement_descriptor ?? "",
  });
  const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await session.api(`/dashboard/projects/${project.id}`, {
        method: "PATCH",
        body: {
          name: form.name.trim() !== project.name ? form.name.trim() : undefined,
          settings: {
            capture_method: form.capture_method,
            default_currency: form.default_currency.trim() ? form.default_currency.trim().toUpperCase() : undefined,
            retry_policy: { max_attempts: Number(form.max_attempts), retry_on_soft_decline: form.retry_on_soft_decline, retry_on_timeout: form.retry_on_timeout },
            allowed_ips: lines(form.allowed_ips),
            allowed_domains: lines(form.allowed_domains),
            statement_descriptor: form.statement_descriptor.trim(),
          },
        },
      });
      session.toast(`Project “${form.name.trim()}” saved`, "ok");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus() {
    const next = project.status === "active" ? "disabled" : "active";
    if (next === "disabled" && !confirm(`Disable project “${project.name}”? Its API keys stop authenticating until it is enabled again.`)) return;
    setLoading(true);
    try {
      await session.api(`/dashboard/projects/${project.id}`, { method: "PATCH", body: { status: next } });
      session.toast(`Project ${next}`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error ? (
        <div className="mb-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
      <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`p-name-${project.id}`}>
          <input id={`p-name-${project.id}`} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} />
        </Field>
        <Field label="Capture method" htmlFor={`p-cap-${project.id}`} help="Default for payments created without capture_method">
          <select id={`p-cap-${project.id}`} className="input" value={form.capture_method} onChange={(e) => setForm({ ...form, capture_method: e.target.value })}>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual (authorize, then capture)</option>
          </select>
        </Field>
        <Field label="Default currency" htmlFor={`p-cur-${project.id}`}>
          <input id={`p-cur-${project.id}`} className="input" value={form.default_currency} onChange={(e) => setForm({ ...form, default_currency: e.target.value })} maxLength={3} placeholder="USD" />
        </Field>
        <Field label="Statement descriptor" htmlFor={`p-sd-${project.id}`} help="Up to 22 characters, passed to providers that support it">
          <input id={`p-sd-${project.id}`} className="input" value={form.statement_descriptor} onChange={(e) => setForm({ ...form, statement_descriptor: e.target.value })} maxLength={22} />
        </Field>
        <div className="sm:col-span-2">
          <div className="label">Retry policy</div>
          <div className="grid grid-cols-1 gap-3 rounded-md border border-ink-200 p-3 sm:grid-cols-3">
            <Field label="Max attempts" htmlFor={`p-max-${project.id}`} help="Providers tried per payment (1–5)">
              <input id={`p-max-${project.id}`} type="number" min={1} max={5} className="input" value={form.max_attempts} onChange={(e) => setForm({ ...form, max_attempts: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 pt-5 text-[13px] text-ink-800">
              <input type="checkbox" className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-100" checked={form.retry_on_soft_decline} onChange={(e) => setForm({ ...form, retry_on_soft_decline: e.target.checked })} />
              Retry on soft decline
            </label>
            <label className="flex items-center gap-2 pt-5 text-[13px] text-ink-800">
              <input type="checkbox" className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-100" checked={form.retry_on_timeout} onChange={(e) => setForm({ ...form, retry_on_timeout: e.target.checked })} />
              Retry on timeout
            </label>
          </div>
        </div>
        <Field label="Allowed IPs" htmlFor={`p-ips-${project.id}`} help="One IP or CIDR per line. Empty allows any source for this project's API keys.">
          <textarea id={`p-ips-${project.id}`} className="input mono min-h-[88px]" value={form.allowed_ips} onChange={(e) => setForm({ ...form, allowed_ips: e.target.value })} placeholder={"203.0.113.10\n198.51.100.0/24"} />
        </Field>
        <Field label="Allowed domains" htmlFor={`p-dom-${project.id}`} help="One domain per line, for hosted checkout origins.">
          <textarea id={`p-dom-${project.id}`} className="input mono min-h-[88px]" value={form.allowed_domains} onChange={(e) => setForm({ ...form, allowed_domains: e.target.value })} placeholder={"shop.example.com"} />
        </Field>
      </fieldset>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[12px] text-ink-500">
          <span className="mono">{project.id}</span> · slug <span className="mono">{project.slug}</span>
        </span>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant={project.status === "active" ? "danger" : "secondary"} size="sm" disabled={loading} onClick={() => void toggleStatus()}>
              {project.status === "active" ? "Disable project" : "Enable project"}
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              Save project
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------
export function ChangePasswordForm() {
  const session = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.next !== form.confirm) {
      setError("New passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await session.api("/dashboard/auth/password", { body: { current_password: form.current, new_password: form.next } });
      session.toast("Password changed", "ok");
      setForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-[420px]">
      {error ? (
        <div className="mb-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
      <div className="space-y-3">
        <Field label="Current password" htmlFor="pw-cur">
          <input id="pw-cur" type="password" autoComplete="current-password" className="input" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required />
        </Field>
        <Field label="New password" htmlFor="pw-new" help="At least 10 characters with mixed case or digits">
          <input id="pw-new" type="password" autoComplete="new-password" className="input" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required minLength={10} maxLength={200} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-conf">
          <input id="pw-conf" type="password" autoComplete="new-password" className="input" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required minLength={10} maxLength={200} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" variant="primary" loading={loading}>
          Change password
        </Button>
      </div>
    </form>
  );
}
