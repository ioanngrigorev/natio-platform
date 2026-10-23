"use client";
import {useI18n} from '@/lib/i18n/provider';


import { Alert, Button } from "@/components/ui";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  return (
    <div className="mx-auto max-w-lg py-10">
      <Alert tone="bad" title={translateUi("Something went wrong")}>
        {translateUi(error.message || "The dashboard could not load this page.")}
      </Alert>
      <div className="mt-4">
        <Button onClick={reset}>{translateUi("Try again")}</Button>
      </div>
    </div>
  );
}
