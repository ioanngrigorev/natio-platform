import Link from "next/link";
import type { ReactNode } from "react";

export function EntityLink({ kind, id, children }: { kind: "providers" | "provider-accounts" | "users" | "merchants"; id?: string | null; children: ReactNode }) {
  return id ? <Link prefetch={false} href={`/admin/${kind}/${encodeURIComponent(id)}`} className="font-medium text-brand-600 hover:underline">{children || id}</Link> : <>{children || "—"}</>;
}
