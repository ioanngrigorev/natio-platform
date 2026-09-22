"use client";

import type { FormEvent, ReactNode } from "react";
import { Alert, Button } from "@/components/ui";

/** Fixed-overlay dialog, same pattern as components/dashboard/create-test-payment.tsx. */
export function Modal({ title, description, onClose, onSubmit, submitLabel = "Save", submitVariant = "primary", loading, error, children, width = 520, footer }: { title: string; description?: ReactNode; onClose: () => void; onSubmit?: (e: FormEvent) => void; submitLabel?: string; submitVariant?: "primary" | "danger" | "secondary"; loading?: boolean; error?: string | null; children: ReactNode; width?: number; footer?: ReactNode }) {
  const body = (
    <>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-[12.5px] text-ink-500">{description}</p> : null}
      {error ? (
        <div className="mt-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
      <div className="mt-4">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        {footer}
        <Button type="button" variant="ghost" onClick={onClose}>
          {onSubmit ? "Cancel" : "Close"}
        </Button>
        {onSubmit ? (
          <Button type="submit" variant={submitVariant} loading={loading}>
            {submitLabel}
          </Button>
        ) : null}
      </div>
    </>
  );
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-900/40 px-4 py-10" onClick={onClose}>
      {onSubmit ? (
        <form onSubmit={onSubmit} className="w-full rounded-lg bg-white p-5 shadow-xl" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
          {body}
        </form>
      ) : (
        <div className="w-full rounded-lg bg-white p-5 shadow-xl" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      )}
    </div>
  );
}
