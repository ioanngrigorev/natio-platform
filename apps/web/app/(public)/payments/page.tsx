import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, StatusBadge } from "@/components/ui";
import { Chip, CtaBand, Feature, FeatureGrid, PageIntro, Panel, PrimaryCta, SecondaryCta, Section, SpecList, Split } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Payments",
  description: "One REST API for accepting payments across cards, bank transfers, QR, open banking, wallets, instant rails and local methods, with a strict lifecycle, capture, cancel and refund, idempotency and a per-attempt route record.",
};

const METHODS: Array<{ code: string; title: string; body: string }> = [
  { code: "card", title: "Cards", body: "Domestic and international card payments through the acquirers and PSPs connected to your account. Card entry happens on a provider hosted page or is tokenised by a PCI-compliant provider." },
  { code: "bank_transfer", title: "Bank transfer", body: "Push and pull bank transfers where the provider confirms the credit asynchronously. The payment stays processing until the provider notifies NATIO." },
  { code: "qr", title: "QR", body: "QR-based rails: the provider returns a payload and an expiry, which NATIO passes back as a structured next_action for you to render." },
  { code: "open_banking", title: "Open banking", body: "Account-to-account initiation where the customer authorises the payment at their bank. Returned as a redirect next_action." },
  { code: "wallet", title: "Wallets", body: "Wallet balances and wallet-backed rails, typically synchronous: the create response already carries the final status." },
  { code: "instant", title: "Instant rails", body: "Domestic instant payment schemes with near-real-time confirmation from the provider." },
  { code: "local", title: "Local methods", body: "Country-specific methods exposed under one contract. Adding a new one is configuration on the provider side, not a new integration on yours." },
];

const STATUSES: Array<{ status: string; body: string }> = [
  { status: "created", body: "Accepted and persisted. Risk and routing have not produced a provider attempt yet." },
  { status: "pending", body: "Waiting on something outside the request: a manual risk review, or a customer action at the provider." },
  { status: "processing", body: "A provider attempt is in flight, or an asynchronous confirmation is outstanding." },
  { status: "authorized", body: "Funds reserved by the provider. Reached only with capture_method: manual; capture or cancel next." },
  { status: "captured", body: "Transitional state while a capture is being confirmed by the provider." },
  { status: "successful", body: "The provider confirmed the payment. Refundable in full or in part." },
  { status: "failed", body: "Declined, blocked by risk, or every eligible provider failed. Carries a failure object with code, category and message." },
  { status: "cancelled", body: "Cancelled before completion. Terminal." },
  { status: "refunded", body: "Refunds cover the full captured amount. Terminal." },
  { status: "partially_refunded", body: "One or more refunds cover part of the captured amount. Further refunds are allowed up to the remainder." },
];

const CREATE_REQUEST = `curl -X POST https://api.natio.me/v1/payments \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "payment_method": "card",
    "country": "US",
    "reference": "ORD-1001",
    "customer": { "external_id": "cus_42", "email": "jane@example.com" },
    "capture_method": "automatic"
  }'`;

const CREATE_RESPONSE = `{
  "id": "pay_7Kq2mN9xR4vL8wP1tY3z",
  "object": "payment",
  "mode": "test",
  "status": "successful",
  "amount": 10000,
  "currency": "USD",
  "captured_amount": 10000,
  "refunded_amount": 0,
  "capture_method": "automatic",
  "payment_method": { "type": "card", "id": null },
  "country": "US",
  "reference": "ORD-1001",
  "route": {
    "provider": { "code": "demo_acquirer_b", "name": "NATIO Demo Acquirer B" },
    "provider_payment_id": "dmb_9f21c4",
    "attempts": 2,
    "rule": "Cards → Acquirer A, fallback Acquirer B"
  },
  "risk": { "decision_id": "rsk_3Jv...", "score": 0 },
  "failure": null,
  "next_action": null,
  "fee": { "amount": 320, "currency": "USD" },
  "processing_time_ms": 83,
  "attempts": [
    {
      "attempt_number": 1,
      "status": "failed",
      "outcome": "technical_error",
      "provider_name": "NATIO Demo Acquirer A",
      "provider_code": "GW-500",
      "latency_ms": 41
    },
    {
      "attempt_number": 2,
      "status": "succeeded",
      "outcome": "success",
      "provider_name": "NATIO Demo Acquirer B",
      "provider_payment_id": "dmb_9f21c4",
      "latency_ms": 42
    }
  ]
}`;

const NEXT_ACTION = `{
  "status": "processing",
  "next_action": {
    "type": "qr_code",
    "qrPayload": "00020101021238...",
    "expiresAt": "2026-09-22T10:45:00.000Z"
  }
}`;

export default function PaymentsPage() {
  return (
    <>
      <PageIntro
        eyebrow="Payments"
        title="One request shape for every rail you accept."
        lead="Create a payment with an amount, a currency and a payment method. NATIO evaluates risk, picks a provider, sends the request and returns the outcome together with the route it took. What changes between cards, bank transfers, QR and local methods is configuration, not your integration."
        actions={
          <>
            <PrimaryCta />
            <SecondaryCta href="/docs/payments">Read the guide</SecondaryCta>
          </>
        }
      />

      <Section eyebrow="Create a payment" title="Amounts in minor units. Idempotency on every mutating call." lead="For synchronous methods the create response already carries the final status. For asynchronous methods it carries processing and a next_action for the customer.">
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
            <Feature index={1} title="Minor units only" mono="amount">
              Integers, never decimals: <code className="font-mono text-[12.5px] text-mist-50">10000</code> is 100.00 USD. The same rule applies to captures, refunds, fees and payouts.
            </Feature>
            <Feature index={2} title="Method as a type or a token" mono="payment_method">
              Send a type such as <code className="font-mono text-[12.5px] text-mist-50">&quot;card&quot;</code>, or an object with a provider token or a stored payment method id. Raw card numbers are never accepted.
            </Feature>
            <Feature index={3} title="Idempotency" mono="Idempotency-Key">
              Send a key on every create, capture, cancel and refund. A replayed key returns the original response instead of creating a second payment.
            </Feature>
            <Feature index={4} title="Route on every payment" mono="route">
              Which provider processed it, the provider&apos;s own id for the payment, how many attempts it took and which routing rule matched.
            </Feature>
          </FeatureGrid>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/docs/quickstart" className="text-[13px] font-medium text-iris hover:underline">
              Quickstart →
            </Link>
            <Link href="/docs/api-reference" className="text-[13px] font-medium text-iris hover:underline">
              API reference →
            </Link>
          </div>
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Payment methods" title="Seven method types behind one contract." lead="Which providers can serve a given type, currency and country is provider configuration. Your request does not change when a market is added.">
        <div className="mb-8 flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <Chip key={m.code}>{m.code}</Chip>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {METHODS.map((m) => (
            <div key={m.code} className="border-t border-night-700 pt-4">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-400">{m.code}</div>
              <h3 className="mt-2 text-[15px] font-medium text-mist-50">{m.title}</h3>
              <p className="mt-2 text-[14px] leading-6 text-mist-400">{m.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Lifecycle" title="Ten statuses, guarded transitions." lead="Every payment moves through an explicit state machine. Transitions are validated in code and guarded in the database, so retries and concurrent webhooks cannot produce an invalid path.">
        <div className="overflow-x-auto rounded-lg border border-night-700">
          <table className="data-table data-table-dark">
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map((s) => (
                <tr key={s.status}>
                  <td>
                    <StatusBadge variant="dark" status={s.status} label={s.status} />
                  </td>
                  <td className="!whitespace-normal">{s.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-mist-400">
          An invalid transition returns <code className="font-mono text-[12px]">409 invalid_state_transition</code>. Refunds have their own lifecycle: created → processing → successful or failed.
        </p>
      </Section>

      <Section tone="raised" eyebrow="Operations on a payment" title="Capture, cancel, refund." lead="The same three operations exist for every provider, normalised by the adapter layer.">
        <FeatureGrid cols={3}>
          <Feature index={1} title="Capture" mono="POST /v1/payments/{id}/capture">
            With <code className="font-mono text-[12.5px] text-mist-50">capture_method: manual</code> the payment stops at authorized. Capture the full amount or less; the remainder is released by the provider.
          </Feature>
          <Feature index={2} title="Cancel" mono="POST /v1/payments/{id}/cancel">
            Cancels a payment that has not completed, or voids an authorisation that has not been captured. Terminal once accepted.
          </Feature>
          <Feature index={3} title="Refund" mono="POST /v1/payments/{id}/refund">
            Full or partial, repeatedly, up to the captured amount. The payment moves to partially_refunded and then refunded; each refund is its own object with its own status.
          </Feature>
        </FeatureGrid>
      </Section>

      <Section eyebrow="Customer action" title="Redirects and QR codes come back as data." lead="Asynchronous rails need the customer to do something. NATIO returns that as a structured next_action rather than an HTML page, so you decide how to present it.">
        <Split
          panel={
            <Panel padded={false} title="Response · asynchronous rail">
              <CodeBlock variant="dark" className="!rounded-none !border-0" code={NEXT_ACTION} language="json" />
            </Panel>
          }
        >
          <SpecList
            items={[
              { term: "redirect", detail: "A url to send the customer to, typically a provider hosted page or a bank authorisation screen. You provide return_url on create." },
              { term: "qr_code", detail: "A payload to render as a QR code, with an expiry timestamp." },
              { term: "display_details", detail: "Instructions to show the customer, such as transfer details for a manual bank payment." },
              { term: "Completion", detail: "The payment stays processing until the provider confirms. NATIO then updates the state machine and delivers a signed webhook (payment.successful or payment.failed)." },
            ]}
          />
          <div className="mt-6">
            <Link href="/docs/webhooks" className="text-[13px] font-medium text-iris hover:underline">
              Webhook events and signatures →
            </Link>
          </div>
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Card data" title="Hosted pages and tokenisation keep you out of scope." lead="Card data never touches NATIO. Entry happens on a hosted page operated by a PCI-compliant provider, or is tokenised by that provider in the browser.">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <h3 className="text-[14px] font-medium text-mist-50">What NATIO stores</h3>
            <SpecList
              className="mt-3"
              items={[
                { term: "Token references", detail: "Provider-issued tokens and stored payment method ids, usable only by the provider that issued them." },
                { term: "Display metadata", detail: "Brand, last four digits and expiry where the provider returns them, for support and reconciliation." },
                { term: "Nothing else", detail: "No PAN, no CVV, no magnetic stripe data. The API rejects requests that look like raw card numbers." },
              ]}
            />
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-mist-50">What that means for you</h3>
            <SpecList
              className="mt-3"
              items={[
                { term: "SAQ-A scope", detail: "Redirecting to a hosted page or using provider tokenisation keeps a merchant integration in the smallest PCI scope. Your own obligations depend on your implementation and your assessor." },
                { term: "Provider-side compliance", detail: "Card acceptance, PCI DSS attestation and acquiring are the responsibility of the licensed providers connected to the platform." },
                { term: "No custody", detail: "NATIO does not hold or take customer funds. Money moves between you and the licensed providers, which settle directly." },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section eyebrow="Visibility" title="Every attempt is on the record." lead="A payment is not a single provider call. NATIO stores each attempt and the reasoning around it, and exposes both through the API and the dashboard.">
        <FeatureGrid cols={4}>
          <Feature index={1} title="Attempts array">
            Provider, account, outcome, provider code and message, fee and latency for every attempt, in order.
          </Feature>
          <Feature index={2} title="Timeline" mono="GET /v1/payments/{id}/timeline">
            The human-readable narrative: risk evaluated, rule matched, provider selected, request sent, error, fallback, success, webhook queued.
          </Feature>
          <Feature index={3} title="Transactions">
            Every movement — payment, refund, payout — written as a transaction row with the provider reference used for reconciliation.
          </Feature>
          <Feature index={4} title="Webhooks">
            payment.created, payment.processing, payment.authorized, payment.successful, payment.failed, payment.cancelled, payment.refunded, signed with HMAC-SHA256.
          </Feature>
        </FeatureGrid>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/orchestration" className="text-[13px] font-medium text-iris hover:underline">
            How the engine decides →
          </Link>
          <Link href="/routing" className="text-[13px] font-medium text-iris hover:underline">
            Routing rules →
          </Link>
        </div>
      </Section>

      <CtaBand title="Send your first test payment." lead="Create a sandbox account, take a test key and run the full orchestration flow against demo providers — including failover, timeouts and refunds." />
    </>
  );
}
