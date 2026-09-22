"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/admin/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button, Field } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import type { AdminRole, AdminUser } from "@/lib/admin-types";

const ROLE_HELP: Record<string, string> = {
  superadmin: "Everything, including admin users and audit log.",
  operations: "Merchants, providers, routing, risk, settlements and reconciliation.",
  support: "Payment lookups, retries and webhook resends.",
  readonly: "Read-only access to the admin panel and audit log.",
};

/** Role select + enable/disable for one admin user. Your own row is never editable. */
export function AdminUserControls({ user, roles }: { user: AdminUser; roles: AdminRole[] }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const isSelf = user.id === session.user.id;
  const canManage = adminCan(session.user.role, "admin_users.manage") && !isSelf;

  async function patch(label: string, body: Record<string, string>) {
    setBusy(body.status ? "status" : "role");
    try {
      await session.api(`/admin/users/${user.id}`, { method: "PATCH", body });
      session.toast(`${user.name}: ${label}`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <div className="flex items-center justify-end gap-2 text-[12px] text-ink-400">
        <span>{user.role}</span>
        <span>{isSelf ? "· you" : "· read-only"}</span>
      </div>
    );
  }

  const disabled = user.status === "disabled";
  return (
    <div className="flex items-center justify-end gap-2">
      <select className="input !w-auto !py-[3px] text-[12px]" value={user.role} disabled={busy !== null} onChange={(e) => void patch(`role set to ${e.target.value}`, { role: e.target.value })} aria-label={`Role for ${user.name}`} title={ROLE_HELP[user.role]}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant={disabled ? "secondary" : "danger"}
        loading={busy === "status"}
        onClick={() => {
          if (disabled || confirm(`Disable ${user.name}? They can no longer sign in to the admin panel.`)) void patch(disabled ? "enabled" : "disabled", { status: disabled ? "active" : "disabled" });
        }}
      >
        {disabled ? "Enable" : "Disable"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create admin user
// ---------------------------------------------------------------------------
export function CreateAdminUser({ roles }: { roles: AdminRole[] }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", role: (roles.includes("readonly") ? "readonly" : roles[0] ?? "readonly") as string, password: "" });
  if (!adminCan(session.user.role, "admin_users.manage")) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 12) {
      setError("The password must be at least 12 characters.");
      return;
    }
    setLoading(true);
    try {
      await session.api("/admin/users", { body: { email: form.email.trim().toLowerCase(), name: form.name.trim(), role: form.role, password: form.password } });
      session.toast(`Admin user ${form.email.trim()} created`, "ok");
      setOpen(false);
      setForm({ ...form, email: "", name: "", password: "" });
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
        Create admin user
      </Button>
      {open ? (
        <Modal title="Create admin user" description="Internal NATIO staff account for this panel. The password is set here and can be changed by the user after signing in." onClose={() => setOpen(false)} onSubmit={submit} submitLabel="Create user" loading={loading} error={error}>
          <div className="space-y-3">
            <Field label="Email" htmlFor="au-email">
              <input id="au-email" type="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@natio.local" />
            </Field>
            <Field label="Name" htmlFor="au-name">
              <input id="au-name" className="input" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Role" htmlFor="au-role" help={ROLE_HELP[form.role]}>
              <select id="au-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Password" htmlFor="au-password" help="At least 12 characters">
              <input id="au-password" type="password" className="input" required minLength={12} maxLength={200} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
