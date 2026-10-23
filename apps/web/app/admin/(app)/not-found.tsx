
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { EmptyState, LinkButton } from "@/components/ui";

/** Light not-found for in-app notFound() calls (payment/payout/settlement detail pages). */
export default function AdminNotFound() {
 const {t:translateUi,locale:uiLocale}=getI18n();

  return (
    <div className="py-10">
      <EmptyState
        title={translateUi("Not found")}
        description={translateUi("This record does not exist, or it belongs to another account or mode. Check whether you are in test or live data.")}
        action={<LinkButton href="/admin" variant="primary">{translateUi("Back to overview")}</LinkButton>}
      />
    </div>
  );
}
