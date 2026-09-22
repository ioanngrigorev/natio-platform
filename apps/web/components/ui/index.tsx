import Link from "next/link";
import type { ReactNode } from "react";
import { titleCase } from "@/lib/format";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {breadcrumb ? <div className="mb-1 text-[12px] text-ink-500">{breadcrumb}</div> : null}
        <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, description, actions, children, className, padded = true }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-lg bg-white shadow-card", className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold text-ink-900">{title}</h2>
            {description ? <p className="mt-0.5 text-[12px] text-ink-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Grid({ cols = 4, children, className }: { cols?: 2 | 3 | 4 | 6; children: ReactNode; className?: string }) {
  const map = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4", 6: "sm:grid-cols-3 xl:grid-cols-6" } as const;
  return <div className={cx("grid grid-cols-1 gap-4", map[cols], className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------
export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad" | "neutral" }) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink-900";
  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{label}</div>
      <div className={cx("mt-1 text-[22px] font-semibold tabular tracking-tight", toneClass)}>{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-ink-500">{hint}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const STATUS_TONES: Record<string, string> = {
  successful: "bg-ok-bg text-ok",
  succeeded: "bg-ok-bg text-ok",
  captured: "bg-ok-bg text-ok",
  settled: "bg-ok-bg text-ok",
  active: "bg-ok-bg text-ok",
  approved: "bg-ok-bg text-ok",
  completed: "bg-ok-bg text-ok",
  matched: "bg-ok-bg text-ok",
  delivered: "bg-ok-bg text-ok",
  allow: "bg-ok-bg text-ok",
  ok: "bg-ok-bg text-ok",
  authorized: "bg-info-bg text-info",
  processing: "bg-info-bg text-info",
  delivering: "bg-info-bg text-info",
  created: "bg-muted-bg text-muted",
  pending: "bg-warn-bg text-warn",
  review: "bg-warn-bg text-warn",
  invited: "bg-warn-bg text-warn",
  unknown: "bg-warn-bg text-warn",
  partially_refunded: "bg-warn-bg text-warn",
  refunded: "bg-muted-bg text-muted",
  cancelled: "bg-muted-bg text-muted",
  disabled: "bg-muted-bg text-muted",
  revoked: "bg-muted-bg text-muted",
  not_started: "bg-muted-bg text-muted",
  failed: "bg-bad-bg text-bad",
  exhausted: "bg-bad-bg text-bad",
  rejected: "bg-bad-bg text-bad",
  block: "bg-bad-bg text-bad",
  error: "bg-bad-bg text-bad",
  missing_provider: "bg-bad-bg text-bad",
  missing_natio: "bg-bad-bg text-bad",
  amount_mismatch: "bg-warn-bg text-warn",
  status_mismatch: "bg-warn-bg text-warn",
  live: "bg-ok-bg text-ok",
  test: "bg-warn-bg text-warn",
  warning: "bg-warn-bg text-warn",
  info: "bg-info-bg text-info",
  // On-chain settlement addresses. `awaiting` is money seen but not yet final,
  // which is the same kind of in-flight as `processing`; `underpaid` is the one
  // that genuinely needs a human, so it is the only red one here.
  awaiting: "bg-info-bg text-info",
  reserved: "bg-muted-bg text-muted",
  underpaid: "bg-bad-bg text-bad",
  expired: "bg-muted-bg text-muted",
  archived: "bg-muted-bg text-muted",
};

/** Same semantics on the night surface: tinted fill + hairline, never colour alone. */
const STATUS_TONES_DARK: Record<string, string> = {
  ok: "border-lime/25 bg-lime/10 text-lime",
  info: "border-aqua/25 bg-aqua/10 text-aqua",
  warn: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  bad: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  muted: "border-night-600 bg-night-800 text-mist-200",
};

function darkToneFor(light: string): string {
  if (light.includes("text-ok")) return STATUS_TONES_DARK.ok;
  if (light.includes("text-info")) return STATUS_TONES_DARK.info;
  if (light.includes("text-warn")) return STATUS_TONES_DARK.warn;
  if (light.includes("text-bad")) return STATUS_TONES_DARK.bad;
  return STATUS_TONES_DARK.muted;
}

/**
 * `variant="dark"` is used by the public site and /docs; the dashboard and admin
 * keep the light tones above.
 */
export function StatusBadge({ status, label, variant = "light" }: { status: string | null | undefined; label?: string; variant?: "light" | "dark" }) {
  const s = (status ?? "unknown").toLowerCase();
  const light = STATUS_TONES[s] ?? "bg-muted-bg text-muted";
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full text-[11px] font-medium leading-4 whitespace-nowrap",
        variant === "dark" ? cx("border px-2 py-[2px] font-mono", darkToneFor(light)) : cx("px-2 py-[2px]", light),
      )}
    >
      {label ?? titleCase(s)}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "ok" | "warn" | "bad" }) {
  const map = { neutral: "bg-ink-100 text-ink-700", brand: "bg-brand-50 text-brand-600", ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad" };
  return <span className={cx("inline-flex items-center rounded px-1.5 py-[1px] text-[11px] font-medium", map[tone])}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; loading?: boolean };

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "h-7 px-2.5 text-[12px]", md: "h-8 px-3 text-[13px]" };
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 border border-brand-600",
    secondary: "bg-white text-ink-800 border border-ink-200 hover:bg-ink-50",
    danger: "bg-white text-bad border border-bad/40 hover:bg-bad-bg",
    ghost: "bg-transparent text-ink-700 hover:bg-ink-100 border border-transparent",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary", size = "md", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md"; className?: string }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors";
  const sizes = { sm: "h-7 px-2.5 text-[12px]", md: "h-8 px-3 text-[13px]" };
  const variants = { primary: "bg-brand-600 text-white hover:bg-brand-700 border border-brand-600", secondary: "bg-white text-ink-800 border border-ink-200 hover:bg-ink-50", ghost: "text-ink-700 hover:bg-ink-100 border border-transparent" };
  return (
    <Link href={href} className={cx(base, sizes[size], variants[variant], className)}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="data-table">{children}</table>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-[14px] font-medium text-ink-800">{title}</div>
      {description ? <div className="mt-1 max-w-md text-[13px] text-ink-500">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("mono", className)}>{children}</span>;
}

export function DescriptionList({ items, cols = 2 }: { items: Array<{ label: string; value: ReactNode }>; cols?: 1 | 2 | 3 }) {
  const map = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };
  return (
    <dl className={cx("grid grid-cols-1 gap-x-6 gap-y-3", map[cols])}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{it.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-ink-900">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: string; children?: ReactNode }) {
  const map = { info: "bg-info-bg text-info border-info/20", warn: "bg-warn-bg text-warn border-warn/20", bad: "bg-bad-bg text-bad border-bad/20", ok: "bg-ok-bg text-ok border-ok/20" };
  return (
    <div className={cx("rounded-md border px-3 py-2 text-[13px]", map[tone])}>
      {title ? <div className="font-medium">{title}</div> : null}
      {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
    </div>
  );
}

export function Pagination({ hasMore, nextCursor, baseHref, params }: { hasMore: boolean; nextCursor: string | null; baseHref: string; params: Record<string, string | undefined> }) {
  if (!hasMore || !nextCursor) return null;
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  u.set("cursor", nextCursor);
  return (
    <div className="flex justify-end border-t border-ink-100 px-4 py-2">
      <Link href={`${baseHref}?${u.toString()}`} className="text-[12px] font-medium text-brand-600 hover:underline">
        Next page →
      </Link>
    </div>
  );
}

/**
 * `variant="dark"` is used by the public site and /docs, which sit on the night
 * surface; the dashboard and admin keep the default light-page treatment.
 */
export function CodeBlock({ code, language, variant = "light", className }: { code: string; language?: string; variant?: "light" | "dark"; className?: string }) {
  return (
    <pre
      className={cx(
        "overflow-x-auto p-4 text-[12.5px] leading-6",
        variant === "dark" ? "rounded-xl border border-night-700 bg-night-900 text-mist-200 code-scroll-dark" : "rounded-lg bg-ink-900 text-ink-100",
        className,
      )}
      data-language={language}
    >
      <code>{code}</code>
    </pre>
  );
}

export function Field({ label, help, children, htmlFor }: { label: string; help?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}
