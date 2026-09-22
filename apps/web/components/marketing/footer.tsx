import Link from "next/link";
import { FOOTER_COLUMNS, LEGAL_LINE } from "./nav";

export function SiteFooter() {
  return (
    <footer className="border-t border-night-700 bg-night-950">
      <div className="mx-auto max-w-[1240px] px-5 py-14 md:px-8">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2">
            <span className="text-[17px] font-semibold tracking-[0.14em] text-mist-50">NATIO</span>
            <p className="mt-4 max-w-xs text-[13.5px] leading-[1.7] text-mist-400">
              Payments. Orchestrated. One API, multiple payment rails, intelligent routing.
            </p>
            <div className="mt-5 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">
              <span className="h-[5px] w-[5px] rounded-full bg-lime" aria-hidden />
              <span>Payment orchestration infrastructure</span>
            </div>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">{col.title}</div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13.5px] text-mist-400 transition-colors hover:text-mist-50">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-night-700 pt-7 text-[12px] leading-[1.6] text-mist-400 md:flex-row md:items-start md:justify-between">
          <p className="max-w-2xl">{LEGAL_LINE}</p>
          <p className="shrink-0">© 2026 NATIO</p>
        </div>
      </div>
    </footer>
  );
}
