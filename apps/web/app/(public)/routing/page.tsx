import type { Metadata } from "next";
import Link from "next/link";
import { Chip, CtaBand, Eyebrow, Feature, FeatureGrid, PageIntro, Panel, PrimaryCta, SecondaryCta, Section, SpecList, Split } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Routing",
  description: "Deterministic, rule-based payment routing: conditions on country, currency, method, amount, risk and time; ordered, weighted and score-based strategies; transparent scoring; and failover with double-charge protection.",
};

const FIELDS: Array<{ field: string; detail: string }> = [
  { field: "country", detail: "Country of the payment, as sent on the request." },
  { field: "customer_country", detail: "Country attached to the customer object, where you provide one." },
  { field: "currency", detail: "ISO 4217 currency of the payment or payout." },
  { field: "merchant_id", detail: "Scopes a rule to one merchant account." },
  { field: "project_id", detail: "Scopes a rule to one project, for example a single storefront or app." },
  { field: "payment_method", detail: "card, bank_transfer, qr, open_banking, wallet, instant or local." },
  { field: "amount", detail: "Amount in minor units. Typical use: send high-value traffic to a provider with the right limits." },
  { field: "transaction_type", detail: "payment or payout. A payout rule never applies to a payment." },
  { field: "risk_score", detail: "The score produced by the risk layer before routing runs." },
  { field: "hour_of_day", detail: "UTC hour, 0–23. Used to avoid a provider's maintenance window." },
  { field: "day_of_week", detail: "UTC day, 0 (Sunday) to 6. Used for weekend banking coverage." },
];

const OPERATORS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between"];

const STRATEGIES: Array<{ name: string; title: string; body: string }> = [
  { name: "ordered", title: "Ordered", body: "The rule lists provider accounts in priority order. The first eligible one is tried, the next is the fallback. Fully predictable — the default for most rules." },
  { name: "weighted", title: "Weighted", body: "Traffic is split across providers by weight, using a deterministic draw seeded by the payment id. The same payment always produces the same order, so retries and replays are reproducible." },
  { name: "score", title: "Score", body: "Candidates are ranked by a transparent scoring function over cost, approval probability, uptime and latency. The architecture is prepared for an ML-based ranker later: same inputs, same output shape." },
];

const FACTORS: Array<{ term: string; detail: string }> = [
  { term: "Approval probability", detail: "The share of recent attempts on that provider account that ended successfully, for comparable traffic. Below a minimum sample size a neutral default is used instead of a noisy rate." },
  { term: "Processing cost", detail: "The account's percentage and fixed fee, expressed in basis points of the payment amount so that fixed fees are comparable across ticket sizes." },
  { term: "Provider uptime", detail: "The inverse of the share of technical failures on that account over the recent window." },
  { term: "Latency", detail: "Average provider response time over the same window." },
  { term: "Limits and capabilities", detail: "Not scored but filtered: method, currency and country support, account status and mode, and configured minimum and maximum amounts." },
];

const OUTCOMES: Array<{ outcome: string; tone: "warn" | "bad" | "muted" | "neutral"; retry: string; detail: string }> = [
  { outcome: "hard decline", tone: "bad", retry: "Never retried", detail: "Stolen, lost, expired or invalid instrument, fraud suspected, authentication failed, cancelled by the customer. Another provider would decline the same way; the payment fails immediately." },
  { outcome: "soft decline", tone: "warn", retry: "May cascade", detail: "Insufficient funds, do-not-honor, issuer unavailable, try again later, limit exceeded. Retried on the next eligible provider when the project's retry policy allows it." },
  { outcome: "technical error", tone: "muted", retry: "Fails over", detail: "The provider returned an error that is not a decision about the payment: gateway errors, malformed responses, authentication problems on the connection." },
  { outcome: "timeout", tone: "muted", retry: "Verified, then fails over", detail: "No answer within the adapter's deadline. NATIO does not assume anything; it asks the provider what happened before doing anything else." },
  { outcome: "provider unavailable", tone: "muted", retry: "Fails over", detail: "The provider or the account is down, disabled or rejecting traffic. The next eligible candidate is tried." },
];

export default function RoutingPage() {
  return (
    <>
      <PageIntro
        eyebrow="Routing"
        title="Where a payment goes is a policy, not a guess."
        lead="Routing rules decide which provider sees each payment, in which order, and what happens when one of them fails. The rules are explicit, evaluated in priority order, and recorded on the payment — you can always answer the question why did this payment go there."
        actions={
          <>
            <PrimaryCta />
            <SecondaryCta href="/orchestration">See the engine</SecondaryCta>
          </>
        }
      />

      <Section eyebrow="Anatomy of a rule" title="Scope, conditions, providers, strategy." lead="A rule applies to a transaction type and a mode, optionally to one merchant or project, and matches when every one of its conditions is true. Rules are evaluated by scope then priority; the first match wins.">
        <Split
          panel={
            <Panel padded={false} title="Operators">
              <div className="flex flex-wrap gap-2 px-5 py-5">
                {OPERATORS.map((op) => (
                  <Chip key={op}>{op}</Chip>
                ))}
              </div>
              <div className="border-t border-night-700 px-5 py-4 text-[13px] leading-[1.7] text-mist-400">
                Values are single values or lists. <span className="font-mono text-[12px] text-mist-50">between</span> takes two bounds, <span className="font-mono text-[12px] text-mist-50">in</span> and <span className="font-mono text-[12px] text-mist-50">not_in</span> take a list. Comparisons on text are case-insensitive; comparisons on amounts are numeric, in minor units.
              </div>
            </Panel>
          }
        >
          <SpecList items={FIELDS.map((f) => ({ term: <span className="font-mono text-[12.5px]">{f.field}</span>, detail: f.detail }))} />
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Example" title="A rule chain reads like the policy it encodes." lead="Rules are written in the order you want them evaluated. Each one names the providers it can use; the strategy decides how those providers are ordered inside the rule.">
        <Panel padded={false}>
          <ol className="divide-y divide-night-700">
            <li className="px-5 py-5 sm:px-6">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-mist-600">01</span>
                <div className="min-w-0">
                  <div className="text-[14px] leading-7 text-mist-50">
                    IF <Chip>country = VN</Chip> AND <Chip>currency = VND</Chip> AND <Chip>payment_method = qr</Chip> → <span className="font-semibold text-mist-50">Provider A</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-6 text-mist-400">A local rail served best by a local provider. Ordered strategy, Provider A first.</p>
                </div>
              </div>
            </li>
            <li className="px-5 py-5 sm:px-6">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-mist-600">02</span>
                <div className="min-w-0">
                  <div className="text-[14px] leading-7 text-mist-50">
                    IF Provider A unavailable → <span className="font-semibold text-mist-50">Provider B</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-6 text-mist-400">Expressed as the fallback inside the same rule: if the first candidate is ineligible or its attempt fails in a retryable way, the next candidate is tried.</p>
                </div>
              </div>
            </li>
            <li className="px-5 py-5 sm:px-6">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-mist-600">03</span>
                <div className="min-w-0">
                  <div className="text-[14px] leading-7 text-mist-50">
                    IF <Chip>amount &gt; X</Chip> → <span className="font-semibold text-mist-50">Provider C</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-6 text-mist-400">High-value traffic to the provider whose limits and settlement terms suit it. Placed at a lower priority number so it is evaluated before the general rules.</p>
                </div>
              </div>
            </li>
          </ol>
        </Panel>
        <p className="mt-4 text-[13px] leading-6 text-mist-400">
          The matched rule, the candidates it produced and the reason each candidate was kept or dropped are stored as the routing decision and shown on the payment timeline as <span className="font-mono text-[12px]">routing.evaluated</span>.
        </p>
      </Section>

      <Section eyebrow="Strategies" title="Three ways to order the candidates." lead="Eligibility is a filter; the strategy is the ordering. Both are recorded, so a route can be reconstructed after the fact.">
        <FeatureGrid cols={3}>
          {STRATEGIES.map((s, i) => (
            <Feature key={s.name} index={i + 1} title={s.title} mono={s.name}>
              {s.body}
            </Feature>
          ))}
        </FeatureGrid>
      </Section>

      <Section id="scoring" tone="raised" eyebrow="Smart routing" title="Scoring you can read, not a black box." lead="The score strategy ranks eligible providers with a small, inspectable function. Every factor is a number NATIO already has from your own traffic, and every score is stored with the routing decision.">
        <Split
          panel={
            <Panel title="Default weighting">
              <SpecList
                className="border-y-0"
                items={[
                  { term: "Approval probability", detail: "Weight 40 — the largest single contributor, because a declined payment costs more than a slightly more expensive approved one." },
                  { term: "Processing cost", detail: "Weight 30 — applied as a penalty in basis points of the amount." },
                  { term: "Provider uptime", detail: "Weight 20 — recent technical reliability of the account." },
                  { term: "Latency", detail: "Weight 10 — a penalty, so a slow provider loses ties." },
                  { term: "Account priority", detail: "Tie-break only, so two otherwise identical candidates order deterministically." },
                ]}
              />
            </Panel>
          }
        >
          <SpecList items={FACTORS.map((f) => ({ term: f.term, detail: f.detail }))} />
          <p className="mt-6 text-[13px] leading-6 text-mist-400">
            The function is deliberately simple: the same inputs always produce the same ranking, and the factors are reported alongside the decision. It is the extension point for a learned ranker later — same inputs, same output shape — rather than a model you would have to trust without evidence.
          </p>
          <div className="mt-6">
            <Link href="/reconciliation" className="text-[13px] font-medium text-iris hover:underline">
              Comparing providers on your own data →
            </Link>
          </div>
        </Split>
      </Section>

      <Section id="failover" eyebrow="Failover" title="What NATIO does when a provider says no." lead="Every provider response is normalised into one of a small set of outcomes. The outcome, not the provider's own wording, decides whether the payment moves on to the next candidate.">
        <div className="overflow-x-auto rounded-lg border border-night-700">
          <table className="data-table data-table-dark">
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Retry behaviour</th>
                <th>What it means</th>
              </tr>
            </thead>
            <tbody>
              {OUTCOMES.map((o) => (
                <tr key={o.outcome}>
                  <td>
                    <Chip tone={o.tone}>{o.outcome}</Chip>
                  </td>
                  <td className="whitespace-nowrap font-medium text-mist-50">{o.retry}</td>
                  <td className="!whitespace-normal">{o.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Panel glow className="mt-10 !p-7 md:!p-9">
          <Eyebrow className="mb-5">Safety rule</Eyebrow>
          <h3 className="text-[22px] font-medium leading-[1.15] tracking-[-0.022em] text-mist-50 md:text-[26px]">After a timeout, NATIO asks the provider before it fails over.</h3>
          <p className="mt-4 max-w-[760px] text-[15px] leading-[1.75] text-mist-400">
            A timeout is not a failure — it is an absence of information. The engine looks the attempt up at the provider and acts on the answer: if the provider confirms a charge, the payment is recovered as successful and no second attempt is made; only a confirmed absence of a charge allows the next provider to be tried. If the provider cannot answer, the attempt is marked unknown, a status sync is scheduled, and the payment does not fail over blind. A customer is never charged twice because NATIO guessed.
          </p>
        </Panel>
        <FeatureGrid cols={3} className="mt-10">
          <Feature index={1} title="Retry policy per project">
            Maximum attempts per payment, retry on soft decline and retry on timeout are project settings, so a merchant can be as conservative as it wants.
          </Feature>
          <Feature index={2} title="Exhaustion is explicit">
            When no eligible candidate remains the payment fails with a policy failure — no route available or attempts exhausted — rather than the last provider&apos;s error code.
          </Feature>
          <Feature index={3} title="Everything is on the timeline">
            provider.error, failover.initiated, provider.selected, payment.successful: the reason for each hop is written down as it happens.
          </Feature>
        </FeatureGrid>
      </Section>

      <CtaBand title="Reproduce every route in the sandbox." lead="Test scenarios force failover, timeouts, recovered timeouts, provider outages and total failure, so you can see the rules and the safety checks behave before they matter." />
    </>
  );
}
