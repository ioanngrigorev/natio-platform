import Link from "next/link";
import { EmptyState, LinkButton } from "@/components/ui";

/** Light not-found for in-app notFound() calls (payment/payout/settlement detail pages). */
export default function DashboardNotFound() {
  return (
    <div className="py-10">
      <EmptyState
        title="Not found"
        description="This record does not exist, or it belongs to another account or mode. Check whether you are in test or live data."
        action={<LinkButton href="/dashboard" variant="primary">Back to overview</LinkButton>}
      />
    </div>
  );
}
