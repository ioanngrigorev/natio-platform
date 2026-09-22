import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { Eyebrow } from "@/components/marketing/sections";

/** Page header used at the top of every documentation page. */
export function DocHeader({ eyebrow, title, lead }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode }) {
  return (
    <header className="mb-11 border-b border-night-700 pb-8">
      {eyebrow ? <Eyebrow className="mb-4">{eyebrow}</Eyebrow> : null}
      <h1 className="text-[32px] font-medium leading-[1.08] tracking-[-0.028em] text-mist-50 md:text-[38px]">{title}</h1>
      {lead ? <p className="mt-5 max-w-[680px] text-[16px] leading-[1.75] text-mist-400 md:text-[16.5px]">{lead}</p> : null}
    </header>
  );
}

/** Anchored h2 so that in-page links work. */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20">
      {children}
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className={id ? "scroll-mt-20" : undefined}>
      {children}
    </h3>
  );
}

/** Code block with an optional caption bar; overrides the .prose-dark pre defaults. */
export function Code({ caption, code }: { caption?: ReactNode; code: string }) {
  return (
    <figure className="mb-6 overflow-hidden rounded-xl border border-night-700">
      {caption ? (
        <figcaption className="border-b border-night-700 bg-night-850 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mist-400">{caption}</figcaption>
      ) : null}
      <pre className="!mb-0 !rounded-none !border-0 overflow-x-auto bg-night-900 p-4 text-[12.5px] leading-[1.7] text-mist-200">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/** Dense table. Inherits the .prose-dark table treatment and adds horizontal scrolling. */
export function DocTable({ columns, rows, dense }: { columns: ReactNode[]; rows: ReactNode[][]; dense?: boolean }) {
  return (
    <div className="mb-6 overflow-x-auto rounded-lg border border-night-700">
      <table className={cx("!mb-0 w-full !rounded-none !border-0", dense ? "text-[12.5px]" : undefined)}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className="whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Inline monospace token used inside tables and prose. */
export function Tok({ children }: { children: ReactNode }) {
  return <code className="whitespace-nowrap font-mono text-[12px]">{children}</code>;
}

/** HTTP method pill. Colour plus the method word — never colour alone. */
export function Method({ method }: { method: string }) {
  const m = method.toUpperCase();
  const tone =
    m === "GET"
      ? "border-aqua/25 bg-aqua/10 text-aqua"
      : m === "POST"
        ? "border-lime/25 bg-lime/10 text-lime"
        : m === "DELETE"
          ? "border-rose-400/25 bg-rose-400/10 text-rose-300"
          : "border-amber-400/25 bg-amber-400/10 text-amber-300";
  return <span className={cx("inline-flex items-center rounded border px-2 py-[2px] font-mono text-[11px] font-medium tracking-[0.06em]", tone)}>{m}</span>;
}

const NOTE_LABEL = { info: "Note", warn: "Careful", bad: "Important", ok: "Good practice" } as const;

/**
 * Callout used for important integration rules. A left rule plus a coloured dot
 * and a label carry the meaning, so the tint is never the only signal.
 */
export function Note({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: ReactNode; children: ReactNode }) {
  const edge = { info: "border-l-aqua", warn: "border-l-amber-300", bad: "border-l-rose-300", ok: "border-l-lime" } as const;
  const dot = { info: "bg-aqua", warn: "bg-amber-300", bad: "bg-rose-300", ok: "bg-lime" } as const;
  const text = { info: "text-aqua", warn: "text-amber-300", bad: "text-rose-300", ok: "text-lime" } as const;
  return (
    <div className={cx("mb-6 rounded-r-lg border border-l-2 border-night-700 bg-night-900 px-5 py-4", edge[tone])}>
      <div className={cx("flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em]", text[tone])}>
        <span className={cx("h-[5px] w-[5px] shrink-0 rounded-full", dot[tone])} aria-hidden />
        <span>{title ?? NOTE_LABEL[tone]}</span>
      </div>
      <div className="mt-2 text-[14px] leading-[1.7] text-mist-200">{children}</div>
    </div>
  );
}

/** Numbered step block used by the quickstart. */
export function Step({ n, title, children }: { n: number; title: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-12 border-t border-night-700 pt-7 first:mt-0">
      <div className="flex items-baseline gap-3.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-iris">{String(n).padStart(2, "0")}</span>
        <h2 id={`step-${n}`} className="!mt-0 !mb-0 scroll-mt-20 text-[21px] font-medium tracking-[-0.018em] text-mist-50">
          {title}
        </h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Grid of onward links, used on the overview page. Hairline rules, not boxes. */
export function LinkCards({ items }: { items: Array<{ href: string; label: string; description: string }> }) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className="group border-t border-night-700 pt-4 !no-underline">
          <div className="flex items-baseline gap-2 text-[15px] font-medium text-mist-50">
            <span className="transition-colors group-hover:text-iris">{it.label}</span>
            <span aria-hidden className="text-iris opacity-0 transition-opacity group-hover:opacity-100">
              →
            </span>
          </div>
          <p className="!mb-0 mt-1.5 !text-[13.5px] !leading-[1.65] !text-mist-400">{it.description}</p>
        </Link>
      ))}
    </div>
  );
}

/** Small key/value strip for base URLs, versions and similar facts. */
export function FactList({ items }: { items: Array<{ term: ReactNode; detail: ReactNode }> }) {
  return (
    <dl className="mb-6 divide-y divide-night-700 border-y border-night-700">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-1 gap-1 py-3.5 sm:grid-cols-[190px_1fr] sm:gap-6">
          <dt className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-mist-400">{it.term}</dt>
          <dd className="text-[13.5px] leading-[1.7] text-mist-200">{it.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
