import { Suspense } from "react";
import { AcceptInviteForm } from "@/components/auth-forms";

export const metadata = { title: "Accept invite" };

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
