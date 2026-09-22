"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CopyButton, Modal } from "@/components/dashboard/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field } from "@/components/ui";
import type { TeamMember } from "@/lib/types";

const ROLE_HELP: Record<string, string> = {
  owner: "Full access, including billing-level settings and assigning owners.",
  admin: "Full access except creating owners.",
  developer: "API keys, webhooks, projects and sandbox payments.",
  finance: "Payments, refunds, payouts, settlements and reconciliation.",
  analyst: "Read-only access to payments, transactions, settlements and analytics.",
  support: "Payments lookup, refunds and webhook logs.",
  viewer: "Read-only access to payments, transactions and analytics.",
};

export function InviteMember({ assignableRoles }: { assignableRoles: string[] }) {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ url: string; note: string; email: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: assignableRoles.includes("viewer") ? "viewer" : (assignableRoles[0] ?? "") });
  if (!session.can("team.manage") || !assignableRoles.length) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await session.api<{ user: TeamMember; invite_url: string; note: string }>("/dashboard/team/invite", { body: { name: form.name.trim(), email: form.email.trim(), role: form.role } });
      setOpen(false);
      setInvite({ url: r.invite_url, note: r.note, email: r.user.email });
      setForm({ ...form, name: "", email: "" });
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
        Invite member
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite a team member" description="The invitee sets a password through a one-time link. Roles can be changed later.">
        <form onSubmit={submit}>
          {error ? (
            <div className="mt-3">
              <Alert tone="bad">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            <Field label="Name" htmlFor="tm-name">
              <input id="tm-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={120} />
            </Field>
            <Field label="Email" htmlFor="tm-email">
              <input id="tm-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Role" htmlFor="tm-role" help={ROLE_HELP[form.role]}>
              <select id="tm-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
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
              Send invite
            </Button>
          </div>
        </form>
      </Modal>
      {invite ? (
        <Modal open onClose={() => setInvite(null)} title={`Invite created for ${invite.email}`} description="No email is sent automatically in this environment.">
          <div className="mt-4">
            <Alert tone="warn">{invite.note}</Alert>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2">
            <code className="mono flex-1 select-all break-all text-ink-900">{invite.url}</code>
            <CopyButton value={invite.url} />
          </div>
          <div className="mt-5 flex justify-end">
            <Button type="button" variant="primary" onClick={() => setInvite(null)}>
              Done
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function MemberControls({ member, assignableRoles }: { member: TeamMember; assignableRoles: string[] }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const isSelf = member.id === session.user.id;
  const canManage = session.can("team.manage") && !isSelf && member.role !== "owner" && assignableRoles.includes(member.role);

  if (!canManage) {
    return (
      <div className="flex items-center justify-end gap-2 text-[12px] text-ink-400">
        <span className="capitalize">{member.role}</span>
        <span>{isSelf ? "· you" : member.role === "owner" ? "· owner" : ""}</span>
      </div>
    );
  }

  async function patch(label: string, body: Record<string, string>) {
    setBusy(body.status ? "status" : "role");
    try {
      await session.api(`/dashboard/team/${member.id}`, { method: "PATCH", body });
      session.toast(`${member.name}: ${label}`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  const disabled = member.status === "disabled";
  return (
    <div className="flex items-center justify-end gap-2">
      <select className="input !w-auto !py-[3px] text-[12px]" value={member.role} disabled={busy !== null} onChange={(e) => void patch(`role set to ${e.target.value}`, { role: e.target.value })} aria-label={`Role for ${member.name}`}>
        {assignableRoles.map((r) => (
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
          if (disabled || confirm(`Disable ${member.name}? Their sessions are revoked and they can no longer sign in.`)) void patch(disabled ? "enabled" : "disabled", { status: disabled ? "active" : "disabled" });
        }}
      >
        {disabled ? "Enable" : "Disable"}
      </Button>
    </div>
  );
}
