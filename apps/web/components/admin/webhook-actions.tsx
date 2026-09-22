"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";

/** Queues one more delivery attempt for a webhook delivery (POST /admin/webhooks/deliveries/{id}/resend). */
export function ResendDelivery({ deliveryId, size = "sm" }: { deliveryId: string; size?: "sm" | "md" }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!adminCan(session.user.role, "webhooks.resend")) return null;

  async function resend() {
    setBusy(true);
    try {
      await session.api(`/admin/webhooks/deliveries/${deliveryId}/resend`, { body: {} });
      session.toast("Delivery queued for resend", "ok");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size={size} loading={busy} onClick={() => void resend()}>
      Resend
    </Button>
  );
}
