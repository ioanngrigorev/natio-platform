import type { Metadata } from "next";
import Link from "next/link";
import { Chip, CtaBand, Feature, FeatureGrid, PageIntro, PrimaryCta, SecondaryCta, Section, SpecList } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Product",
  description: "An overview of the NATIO payment orchestration platform: Universal Payment API, orchestration engine, payouts, reconciliation, settlement visibility, webhooks, risk rules and analytics.",
};

const MODULES: Array<{ href: string; title: string; body: string; items: string[] }> = [
  {
    href: "/payments",
    title: "Universal Payment API",
    body: "One REST API for payments, refunds, stored payment method references and transaction history across every connected provider.",
    items: ["POST /v1/payments with amount, currency, payment_method", "Capture, cancel, refund", "Hosted pages and QR via next_action", "Idempotency-Key on every mutating call"],
  },
  {
    href: "/orchestration",
    title: "Orchestration engine",
    body: "Risk evaluation, routing and provider attempts run inside the request. Every step is written to the payment timeline.",
    items: ["Strict state machine per payment, refund and payout", "Retry and failover with double-charge protection", "Provider status lookup after timeouts", "Timeline endpoint for support and audit"],
  },
  {
    href: "/routing",
    title: "Routing",
    body: "Deterministic, rule-based provider selection. Conditions on country, currency, method, amount, risk and time; ordered, weighted or score-based strategies.",
    items: ["Priority-ordered rules", "Eligibility by method, currency, country and limits", "Transparent scoring (cost, approval rate, uptime, latency)", "Architecture prepared for ML ranking later"],
  },
  {
    href: "/payouts",
    title: "Payouts",
    body: "Send funds to beneficiaries through licensed providers selected by payout routing rules. Destinations are tokenised references.",
    items: ["POST /v1/payouts", "bank_account, wallet, card_token destinations", "Cancel while pending", "Payout events by webhook"],
  },
  {
    href: "/reconciliation",
    title: "Reconciliation & settlement",
    body: "Match provider reports against NATIO records and follow the settlement batches providers report.",
    items: ["CSV import today, provider APIs next", "MATCHED / MISSING_PROVIDER / MISSING_NATIO / AMOUNT_MISMATCH / STATUS_MISMATCH", "Settlement batches with gross, fees, net", "Processed vs settled per currency"],
  },
  {
    href: "/docs/webhooks",
    title: "Webhooks",
    body: "Signed, retried event delivery for payments, refunds, payouts and settlements, with delivery logs and manual resend.",
    items: ["Natio-Signature HMAC-SHA256 with timestamp", "Backoff 30s → 2h, up to 6 attempts", "Delivery attempts visible in the dashboard", "Test endpoint from the API"],
  },
  {
    href: "/orchestration#risk",
    title: "Risk rules",
    body: "Configurable rules score each payment before routing: allow, review or block. Reviews wait for an operator decision.",
    items: ["Amount, velocity and attribute rules", "Score and decision stored with the payment", "Manual approve / reject with audit trail", "Blocked payments fail with risk_blocked"],
  },
  {
    href: "/product#operations",
    title: "Analytics & monitoring",
    body: "Transaction monitor and analytics across providers, methods and countries, computed from your own data.",
    items: ["Volume and approval rate over time", "Provider comparison: approval, latency, fees", "Failure breakdown by code and category", "Filters by provider, method, country, currency"],
  },
];

export default function ProductPage() {
  return (
    <>
      <PageIntro
        eyebrow="Product"
        title="Payment orchestration as a single infrastructure layer."
        lead="NATIO sits between your platform and the licensed payment providers you use. It exposes one API, decides where each payment or payout goes, protects you from provider failures, and gives finance and operations one view of everything that happened."
        actions={
          <>
            <PrimaryCta />
            <SecondaryCta />
          </>
        }
      />

      <Section eyebrow="Modules" title="What the platform consists of." lead="Each module is exposed through the API and the dashboard. Everything is scoped to a merchant, a project and a mode (test or live).">
        <div className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-2">
          {MODULES.map((m, i) => (
            <div key={m.title} className="flex flex-col border-t border-night-700 pt-5">
              <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="text-[17px] font-medium leading-snug tracking-[-0.012em] text-mist-50">{m.title}</h3>
              <p className="mt-2.5 text-[14px] leading-[1.7] text-mist-400">{m.body}</p>
              <ul className="mt-4 space-y-2 text-[13px] leading-[1.6] text-mist-200">
                {m.items.map((it) => (
                  <li key={it} className="flex gap-2.5">
                    <span className="mt-[8px] h-[3px] w-[3px] shrink-0 rounded-full bg-iris" aria-hidden />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
              <Link href={m.href} className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-iris hover:underline">
                Details
                <span aria-hidden>→</span>
              </Link>
            </div>
          ))}
        </div>
      </Section>

      <Section id="operations" tone="raised" eyebrow="Scope" title="What NATIO does, and what it deliberately does not." lead="NATIO is a technology infrastructure layer. The regulated parts of a payment stay with the licensed providers connected to the platform.">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <h3 className="text-[14px] font-medium text-mist-50">NATIO does</h3>
            <SpecList
              className="mt-3"
              items={[
                { term: "Provider connectivity", detail: "Adapters normalise provider APIs, statuses and failure codes into one model." },
                { term: "Routing", detail: "Selects eligible providers per payment using your rules and provider capabilities." },
                { term: "Retry and failover", detail: "Cascades soft declines and technical failures to the next provider without double charges." },
                { term: "Payment operations", detail: "Transaction monitor, timeline, reconciliation, settlement visibility, analytics." },
                { term: "Event delivery", detail: "Signed webhooks with retries, logs and manual resend." },
              ]}
            />
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-mist-50">NATIO does not</h3>
            <SpecList
              className="mt-3"
              items={[
                { term: "Hold funds", detail: "Funds move between the merchant and licensed providers, which settle directly. The balances endpoint reports custodian: false." },
                { term: "Touch card data", detail: "Card entry happens on provider hosted pages or via provider tokenisation. NATIO stores token references only." },
                { term: "Act as a bank or acquirer", detail: "Processing, acquiring and settlement are performed by the licensed providers connected to the platform." },
                { term: "Hide decisions", detail: "Every routing, risk and retry decision is recorded on the payment timeline and in the audit log." },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section eyebrow="Payment methods" title="Seven method types, one request shape." lead="The payment_method field takes a type or a stored reference. Which providers can serve a given type, currency and country is configuration, not code.">
        <div className="flex flex-wrap gap-2">
          {["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local"].map((m) => (
            <Chip key={m}>{m}</Chip>
          ))}
        </div>
        <FeatureGrid cols={3} className="mt-10">
          <Feature index={1} title="Synchronous rails">
            Card and wallet payments return their final status in the create response, including the provider that processed them.
          </Feature>
          <Feature index={2} title="Asynchronous rails">
            Bank transfers, QR and open banking return processing with a next_action (redirect or qr_code). Completion arrives as a webhook.
          </Feature>
          <Feature index={3} title="Test and live">
            natio_sk_test_ keys run against NATIO demo providers with scripted scenarios; natio_sk_live_ keys run against the providers configured for your project.
          </Feature>
        </FeatureGrid>
      </Section>

      <CtaBand />
    </>
  );
}
