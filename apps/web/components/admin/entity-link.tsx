"use client";
import {useI18n} from '@/lib/i18n/provider';

import Link from "next/link";
import type { ReactNode } from "react";

export function EntityLink({ kind, id, children }: { kind: "providers" | "provider-accounts" | "users" | "merchants"; id?: string | null; children: ReactNode }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  return id ? <Link prefetch={false} href={`/admin/${kind}/${encodeURIComponent(id)}`} className="font-medium text-brand-600 hover:underline">{translateUi(children || id)}</Link> : <>{translateUi(children || "—")}</>;
}
