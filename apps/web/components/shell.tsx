"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { useSession } from "@/components/session-provider";

export interface NavItem {
  href: string;
  label: string;
  section?: string;
  exact?: boolean;
}

export function Shell({ nav, brand, children }: { nav: NavItem[]; brand: { title: string; subtitle?: string }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const base = session.kind === "admin" ? "/admin" : "/dashboard";

  const sections = nav.reduce<Array<{ section: string; items: NavItem[] }>>((acc, item) => {
    const s = item.section ?? "";
    const last = acc[acc.length - 1];
    if (last && last.section === s) last.items.push(item);
    else acc.push({ section: s, items: [item] });
    return acc;
  }, []);

  async function logout() {
    await fetch(`/api${base}/auth/logout`, { method: "POST", headers: { "x-csrf-token": session.csrf } });
    router.push(`${base}/login`);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-ink-200 bg-white md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-ink-100 px-4">
          <Link href={base} className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-ink-900 text-[11px] font-bold text-white">N</span>
            <span className="text-[14px] font-semibold tracking-tight">NATIO</span>
          </Link>
          <span className="ml-auto rounded bg-ink-100 px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-ink-600">{brand.title}</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {sections.map((s) => (
            <div key={s.section || "root"} className="mb-4">
              {s.section ? <div className="px-2 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-400">{s.section}</div> : null}
              {s.items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link key={item.href} href={item.href} className={cx("block rounded-md px-2 py-[6px] text-[13px]", active ? "bg-ink-100 font-medium text-ink-900" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900")}>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-ink-100 px-4 py-3 text-[12px] text-ink-500">
          <div className="truncate font-medium text-ink-800">{session.user.name}</div>
          <div className="truncate">{session.user.email}</div>
          <div className="mt-0.5 capitalize">{session.user.role}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-4 md:px-6">
          <div className="md:hidden">
            <Link href={base} className="text-[14px] font-semibold">NATIO</Link>
          </div>
          <div className="hidden text-[13px] text-ink-500 md:block">{brand.subtitle}</div>
          <div className="ml-auto flex items-center gap-3">
            <ModeToggle />
            <button onClick={logout} className="text-[12px] text-ink-500 hover:text-ink-900">
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function ModeToggle() {
  const session = useSession();
  return (
    <div className="flex items-center rounded-md border border-ink-200 p-[2px] text-[12px]" role="radiogroup" aria-label="Data mode">
      {(["test", "live"] as const).map((m) => (
        <button key={m} role="radio" aria-checked={session.mode === m} onClick={() => session.setMode(m)} className={cx("rounded px-2.5 py-[3px] font-medium capitalize", session.mode === m ? (m === "live" ? "bg-ok text-white" : "bg-warn text-white") : "text-ink-500 hover:text-ink-900")}>
          {m === "test" ? "Test data" : "Live data"}
        </button>
      ))}
    </div>
  );
}
