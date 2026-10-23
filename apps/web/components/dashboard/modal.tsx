"use client";
import {useI18n} from '@/lib/i18n/provider';


import { useState, type ReactNode } from "react";
import {Alert, Button} from "@/components/ui";
import {cx} from "@/lib/classnames";

/** Fixed-overlay dialog, same pattern as create-test-payment.tsx. Click outside closes. */
export function Modal({ open, onClose, title, description, children, width = "max-w-[520px]" }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; width?: string }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink-900/40 px-4 py-10" onClick={onClose}>
      <div className={cx("w-full rounded-lg bg-white p-5 shadow-xl", width)} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold">{translateUi(title)}</h2>
        {translateUi(description ? <p className="mt-1 text-[12.5px] text-ink-500">{translateUi(description)}</p> : null)}
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ value, label = "Copy", size = "sm" }: { value: string; label?: string; size?: "sm" | "md" }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable (insecure context); the value stays visible for manual copy.
    }
  }
  return (
    <Button type="button" size={size} onClick={() => void copy()}>
      {translateUi(copied ? translateUi("Copied") : label)}
    </Button>
  );
}

/** Shows a secret exactly once (API key, webhook signing secret, invite link). */
export function SecretReveal({ open, onClose, title, description, secret, warning }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; secret: string; warning: ReactNode }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  return (
    <Modal open={open} onClose={onClose} title={translateUi(title)} description={translateUi(description)}>
      <div className="mt-4">
        <Alert tone="warn">{translateUi(warning)}</Alert>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2">
        <code className="mono flex-1 select-all break-all text-ink-900">{secret}</code>
        <CopyButton value={secret} />
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" variant="primary" onClick={onClose}>{translateUi("I have stored it")}</Button>
      </div>
    </Modal>
  );
}
