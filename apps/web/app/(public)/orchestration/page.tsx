import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { Chip, CtaBand, Feature, FeatureGrid, PageIntro, Panel, PrimaryCta, SecondaryCta, Section, SpecList, Split } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Orchestration",
  description: "How the NATIO orchestration engine evaluates risk, routes payments, retries and fails over between providers without double charges, and records every step on a transaction timeline.",
};

const STATUSES: Array<{ status: string; meaning: string; next: string }> = [
  { status: "created", meaning: "Accepted and persisted; not yet sent to a provider.", next: "processing · pending · failed · cancelled" },
  { status: "pending", meaning: "Waiting: manual risk review, or a provider awaiting customer action.", next: "processing · failed · cancelled" },
  { status: "processing", meaning: "A provider attempt is in flight, or the payment awaits an asynchronous confirmation.", next: "authorized · successful · failed · cancelled · pending" },
  { status: "authorized", meaning: "Funds reserved by the provider; capture pending (capture_method: manual).", next: "successful · cancelled · failed" },
  { status: "captured", meaning: "Transitional state during capture.", next: "successful" },
  { status: "successful", meaning: "The provider confirmed the payment. Refundable.", next: "partially_refunded · refunded" },
  { status: "partially_refunded", meaning: "One or more refunds cover part of the captured amount.", next: "partially_refunded · refunded" },
  { status: "refunded", meaning: "Fully refunded. Terminal.", next: "—" },
  { status: "failed", meaning: "Declined, blocked or all eligible providers failed. Terminal, with a failure object.", next: "—" },
  { status: "cancelled", meaning: "Cancelled by the merchant before completion. Terminal.", next: "—" },
];

/** Static example matching the real timeline event types and titles emitted by the engine (test_scenario: failover). */
const TIMELINE: Array<{ type: string; title: string; description: string; tone?: "ok" | "bad" | "warn" | "info" }> = [
  { type: "payment.created", title: "Payment created", description: "100.00 USD · card · US" },
  { type: "risk.evaluated", title: "Risk evaluated: ALLOW", description: "score 0 · no rules matched", tone: "ok" },
  { type: "routing.evaluated", title: "Routing rule evaluated: Cards → Acquirer A, fallback Acquirer B", description: "ordered strategy · 2 eligible provider(s)" },
  { type: "provider.selected", title: "NATIO Demo Acquirer A selected", description: "Attempt 1 · account Acquirer A · Test · fee 2.4% + 20" },
  { type: "provider.request_sent", title: "Request sent to provider", description: "NATIO Demo Acquirer A · createPayment" },
  { type: "provider.error", title: "Provider technical error", description: "NATIO Demo Acquirer A · GW-500 Internal gateway error", tone: "bad" },
  { type: "failover.initiated", title: "Fallback initiated", description: "technical error is retryable → next provider NATIO Demo Acquirer B", tone: "warn" },
  { type: "provider.selected", title: "NATIO Demo Acquirer B selected", description: "Attempt 2 · account Acquirer B · Test · fee 2.9% + 30" },
  { type: "provider.request_sent", title: "Request sent to provider", description: "NATIO Demo Acquirer B · createPayment" },
  { type: "payment.successful", title: "Payment successful", description: "NATIO Demo Acquirer B · 83 ms", tone: "ok" },
  { type: "webhook.queued", title: "Webhook queued for merchant", description: "1 endpoint(s) subscribed to payment.successful", tone: "info" },
];

const TONE_DOT = { ok: "bg-lime", bad: "bg-rose-400", warn: "bg-amber-400", info: "bg-aqua" } as const;

export default function OrchestrationPage() {
  return (
    <>
      <PageIntro
        eyebrow="Orchestration"
        title="Every payment runs through the same engine. Every decision is written down."
        lead="The orchestration engine takes a payment from creation to a terminal state: it evaluates risk, selects providers by rule, sends the request, interprets the outcome, retries where it is safe to do so, and emits events. The whole sequence is stored as a timeline you can read from the API and the dashboard."
        actions={
          <>
            <PrimaryCta />
            <SecondaryCta />
          </>
        }
      />

      <Section eyebrow="The engine" title="Four stages inside one request." lead="For synchronous payment methods the full sequence completes within the create request. For asynchronous methods the engine pauses at the provider's customer action and resumes when the provider notifies NATIO.">
        <FeatureGrid cols={4}>
          <Feature index={1} title="Risk evaluation" mono="risk.evaluated">
            Configurable rules on amount, country, currency, method, IP, device, customer email, velocity and failed attempts produce a score and a decision: allow, review or block. Review holds the payment for an operator; block fails it with risk_blocked.
          </Feature>
          <Feature index={2} title="Routing" mono="routing.evaluated">
            The first matching rule (merchant-specific before global, then by priority) selects candidate providers. Candidates are filtered for eligibility and ordered by the rule&apos;s strategy.
          </Feature>
          <Feature index={3} title="Provider attempt" mono="provider.request_sent">
            The adapter for the selected provider account sends the request. Outcomes are normalised: success, requires_action, soft_decline, hard_decline, technical_error, timeout, provider_unavailable.
          </Feature>
          <Feature index={4} title="Retry, failover, events" mono="failover.initiated">
            Retryable outcomes cascade to the next candidate. Terminal outcomes update the state machine, write the transaction, and queue webhooks to your endpoints.
          </Feature>
        </FeatureGrid>
      </Section>

      <Section id="failover" tone="raised" eyebrow="Retry and failover" title="Retries only when it is safe. Never a second charge." lead="Whether NATIO retries depends on the failure category reported by the provider, and on what the provider says actually happened.">
        <Split
          panel={
            <Panel title="Failure categories">
              <SpecList
                className="border-y-0"
                items={[
                  { term: <Chip tone="warn">soft</Chip>, detail: "Insufficient funds, do-not-honor, issuer unavailable, try again later, limits. May cascade to another eligible provider." },
                  { term: <Chip tone="bad">hard</Chip>, detail: "Stolen, lost, expired or invalid card, fraud suspected, authentication failed, cancelled by customer. Never retried." },
                  { term: <Chip tone="muted">technical</Chip>, detail: "Technical error, timeout, provider unavailable, configuration error. Fails over to the next provider after verification." },
                  { term: <Chip>policy</Chip>, detail: "No route available, unsupported currency or method, risk blocked, amount out of limits, attempts exhausted. Terminal." },
                ]}
              />
            </Panel>
          }
        >
          <SpecList
            items={[
              { term: "Double-charge protection", detail: "After a timeout NATIO looks the attempt up at the provider before doing anything else. If the provider confirms the charge, the payment is recovered as successful; only a confirmed absence of a charge allows a failover." },
              { term: "Unknown outcomes", detail: "If the provider cannot answer, the attempt is marked unknown and a status sync is scheduled. The payment does not fail over blind." },
              { term: "Attempts are recorded", detail: "Each attempt carries provider, account, outcome, provider code and message, fee and latency. They are returned on the payment object and shown in the dashboard." },
              { term: "Sandbox scenarios", detail: "test_scenario values such as failover, timeout, timeout_recovered, unavailable and all_fail reproduce each path against the demo providers." },
            ]}
          />
          <div className="mt-6">
            <Link href="/docs/sandbox" className="text-[13px] font-medium text-iris hover:underline">
              Sandbox scenarios →
            </Link>
          </div>
        </Split>
      </Section>

      <Section id="state-machine" eyebrow="State machine" title="Strict states, guarded transitions." lead="Payments, refunds and payouts move through explicit states. Transitions are validated in code and guarded at the database level, so concurrent writers cannot produce an invalid path.">
        <div className="overflow-x-auto rounded-lg border border-night-700">
          <table className="data-table data-table-dark">
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
                <th>Allowed next states</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map((s) => (
                <tr key={s.status}>
                  <td>
                    <StatusBadge variant="dark" status={s.status} label={s.status} />
                  </td>
                  <td className="!whitespace-normal">{s.meaning}</td>
                  <td className="font-mono text-[12px] text-mist-400">{s.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-mist-400">
          Refunds: created → processing → successful | failed. Payouts: created → pending → processing → successful | failed, cancellable while created or pending. An invalid transition returns <code className="font-mono text-[12px]">409 invalid_state_transition</code>.
        </p>
      </Section>

      <Section id="timeline" tone="raised" eyebrow="Transaction timeline" title="What a failover looks like from the outside." lead="The timeline is the human-readable record of the engine. This is the sequence produced by a card payment in the sandbox with test_scenario: failover, exactly as returned by GET /v1/payments/{id}/timeline.">
        <Panel padded={false}>
          <ol className="divide-y divide-night-700">
            {TIMELINE.map((e, i) => (
              <li key={i} className="grid grid-cols-[20px_1fr] gap-3 px-5 py-3.5 sm:grid-cols-[20px_1fr_220px] sm:px-6">
                <span className="flex items-start pt-[6px]">
                  <span className={`h-2 w-2 rounded-full ${e.tone ? TONE_DOT[e.tone] : "bg-night-500"}`} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-mist-50">{e.title}</div>
                  <div className="mt-0.5 text-[12.5px] text-mist-400">{e.description}</div>
                </div>
                <div className="col-start-2 font-mono text-[11px] text-mist-400 sm:col-start-3 sm:text-right">{e.type}</div>
              </li>
            ))}
          </ol>
        </Panel>
      </Section>

      <Section id="risk" eyebrow="Risk rules" title="A first line of defence, before routing." lead="The risk layer scores each payment with your rules before a provider is chosen. It is deliberately simple and transparent; it complements, rather than replaces, a dedicated fraud platform.">
        <FeatureGrid cols={3}>
          <Feature index={1} title="Signals">
            country, amount, currency, payment_method, ip, device_fingerprint, customer_email, velocity_1h, velocity_24h, failed_attempts_24h, amount_24h.
          </Feature>
          <Feature index={2} title="Decisions">
            Each matched rule adds to the score and proposes an action. The strongest action wins: allow, review or block. Decision id and score are returned in the payment&apos;s risk object.
          </Feature>
          <Feature index={3} title="Manual review">
            Payments under review wait in the dashboard. An operator&apos;s approve or reject is recorded on the timeline and in the audit log, then orchestration resumes or the payment fails.
          </Feature>
        </FeatureGrid>
      </Section>

      <CtaBand title="See the engine on your own traffic." lead="Create a sandbox account, send payments with test scenarios and read the timeline for each of them." />
    </>
  );
}
