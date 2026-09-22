import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/ui";
import { FlowDiagram } from "@/components/marketing/flow-diagram";
import { Accent, Chip, Container, CtaBand, Eyebrow, Feature, FeatureGrid, GridBackdrop, MetricRow, Panel, PrimaryCta, SecondaryCta, Section, Split } from "@/components/marketing/sections";
import { RoutingVisual } from "@/components/marketing/routing-visual";

export const metadata: Metadata = {
  title: { absolute: "NATIO — Payments. Orchestrated." },
  description: "One API. Multiple payment rails. Intelligent routing. Connect once and route payments across providers, countries and payment methods through one infrastructure layer.",
};

const CREATE_REQUEST = `curl https://api.natio.me/v1/payments \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "payment_method": "card",
    "country": "US",
    "reference": "ORD-1001"
  }'`;

const CREATE_RESPONSE = `{
  "id": "pay_7Kq2mN9xR4vL8wP1tY3z",
  "object": "payment",
  "status": "successful",
  "amount": 10000,
  "currency": "USD",
  "route": {
    "provider": { "code": "demo_acquirer_b", "name": "NATIO Demo Acquirer B" },
    "attempts": 2,
    "rule": "Cards → Acquirer A, fallback Acquirer B"
  },
  "next_action": null
}`;

const SECURITY = [
  { title: "Encryption at rest and in transit", body: "Provider credentials and webhook secrets are encrypted with AES-256-GCM; all traffic is TLS." },
  { title: "Key hashing", body: "API keys are stored as SHA-256 hashes and shown once. Prefixes identify keys without exposing them." },
  { title: "Role-based access control", body: "Merchant users and operators act under explicit permissions; every action is attributable." },
  { title: "Audit logs", body: "Configuration changes, manual reviews, refunds and resends are written to an immutable audit trail." },
  { title: "Signed webhooks", body: "Every event carries a Natio-Signature header (HMAC-SHA256 with timestamp) so you can verify origin and freshness." },
  { title: "PCI scope minimisation", body: "Card data never touches NATIO. Hosted pages and tokenisation are performed by PCI-compliant providers." },
  { title: "Idempotency", body: "Idempotency-Key on every mutating request: retries replay the original response instead of creating duplicates." },
  { title: "No custody", body: "NATIO does not hold or take customer funds. Providers settle directly with the merchant." },
];

const CLIENTS = [
  { title: "Fintech companies", body: "Embed payments and payouts behind your own product without maintaining a provider integration per market." },
  { title: "Marketplaces & platforms", body: "Collect from buyers across rails and pay out to sellers through licensed providers, with one ledger view." },
  { title: "E-commerce", body: "Cards, wallets, bank transfers and local methods under one checkout contract, with automatic failover." },
  { title: "Subscription businesses", body: "Stored payment method references, manual capture and retry logic for recurring charges." },
  { title: "Travel", body: "High-value, multi-currency transactions where routing by amount, currency and provider limits matters." },
  { title: "Digital services", body: "Fast integration, deterministic routing and full visibility of every attempt for support teams." },
  { title: "International merchants", body: "Add countries and payment methods by configuration rather than by new integrations." },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-night-700 bg-night-950">
        <GridBackdrop />
        {/* one soft light source behind the engine, nothing else */}
        <div aria-hidden className="pointer-events-none absolute right-[-10%] top-[-20%] h-[560px] w-[560px] rounded-full bg-iris/10 blur-[130px]" />
        <Container className="relative py-16 md:py-24">
          <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-center lg:gap-10">
            <div>
              <Eyebrow className="mb-7">Payment orchestration infrastructure</Eyebrow>
              <h1 className="text-[52px] font-medium leading-[0.95] tracking-[-0.038em] text-mist-50 sm:text-[68px] lg:text-[82px]">
                Payments.
                <br />
                <Accent>Orchestrated.</Accent>
              </h1>
              <p className="mt-8 max-w-[520px] text-[17px] leading-[1.7] text-mist-400 md:text-[18px]">
                Connect once. Route payments across providers, countries and payment methods through one infrastructure layer — with
                failover, reconciliation and a decision trail for every transaction.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <PrimaryCta size="lg" />
                <SecondaryCta size="lg" />
              </div>
            </div>
            <RoutingVisual className="hidden lg:block" />
          </div>
        </Container>
        <MetricRow
          items={[
            { value: "1", label: "REST API, one contract" },
            { value: "7", label: "Payment method types", tone: "iris" },
            { value: "0", label: "Merchant funds held", tone: "lime" },
            { value: "100%", label: "Decisions recorded", tone: "aqua" },
          ]}
          className="border-b-0"
        />
      </section>

      {/* Flow diagram */}
      <Section tone="raised" eyebrow="How it works" title="One infrastructure layer between your platform and the payment providers." lead="Your systems talk to NATIO. NATIO talks to acquirers, banks, PSPs and local payment methods, decides where each payment goes, retries safely when a provider fails, and reports what happened.">
        <FlowDiagram />
      </Section>

      {/* One integration */}
      <Section id="integration" eyebrow="One integration" title="Create a payment. NATIO does the rest." lead="A single request carries amount, currency and payment method. Risk evaluation, routing, provider calls and failover happen inside the request; the response tells you the outcome and the route taken.">
        <Split
          panel={
            <div className="space-y-3">
              <Panel padded={false} title="Request">
                <CodeBlock variant="dark" className="!rounded-none !border-0" code={CREATE_REQUEST} language="bash" />
              </Panel>
              <Panel padded={false} title="Response · 201 Created">
                <CodeBlock variant="dark" className="!rounded-none !border-0" code={CREATE_RESPONSE} language="json" />
              </Panel>
            </div>
          }
        >
          <FeatureGrid cols={2}>
            <Feature index={1} title="Amounts in minor units">
              Integers only: <code className="font-mono text-[12.5px] text-mist-50">10000</code> is 100.00 USD. No floating point, no ambiguity across currencies.
            </Feature>
            <Feature index={2} title="Payment method as a type or a token">
              Send <code className="font-mono text-[12.5px] text-mist-50">&quot;card&quot;</code>, or a stored payment method reference issued by a PCI-compliant provider. NATIO never receives card numbers.
            </Feature>
            <Feature index={3} title="Route object on every payment">
              Which provider processed the payment, how many attempts it took and which routing rule matched.
            </Feature>
            <Feature index={4} title="next_action for asynchronous rails">
              Redirects and QR codes are returned as a structured <code className="font-mono text-[12.5px] text-mist-50">next_action</code>; completion arrives by webhook.
            </Feature>
          </FeatureGrid>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/docs/quickstart" className="text-[13px] font-medium text-iris hover:underline">
              Read the quickstart →
            </Link>
            <Link href="/docs/api-reference" className="text-[13px] font-medium text-iris hover:underline">
              API reference →
            </Link>
          </div>
        </Split>
      </Section>

      {/* Orchestration */}
      <Section id="orchestration" tone="raised" eyebrow="Orchestration" title="Rules decide. Failover protects. The timeline explains." lead="The orchestration engine turns provider connectivity into a policy you control: where a payment goes, what happens when a provider declines or fails, and a complete record of every decision.">
        <FeatureGrid cols={3}>
          <Feature index={1} title="Routing rules">
            Conditions on country, currency, payment method, amount, risk score, transaction type and time select the eligible providers. Strategies: ordered, weighted or score-based.
          </Feature>
          <Feature index={2} title="Retry and failover">
            Soft declines and technical failures cascade to the next eligible provider. Hard declines stop. Timeouts are verified against the provider before any retry, so a customer is never charged twice.
          </Feature>
          <Feature index={3} title="Transaction timeline">
            Every payment carries an ordered narrative: risk evaluated, rule matched, provider selected, request sent, error, fallback, success, webhook queued.
          </Feature>
        </FeatureGrid>
        <div className="mt-10">
          <Link href="/orchestration" className="text-[13px] font-medium text-iris hover:underline">
            How the engine works →
          </Link>
        </div>
      </Section>

      {/* Operations */}
      <Section id="operations" eyebrow="Operations" title="Built for the teams who run payments every day." lead="Engineering integrates once. Finance and operations get a single place to monitor transactions, reconcile provider reports, follow settlements and compare providers.">
        <FeatureGrid cols={4}>
          <Feature index={1} title="Transaction monitor">
            Payments, refunds and payouts across all providers with status, route, attempts, fees and failure codes. Filter by provider, method, country, currency or reference.
          </Feature>
          <Feature index={2} title="Reconciliation">
            Import provider reports and match them against NATIO records: MATCHED, MISSING_PROVIDER, MISSING_NATIO, AMOUNT_MISMATCH, STATUS_MISMATCH.
          </Feature>
          <Feature index={3} title="Settlement visibility">
            Settlement batches reported by providers, with gross, fees, net and the transactions they cover. Funds are settled by the providers, not by NATIO.
          </Feature>
          <Feature index={4} title="Analytics">
            Volume, approval rate, latency and failure breakdowns per provider, method and country to inform routing decisions.
          </Feature>
        </FeatureGrid>
      </Section>

      {/* Infrastructure */}
      <Section id="infrastructure" tone="raised" eyebrow="Built as infrastructure" title="Designed like the systems it connects to." lead="NATIO is a technology layer between merchants and licensed payment providers. It is engineered to be predictable, verifiable and narrow in scope.">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-night-700 bg-night-600 sm:grid-cols-2 lg:grid-cols-4">
          {SECURITY.map((s) => (
            <div key={s.title} className="bg-night-850 p-5">
              <h3 className="text-[14px] font-medium text-mist-50">{s.title}</h3>
              <p className="mt-2 text-[13px] leading-6 text-mist-400">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Target clients */}
      <Section id="teams" eyebrow="Who it is for" title="For teams operating across markets." lead="If your business accepts or sends payments in more than one country, through more than one provider, or via more than one payment method, orchestration replaces a growing set of integrations with one.">
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {CLIENTS.map((c) => (
            <div key={c.title} className="border-t border-night-700 pt-4">
              <h3 className="text-[15px] font-medium text-mist-50">{c.title}</h3>
              <p className="mt-2 text-[14px] leading-6 text-mist-400">{c.body}</p>
            </div>
          ))}
          <div className="border-t border-night-700 pt-4">
            <div className="flex flex-wrap gap-1.5">
              {["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local"].map((m) => (
                <Chip key={m}>{m}</Chip>
              ))}
            </div>
            <p className="mt-3 text-[13px] leading-6 text-mist-400">Supported payment method types. The architecture is prepared for connecting global and local providers behind each of them.</p>
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
