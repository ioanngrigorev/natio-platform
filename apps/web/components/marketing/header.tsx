"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { PRIMARY_NAV } from "./nav";

export function Wordmark({ suffix, className }: { suffix?: string; className?: string }) {
  return (
    <Link href="/" className={cx("flex items-center gap-2.5", className)} aria-label="NATIO home">
      <span className="text-[17px] font-semibold tracking-[0.14em] text-mist-50">NATIO</span>
      {suffix ? <span className="rounded-full border border-night-600 px-2 py-[1px] font-mono text-[10px] uppercase tracking-[0.12em] text-mist-400">{suffix}</span> : null}
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-night-700 bg-night-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-8 px-5 md:px-8">
        <Wordmark />
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
          {PRIMARY_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/") || (item.href === "/developers" && pathname.startsWith("/docs"));
            return (
              <Link key={item.href} href={item.href} className={cx("text-[13.5px] transition-colors", active ? "text-mist-50" : "text-mist-400 hover:text-mist-50")}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-4 md:flex">
          <Link href="/dashboard/login" className="text-[13.5px] text-mist-400 transition-colors hover:text-mist-50">
            Sign in
          </Link>
          <Link href="/dashboard/register" className="inline-flex h-9 items-center rounded-full bg-mist-50 px-4 text-[13.5px] font-medium text-night-950 transition-colors hover:bg-white">
            Start Integration
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-night-600 text-mist-200 lg:hidden"
        >
          <span aria-hidden className="text-[15px] leading-none">{open ? "×" : "≡"}</span>
        </button>
      </div>
      {open ? (
        <div className="border-t border-night-700 bg-night-950 lg:hidden">
          <nav className="mx-auto max-w-[1240px] px-5 py-4 md:px-8" aria-label="Primary mobile">
            <ul className="grid gap-1">
              {PRIMARY_NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="block rounded-lg px-2 py-2 text-[14.5px] text-mist-200 hover:bg-night-850 hover:text-mist-50">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-3 border-t border-night-700 pt-4">
              <Link href="/dashboard/login" className="inline-flex h-9 items-center rounded-full border border-night-600 px-4 text-[13.5px] text-mist-200">
                Sign in
              </Link>
              <Link href="/dashboard/register" className="inline-flex h-9 items-center rounded-full bg-mist-50 px-4 text-[13.5px] font-medium text-night-950">
                Start Integration
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
