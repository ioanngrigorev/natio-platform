import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/ui";
import { DOCS_NAV } from "@/components/marketing/nav";
import { Chip, CtaBand, Feature, FeatureGrid, PageIntro, Panel, PrimaryCta, SecondaryCta, Section, SpecList, Split } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Developers",
  description: "One REST API, a sandbox with demo providers and scripted test scenarios, natio_sk_test_ and natio_sk_live_ keys, signed webhooks, an OpenAPI specification and documentation from quickstart to error codes.",
};

const CURL = `curl -X POST https://api.natio.me/v1/payments \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "payment_method": "card",
    "country": "US",
    "reference": "ORD-1001",
    "test_scenario": "failover"
  }'`;

const WEBHOOK = `POST /your/endpoint
Natio-Signature: t=1758531242,v1=9c1f...e07
Natio-Event-Id: evt_6Hd2...
Natio-Event-Type: payment.successful
Natio-Delivery-Attempt: 1

{
  "id": "evt_6Hd2...",
  "type": "payment.successful",
  "created_at": "2026-09-22T09:34:02.118Z",
  "data": { "object": "payment", "id": "pay_7Kq2...", "status": "successful" }
}`;

const ENDPOINTS: Array<{ method: string; path: string; detail: string }> = [
  { method: "POST", path: "/v1/payments", detail: "Create a payment; risk, routing and provider attempts run inside the request." },
  { method: "GET", path: "/v1/payments/{id}/timeline", detail: "The ordered narrative of every decision made for that payment." },
  { method: "POST", path: "/v1/payments/{id}/refund", detail: "Full or partial refunds, repeatable up to the captured amount." },
  { method: "POST", path: "/v1/payouts", detail: "Send funds to a tokenised beneficiary through a licensed provider." },
  { method: "GET", path: "/v1/transactions", detail: "Every money movement across providers, filterable and paginated." },
  { method: "GET", path: "/v1/settlements", detail: "Settlement batches as reported by the providers." },
  { method: "POST", path: "/v1/webhooks/test", detail: "Send a test event to your endpoints and inspect the delivery." },
  { method: "GET", path: "/v1/test/scenarios", detail: "The sandbox scenarios available to force a provider outcome." },
];

const SCENARIOS = ["success", "failover", "timeout", "timeout_recovered", "unavailable", "hard_decline", "soft_decline", "all_fail"];

export default function DevelopersPage() {
  return (
    <>
      <PageIntro
        eyebrow="Developers"
        title="One integration, a sandbox that behaves like production, and no surprises."
        lead="NATIO is a REST API with predictable resources, integer amounts, idempotency on every mutating call and typed errors. The sandbox runs the full orchestration engine against demo providers, so routing, failover, timeouts and webhooks can all be exercised before a single live key exists."
        actions={
          <>
            <PrimaryCta>Create a sandbox account</PrimaryCta>
            <SecondaryCta href="/docs">Read the docs</SecondaryCta>
          </>
        }
      />

      <Section eyebrow="First request" title="A payment in one call." lead="Authenticate with a secret key, send an amount in minor units, a currency and a payment method. The response carries the outcome, the route taken and every attempt behind it.">
        <Split
          panel={
            <Panel padded={false} title="Request">
              <CodeBlock variant="dark" className="!rounded-none !border-0" code={CURL} language="bash" />
            </Panel>
          }
        >
          <FeatureGrid cols={2}>
            <Feature index={1} title="Keys" mono="natio_sk_test_ / natio_sk_live_">
              Secret keys are scoped to a project and a mode. Test keys reach demo providers; live keys reach the providers configured for your account. Keys are shown once and stored hashed. Live keys are not being issued yet — the business verification that would gate them is not built.
            </Feature>
            <Feature index={2} title="Idempotency" mono="Idempotency-Key">
              Required in practice on every create: a replayed key returns the original response, so a client retry can never duplicate a payment or a payout.
            </Feature>
            <Feature index={3} title="Errors" mono="code · message · request id">
              Typed error codes with HTTP semantics: 401 unauthorized, 409 invalid_state_transition, 422 validation with a field path, 429 rate limited. Every response carries a request id for support.
            </Feature>
            <Feature index={4} title="Pagination" mono="cursor">
              List endpoints are cursor-paginated and filterable on the fields you actually search by: reference, status, provider, method, country, currency and date range.
            </Feature>
          </FeatureGrid>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/docs/quickstart" className="text-[13px] font-medium text-iris hover:underline">
              Quickstart →
            </Link>
            <Link href="/docs/authentication" className="text-[13px] font-medium text-iris hover:underline">
              Authentication →
            </Link>
            <Link href="/docs/errors" className="text-[13px] font-medium text-iris hover:underline">
              Errors &amp; failure codes →
            </Link>
          </div>
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Surface" title="The endpoints you will actually use." lead="One namespace, versioned. The full specification is published as OpenAPI and rendered in the API reference.">
        <div className="overflow-x-auto rounded-lg border border-night-700">
          <table className="data-table data-table-dark">
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={`${e.method} ${e.path}`}>
                  <td className="font-mono text-[12px] font-medium text-mist-50">{e.method}</td>
                  <td className="font-mono text-[12px] text-mist-200">{e.path}</td>
                  <td className="!whitespace-normal text-mist-400">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 flex flex-wrap gap-4">
          <Link href="/docs/api-reference" className="text-[13px] font-medium text-iris hover:underline">
            Full API reference →
          </Link>
          <Link href="/docs/sdks" className="text-[13px] font-medium text-iris hover:underline">
            SDKs &amp; clients →
          </Link>
        </div>
      </Section>

      <Section eyebrow="Sandbox" title="Demo providers that fail the way real ones do." lead="Every test key runs against NATIO demo providers driven by the same adapter interface as a real integration. Pass a test_scenario to force the path you need to build for.">
        <div className="mb-8 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
        <FeatureGrid cols={3}>
          <Feature index={1} title="Real orchestration">
            Risk evaluation, rule matching, provider selection, retries and webhooks all run in test mode. The only difference is which providers answer.
          </Feature>
          <Feature index={2} title="Failure paths on demand">
            Reproduce a fallback to a second provider, a timeout that turns out to have been charged, an outage or a total failure — deterministically, in a test suite.
          </Feature>
          <Feature index={3} title="Test and live are separate">
            Data, keys, webhook endpoints and provider accounts are isolated per mode. Switching mode in the dashboard changes what you see, never what exists.
          </Feature>
        </FeatureGrid>
        <div className="mt-8">
          <Link href="/docs/sandbox" className="text-[13px] font-medium text-iris hover:underline">
            Sandbox &amp; test scenarios →
          </Link>
        </div>
      </Section>

      <Section tone="raised" eyebrow="Webhooks" title="Signed events, retried, and logged." lead="Asynchronous outcomes arrive as events at your endpoints. Every delivery is signed, every attempt is recorded, and any delivery can be resent from the dashboard.">
        <Split
          panel={
            <Panel padded={false} title="Delivery">
              <CodeBlock variant="dark" className="!rounded-none !border-0" code={WEBHOOK} language="http" />
            </Panel>
          }
        >
          <SpecList
            items={[
              { term: "Signature", detail: "Natio-Signature carries a timestamp and an HMAC-SHA256 of timestamp.body computed with your endpoint secret. Verify both the digest and the freshness of the timestamp." },
              { term: "Events", detail: "payment.created, payment.processing, payment.authorized, payment.successful, payment.failed, payment.cancelled, payment.refunded, refund.successful, refund.failed, payout.created, payout.successful, payout.failed, settlement.created." },
              { term: "Retries", detail: "Non-2xx responses are retried with backoff — 30s, 2m, 10m, 30m, then 2h — up to the endpoint's attempt limit, after which the delivery is marked exhausted." },
              { term: "Observability", detail: "Request headers, response status, body excerpt and latency are stored per attempt and visible in the dashboard, with manual resend." },
              { term: "Testing", detail: "POST /v1/webhooks/test sends a synthetic event to your active endpoints so you can verify signatures before real traffic." },
            ]}
          />
          <div className="mt-6">
            <Link href="/docs/webhooks" className="text-[13px] font-medium text-iris hover:underline">
              Webhook guide →
            </Link>
          </div>
        </Split>
      </Section>

      <Section eyebrow="Documentation" title="Everything, in one place." lead="Guides for the paths you implement, a reference for the shapes you send, and an OpenAPI specification you can generate a client from.">
        <div className="grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-3">
          {DOCS_NAV.map((section) => (
            <div key={section.section} className="border-t border-night-700 pt-4">
              <h3 className="text-[15px] font-medium text-mist-50">{section.section}</h3>
              <ul className="mt-3 space-y-2">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-[13.5px] text-mist-200 hover:text-iris hover:underline">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 border-t border-night-700 pt-7">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h3 className="text-[18px] font-medium tracking-[-0.014em] text-mist-50">OpenAPI specification</h3>
              <p className="mt-2.5 max-w-[640px] text-[15px] leading-[1.7] text-mist-400">
                The API is described by an OpenAPI document covering every endpoint, request body, response shape and error. Use it to generate a typed client in your own language, or to drive contract tests against the sandbox.
              </p>
            </div>
            <SecondaryCta href="/docs/api-reference">Open the reference</SecondaryCta>
          </div>
        </div>
      </Section>

      <CtaBand title="Start in the sandbox." lead="Register, create a test key, send your first payment and read its timeline. No live provider contract is needed to evaluate the platform." />
    </>
  );
}
