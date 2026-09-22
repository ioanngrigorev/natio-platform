import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Dark brand surface for natio.me and /docs.
 *
 * Rules that keep this from turning into visual noise:
 *  - One accent per section. `iris` is the default; `lime` marks a positive
 *    outcome, `aqua` a secondary dimension. Never all three in one block.
 *  - Type carries the page, not imagery. Display sizes are large and tight;
 *    labels are mono, uppercase, wide-tracked, always with a coloured dot.
 *  - Borders are hairlines (night-700). Fills are flat. Glow is reserved for
 *    the single most important card on a page.
 *
 * The merchant dashboard and admin deliberately stay on the light `ink` scale.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function Container({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cx("mx-auto w-full px-5 md:px-8", narrow ? "max-w-[880px]" : "max-w-[1240px]", className)}>{children}</div>;
}

/** Mono micro-label with a status dot. The site's signature detail. */
export function Eyebrow({ children, className, tone = "iris" }: { children: ReactNode; className?: string; tone?: "iris" | "lime" | "aqua" | "mist" }) {
  const dot = { iris: "bg-iris", lime: "bg-lime", aqua: "bg-aqua", mist: "bg-mist-600" }[tone];
  return (
    <div className={cx("flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-400", className)}>
      <span className={cx("h-[5px] w-[5px] shrink-0 rounded-full", dot)} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** Faint blueprint grid. Sits behind hero and feature sections. */
export function GridBackdrop({ className, fade = true }: { className?: string; fade?: boolean }) {
  return (
    <div
      aria-hidden
      className={cx("pointer-events-none absolute inset-0 bg-grid bg-grid", fade && "[mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_78%)]", className)}
    />
  );
}

export function PageIntro({ eyebrow, title, lead, actions, wide }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode; wide?: boolean }) {
  return (
    <div className="relative overflow-hidden border-b border-night-700 bg-night-950">
      <GridBackdrop />
      <Container className="relative py-16 md:py-24">
        <div className={wide ? "max-w-[980px]" : "max-w-[820px]"}>
          {eyebrow ? <Eyebrow className="mb-5">{eyebrow}</Eyebrow> : null}
          <h1 className="text-[40px] font-medium leading-[1.02] tracking-[-0.032em] text-mist-50 md:text-[62px]">{title}</h1>
          {lead ? <p className="mt-6 max-w-[660px] text-[16.5px] leading-[1.7] text-mist-400 md:text-[17px]">{lead}</p> : null}
          {actions ? <div className="mt-9 flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>
      </Container>
    </div>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  tone = "base",
  className,
  aside,
  grid,
}: {
  id?: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  tone?: "base" | "raised";
  className?: string;
  aside?: ReactNode;
  grid?: boolean;
}) {
  return (
    <section id={id} className={cx("relative overflow-hidden border-b border-night-700", tone === "raised" ? "bg-night-900" : "bg-night-950", className)}>
      {grid ? <GridBackdrop fade={false} className="opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" /> : null}
      <Container className="relative py-16 md:py-24">
        {title || eyebrow ? (
          <div className={cx("mb-12 md:mb-14", aside ? "grid gap-8 md:grid-cols-[1fr_minmax(0,340px)] md:items-end" : "")}>
            <div className="max-w-[760px]">
              {eyebrow ? <Eyebrow className="mb-4">{eyebrow}</Eyebrow> : null}
              {title ? <h2 className="text-[30px] font-medium leading-[1.08] tracking-[-0.026em] text-mist-50 md:text-[42px]">{title}</h2> : null}
              {lead ? <p className="mt-5 text-[15.5px] leading-[1.7] text-mist-400">{lead}</p> : null}
            </div>
            {aside ? <div className="text-[13.5px] leading-[1.7] text-mist-400">{aside}</div> : null}
          </div>
        ) : null}
        {children}
      </Container>
    </section>
  );
}

/** Accent span for the second clause of a display headline. */
export function Accent({ children, tone = "iris" }: { children: ReactNode; tone?: "iris" | "lime" | "aqua" }) {
  const map = { iris: "text-iris", lime: "text-lime", aqua: "text-aqua" };
  return <span className={map[tone]}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Content primitives
// ---------------------------------------------------------------------------
export function FeatureGrid({ children, cols = 3, className }: { children: ReactNode; cols?: 2 | 3 | 4; className?: string }) {
  const map = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" } as const;
  return <div className={cx("grid grid-cols-1 gap-x-10 gap-y-11", map[cols], className)}>{children}</div>;
}

export function Feature({ index, title, children, mono }: { index?: string | number; title: ReactNode; children?: ReactNode; mono?: string }) {
  return (
    <div className="border-t border-night-700 pt-5">
      {index !== undefined ? <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">{typeof index === "number" ? String(index).padStart(2, "0") : index}</div> : null}
      <h3 className="text-[16.5px] font-medium leading-snug tracking-[-0.01em] text-mist-50">{title}</h3>
      {children ? <div className="mt-2.5 text-[14px] leading-[1.7] text-mist-400">{children}</div> : null}
      {mono ? <div className="mt-3 font-mono text-[12px] text-iris">{mono}</div> : null}
    </div>
  );
}

export function Split({ children, panel, reverse, align = "start" }: { children: ReactNode; panel: ReactNode; reverse?: boolean; align?: "start" | "center" }) {
  return (
    <div className={cx("grid gap-10 lg:grid-cols-2 lg:gap-14", align === "center" && "lg:items-center")}>
      <div className={cx("min-w-0", reverse && "lg:order-2")}>{children}</div>
      <div className={cx("min-w-0", reverse && "lg:order-1")}>{panel}</div>
    </div>
  );
}

export function SpecList({ items, className }: { items: Array<{ term: ReactNode; detail: ReactNode }>; className?: string }) {
  return (
    <dl className={cx("divide-y divide-night-700 border-y border-night-700", className)}>
      {items.map((it, i) => (
        <div key={i} className="grid gap-1.5 py-4 md:grid-cols-[minmax(0,200px)_1fr] md:gap-8">
          <dt className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-mist-400">{it.term}</dt>
          <dd className="text-[14.5px] leading-[1.7] text-mist-200">{it.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `padded={false}` hands the inner padding to the content — used when a Panel
 * wraps a divided list, so the hairlines run the full width of the card.
 */
export function Panel({ children, className, title, glow, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; glow?: boolean; padded?: boolean }) {
  return (
    <div className={cx("overflow-hidden rounded-2xl border border-night-700 bg-night-850", padded && "p-6", glow && "shadow-glow", className)}>
      {title ? (
        <div className={cx("font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-400", padded ? "mb-4" : "border-b border-night-700 px-5 py-3")}>{title}</div>
      ) : null}
      {children}
    </div>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "ok" | "warn" | "bad" | "muted" }) {
  const map = {
    neutral: "border-night-600 bg-night-800 text-mist-200",
    brand: "border-iris/30 bg-iris/10 text-iris",
    ok: "border-lime/25 bg-lime/10 text-lime",
    warn: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    bad: "border-rose-400/25 bg-rose-400/10 text-rose-300",
    muted: "border-night-600 bg-transparent text-mist-400",
  };
  return <span className={cx("inline-flex items-center rounded-full border px-2.5 py-[3px] font-mono text-[11px]", map[tone])}>{children}</span>;
}

/** Large number + mono caption. The metric vocabulary of the site. */
export function Metric({ value, label, tone = "mist", sub }: { value: ReactNode; label: ReactNode; tone?: "mist" | "iris" | "lime" | "aqua"; sub?: ReactNode }) {
  const map = { mist: "text-mist-50", iris: "text-iris", lime: "text-lime", aqua: "text-aqua" };
  return (
    <div>
      <div className={cx("text-[30px] font-medium leading-none tracking-[-0.03em] md:text-[36px]", map[tone])}>{value}</div>
      <div className="mt-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mist-600">{label}</div>
      {sub ? <div className="mt-1.5 text-[13px] leading-6 text-mist-400">{sub}</div> : null}
    </div>
  );
}

/** Row of metrics divided by hairlines, as on the reference site. */
export function MetricRow({ items, className }: { items: Array<{ value: ReactNode; label: ReactNode; tone?: "mist" | "iris" | "lime" | "aqua" }>; className?: string }) {
  return (
    <div className={cx("grid grid-cols-2 gap-px overflow-hidden border-y border-night-700 bg-night-700 md:grid-cols-4", className)}>
      {items.map((m, i) => (
        <div key={i} className="bg-night-950 px-5 py-7 md:px-6">
          <Metric value={m.value} label={m.label} tone={m.tone} />
        </div>
      ))}
    </div>
  );
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("prose-natio prose-dark", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Calls to action — pill buttons, as on the reference
// ---------------------------------------------------------------------------
export function PrimaryCta({ href = "/dashboard/register", children = "Start Integration", size = "md" }: { href?: string; children?: ReactNode; size?: "md" | "lg" }) {
  return (
    <Link
      href={href}
      className={cx(
        "group inline-flex items-center gap-2 rounded-full bg-mist-50 font-medium text-night-950 transition-colors hover:bg-white",
        size === "lg" ? "h-12 pl-6 pr-5 text-[15px]" : "h-10 pl-5 pr-4 text-[14px]",
      )}
    >
      {children}
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}

export function SecondaryCta({ href = "/contact", children = "Talk to Us", size = "md" }: { href?: string; children?: ReactNode; size?: "md" | "lg" }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center rounded-full border border-night-600 font-medium text-mist-200 transition-colors hover:border-mist-400 hover:text-mist-50",
        size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-5 text-[14px]",
      )}
    >
      {children}
    </Link>
  );
}

export function CtaBand({
  title = "Ready to connect once?",
  lead = "Create a sandbox account, run test scenarios against demo providers and see routing, failover and reconciliation end to end.",
  primary,
  secondary,
}: {
  title?: ReactNode;
  lead?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-night-700 bg-night-900">
      <GridBackdrop fade={false} className="opacity-70 [mask-image:radial-gradient(ellipse_at_50%_120%,black,transparent_70%)]" />
      <Container className="relative py-16 md:py-20">
        <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
          <div className="max-w-[640px]">
            <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.026em] text-mist-50 md:text-[36px]">{title}</h2>
            {lead ? <p className="mt-4 text-[15px] leading-[1.7] text-mist-400">{lead}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {primary ?? <PrimaryCta size="lg" />}
            {secondary ?? <SecondaryCta size="lg" />}
          </div>
        </div>
      </Container>
    </section>
  );
}
