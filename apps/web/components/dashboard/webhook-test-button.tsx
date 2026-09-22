"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Button } from "@/components/ui";

/** POST /dashboard/webhooks/test — emits a synthetic event to every endpoint of the current mode. */
export function WebhookTestButton({ eventType = "payment.successful", variant = "secondary", size = "md" }: { eventType?: string; variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!session.can("webhooks.manage")) return null;

  async function send() {
    setBusy(true);
    try {
      const r = await session.api<{ event_id: string; deliveries: number }>("/dashboard/webhooks/test", { body: { event_type: eventType } });
      session.toast(r.deliveries ? `Test event ${r.event_id} queued to ${r.deliveries} endpoint${r.deliveries === 1 ? "" : "s"}` : `Test event ${r.event_id} emitted, but no active ${session.mode} endpoint is subscribed to ${eventType}`, r.deliveries ? "ok" : "info");
      router.refresh();
    } catch (err) {
      session.toast(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} size={size} loading={busy} onClick={() => void send()}>
      Send test event
    </Button>
  );
}
