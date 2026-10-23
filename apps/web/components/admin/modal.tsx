"use client";
import {useI18n} from '@/lib/i18n/provider';


import type { FormEvent, ReactNode } from "react";
import { Alert, Button } from "@/components/ui";

/** Fixed-overlay dialog, same pattern as components/dashboard/create-test-payment.tsx. */
export function Modal({ title, description, onClose, onSubmit, submitLabel = "Save", submitVariant = "primary", loading, error, children, width = 520, footer }: { title: string; description?: ReactNode; onClose: () => void; onSubmit?: (e: FormEvent) => void; submitLabel?: string; submitVariant?: "primary" | "danger" | "secondary"; loading?: boolean; error?: string | null; children: ReactNode; width?: number; footer?: ReactNode }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const body = (
    <>
      <h2 className="text-[15px] font-semibold">{translateUi(title)}</h2>
      {translateUi(description ? <p className="mt-1 text-[12.5px] text-ink-500">{translateUi(description)}</p> : null)}
      {translateUi(error ? (
        <div className="mt-3">
          <Alert tone="bad">{translateUi(error)}</Alert>
        </div>
      ) : null)}
      <div className="mt-4">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        {translateUi(footer)}
        <Button type="button" variant="ghost" onClick={onClose}>
          {translateUi(onSubmit ? translateUi("Cancel") : translateUi("Close"))}
        </Button>
        {translateUi(onSubmit ? (
          <Button type="submit" variant={submitVariant} loading={loading}>
            {translateUi(submitLabel)}
          </Button>
        ) : null)}
      </div>
    </>
  );
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-900/40 px-4 py-10" onClick={onClose}>
      {translateUi(onSubmit ? (
        <form onSubmit={onSubmit} className="w-full rounded-lg bg-white p-5 shadow-xl" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
          {translateUi(body)}
        </form>
      ) : (
        <div className="w-full rounded-lg bg-white p-5 shadow-xl" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
          {translateUi(body)}
        </div>
      ))}
    </div>
  );
}
