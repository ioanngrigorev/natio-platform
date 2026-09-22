"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";

/** Header actions for an admin payment view: manual review decisions and orchestration resume. */
export function PaymentAdminActions({ payment }: { payment: { id: string; status: string } }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!adminCan(session.user.role, "operations.retry")) return null;

  async function run(label: string, path: string, body: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(label);
    try {
      await session.api(path, { body });
      session.toast(`${label} completed`, "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  }

  if (payment.status === "pending") {
    return (
      <div className="flex items-center gap-2">
        <Button variant="danger" loading={busy === "Reject"} onClick={() => void run("Reject", `/admin/payments/${payment.id}/review`, { decision: "reject" }, "Reject this payment? It will be failed with a risk decline.")}>
          Reject
        </Button>
        <Button variant="primary" loading={busy === "Approve"} onClick={() => void run("Approve", `/admin/payments/${payment.id}/review`, { decision: "approve" })}>
          Approve and route
        </Button>
      </div>
    );
  }
  if (payment.status === "processing") {
    return (
      <Button variant="primary" loading={busy === "Resume"} onClick={() => void run("Resume", `/admin/payments/${payment.id}/retry`, {}, "Resume orchestration for this payment? The engine re-evaluates the route and continues with the next provider.")}>
        Resume orchestration
      </Button>
    );
  }
  return null;
}

/** Row action for attempts whose outcome is unknown (provider did not answer): force a status sync. */
export function AttemptSyncButton({ attemptId }: { attemptId: string }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!adminCan(session.user.role, "operations.retry")) return null;
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await session.api(`/admin/attempts/${attemptId}/sync`, { body: {} });
          session.toast("Attempt synced with provider", "ok");
          router.refresh();
        } catch (err) {
          session.toast(errorMessage(err), "bad");
        } finally {
          setBusy(false);
        }
      }}
    >
      Sync with provider
    </Button>
  );
}
