"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { DOCS_NAV, type SiteLink } from "@/components/marketing/nav";

const FLAT: SiteLink[] = DOCS_NAV.flatMap((s) => s.items);

function useActive(): string {
  const pathname = usePathname();
  return pathname ?? "/docs";
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/docs") return pathname === "/docs";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Left navigation. Sticky on desktop; a disclosure above the content on mobile. */
export function DocsSidebar() {
  const pathname = useActive();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const current = FLAT.find((i) => isActive(pathname, i.href));

  return (
    <aside className="lg:w-[236px] lg:shrink-0">
      {/* Mobile disclosure */}
      <div className="border-b border-night-700 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="docs-nav"
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-night-600 bg-night-850 px-4 py-3 text-left transition-colors hover:border-night-500"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">
              <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-iris" aria-hidden />
              Documentation
            </span>
            <span className="mt-1 block truncate text-[14px] font-medium text-mist-50">{current?.label ?? "Overview"}</span>
          </span>
          <span className={cx("shrink-0 text-[11px] text-mist-400 transition-transform", open ? "rotate-180" : "")} aria-hidden>
            ▾
          </span>
        </button>
      </div>

      <nav
        id="docs-nav"
        aria-label="Documentation"
        className={cx(
          "lg:sticky lg:top-14 lg:block lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:border-r lg:border-night-700 lg:py-10 lg:pr-5",
          open ? "block border-b border-night-700 py-4" : "hidden",
        )}
      >
        {DOCS_NAV.map((section) => (
          <div key={section.section} className="mb-7 last:mb-0">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-600">{section.section}</div>
            <ul className="border-l border-night-700">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href} className={cx("-ml-px border-l", active ? "border-iris" : "border-transparent")}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "block py-[6px] pl-3.5 text-[13.5px] leading-5 transition-colors",
                        active ? "font-medium text-mist-50" : "text-mist-400 hover:text-mist-200",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="mt-9 space-y-2 border-t border-night-700 pt-5 text-[12.5px] leading-5 lg:mt-8">
          <Link href="/openapi.json" className="block text-mist-400 transition-colors hover:text-iris">
            OpenAPI 3.1 spec
          </Link>
          <Link href="/dashboard/register" className="block text-mist-400 transition-colors hover:text-iris">
            Create a sandbox account
          </Link>
        </div>
      </nav>
    </aside>
  );
}

/** Previous / next links derived from the same DOCS_NAV order. */
export function DocsPager() {
  const pathname = useActive();
  const idx = FLAT.findIndex((i) => isActive(pathname, i.href));
  if (idx < 0) return null;
  const prev = idx > 0 ? FLAT[idx - 1] : undefined;
  const next = idx < FLAT.length - 1 ? FLAT[idx + 1] : undefined;
  if (!prev && !next) return null;
  return (
    <nav aria-label="Pagination" className="mt-16 grid grid-cols-1 gap-x-8 gap-y-6 border-t border-night-700 pt-7 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className="group">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist-600">Previous</span>
          <span className="mt-1.5 block text-[15px] font-medium text-mist-200 transition-colors group-hover:text-iris">
            <span aria-hidden className="mr-1.5 text-mist-600 transition-colors group-hover:text-iris">
              ←
            </span>
            {prev.label}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className="group text-right sm:col-start-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist-600">Next</span>
          <span className="mt-1.5 block text-[15px] font-medium text-mist-200 transition-colors group-hover:text-iris">
            {next.label}
            <span aria-hidden className="ml-1.5 text-mist-600 transition-colors group-hover:text-iris">
              →
            </span>
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
