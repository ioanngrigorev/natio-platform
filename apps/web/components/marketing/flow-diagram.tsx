import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Payment flow diagram: Merchant → NATIO API → Orchestration engine → Providers → Settlement.
 * Plain HTML + inline SVG connectors; horizontal on large screens, stacked on small ones.
 */

function Arrow({ label }: { label?: string }) {
  return (
    <div className="relative flex shrink-0 items-center justify-center self-center lg:h-auto lg:w-16 lg:flex-col lg:self-center" aria-hidden>
      {/* vertical (mobile) */}
      <svg className="h-10 w-6 lg:hidden" viewBox="0 0 24 40" fill="none">
        <path d="M12 2v30" stroke="#3A4152" strokeWidth="1.25" />
        <path d="M6 30l6 8 6-8" stroke="#5C6373" strokeWidth="1.25" fill="none" />
      </svg>
      {/* horizontal (desktop) */}
      <svg className="hidden h-6 w-14 lg:block" viewBox="0 0 56 24" fill="none">
        <path d="M2 12h44" stroke="#3A4152" strokeWidth="1.25" />
        <path d="M44 6l8 6-8 6" stroke="#5C6373" strokeWidth="1.25" fill="none" />
      </svg>
      {label ? <span className="absolute top-full hidden whitespace-nowrap pt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-mist-600 lg:block">{label}</span> : null}
    </div>
  );
}

function Node({ title, subtitle, children, tone = "default", className }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode; tone?: "default" | "brand" | "muted"; className?: string }) {
  const tones = {
    default: "border-night-700 bg-night-850",
    brand: "border-iris/45 bg-night-850",
    muted: "border-night-700 bg-night-950",
  };
  return (
    <div className={cx("flex min-w-0 flex-1 flex-col rounded-xl border p-4", tones[tone], className)}>
      <div className="text-[13px] font-medium leading-5 text-mist-50">{title}</div>
      {subtitle ? <div className="mt-1.5 text-[12px] leading-5 text-mist-400">{subtitle}</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function FlowDiagram() {
  return (
    <figure className="w-full">
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <Node title="Merchant" subtitle="Your checkout, platform or backend. One integration, one contract, one set of credentials." className="lg:max-w-[190px]">
          <div className="font-mono text-[11px] text-mist-400">POST /v1/payments</div>
        </Node>

        <Arrow label="HTTPS" />

        <div className="relative flex flex-1 flex-col rounded-xl border border-dashed border-iris/40 p-3 pt-6 lg:flex-[2.6] lg:flex-row lg:items-stretch lg:p-4 lg:pt-7">
          <span className="absolute left-3 top-[-8px] bg-night-900 px-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-iris lg:left-4">NATIO · technology infrastructure layer</span>
          <Node title="Universal Payment API" subtitle="REST API: payments, refunds, payouts, transactions, settlements, webhooks." tone="brand">
            <ul className="space-y-1 font-mono text-[11px] text-mist-400">
              <li>Idempotency-Key</li>
              <li>natio_sk_test_ / natio_sk_live_</li>
              <li>Natio-Signature webhooks</li>
            </ul>
          </Node>
          <Arrow />
          <Node title="Orchestration Engine" subtitle="Deterministic, auditable decisions for every payment.">
            <div className="flex flex-wrap gap-1.5">
              {["Routing", "Risk", "Retry / Failover"].map((c) => (
                <span key={c} className="rounded border border-night-700 bg-night-900 px-1.5 py-[2px] font-mono text-[11px] text-mist-200">
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-3 font-mono text-[11px] text-mist-400">timeline · double-charge protection</div>
          </Node>
        </div>

        <Arrow label="adapters" />

        <Node title="Payment providers" subtitle="Licensed institutions connected to the platform." className="lg:flex-[1.2]">
          <ul className="divide-y divide-night-700 border-y border-night-700 text-[12px] text-mist-200">
            {["Acquirers", "Banks", "PSPs", "Local payment methods"].map((p) => (
              <li key={p} className="flex items-center justify-between py-1.5">
                <span>{p}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-night-500" aria-hidden />
              </li>
            ))}
          </ul>
        </Node>

        <Arrow label="settlement" />

        <Node title="Settlement" subtitle="Performed directly by the licensed providers to the merchant. NATIO holds no customer funds." tone="muted" className="lg:max-w-[200px]">
          <div className="font-mono text-[11px] text-mist-400">custodian: false</div>
        </Node>
      </div>
      <figcaption className="mt-5 grid grid-cols-1 gap-2 text-[12px] leading-5 text-mist-400 md:grid-cols-3">
        <div>
          <span className="font-medium text-mist-200">Card data never touches NATIO.</span> Hosted pages and tokenisation are handled by PCI-compliant providers; NATIO stores token references only.
        </div>
        <div>
          <span className="font-medium text-mist-200">Funds move between you and licensed providers.</span> NATIO orchestrates the request and reads back settlement data; it does not hold or take customer funds.
        </div>
        <div>
          <span className="font-medium text-mist-200">Every decision is recorded.</span> Risk, routing, provider attempts, failover and webhooks are written to a per-payment timeline.
        </div>
      </figcaption>
    </figure>
  );
}
