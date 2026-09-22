import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, FactList, H2, LinkCards, Note, Tok } from "@/components/docs/parts";
import { PAYMENT_METHOD_TYPES, SUPPORTED_CURRENCIES } from "@/components/docs/data";

export const metadata: Metadata = {
  title: "Overview",
  description: "What NATIO is, what the API does, the object model behind payments, refunds, payouts, settlements and webhooks, and where to start.",
};

const CREATE = `curl https://api.natio.me/v1/payments \\
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

const OBJECTS: Array<[string, string, string]> = [
  ["payment", "pay_…", "The money movement you asked for: amount, currency, payment method, customer and the status of the whole operation. One payment can be tried at several providers."],
  ["attempt", "att_…", "One call to one provider account for one payment. Carries the provider, the normalised outcome, the provider code and message, the fee and the latency. Returned inline on the payment as attempts[]."],
  ["transaction", "txn_…", "The ledger line produced when money actually moved: a capture, a refund, a payout, a fee. Transactions are what reconciliation matches against the provider report."],
  ["refund", "rf_…", "A return of part or all of a captured payment, processed through the provider that took the payment."],
  ["payout", "po_…", "A payment out to a beneficiary, orchestrated through a provider that supports the destination rail."],
  ["settlement", "stl_…", "A provider settlement record: what a licensed provider settled to the merchant, for which period, with which fees."],
  ["webhook event", "evt_…", "An immutable record of something that happened, delivered to your endpoints and replayable from the dashboard."],
];

export default function DocsOverviewPage() {
  return (
    <>
      <DocHeader
        eyebrow="Documentation"
        title="NATIO developer documentation"
        lead="One REST API for payments, refunds, payouts, transactions and settlements across multiple providers. Connect once, route by rule, and read a single object model no matter which provider processed the money."
      />

      <H2 id="what-natio-is">What NATIO is</H2>
      <p>
        NATIO is a payment orchestration technology layer. It sits between your platform and the licensed payment providers you work with: acquirers, banks, PSPs and local
        payment methods. Your systems speak one contract to NATIO; NATIO speaks each provider dialect, decides where every payment goes, retries safely when a provider fails,
        and reports what happened attempt by attempt.
      </p>
      <p>Three boundaries define the platform and they shape the whole API:</p>
      <ul>
        <li>
          <strong>Funds move between the merchant and licensed providers.</strong> NATIO never holds funds. Balances and settlements in the API describe what providers hold and
          settle, not a NATIO account. <Tok>GET /v1/balances</Tok> returns <Tok>custodian: false</Tok> for exactly this reason.
        </li>
        <li>
          <strong>Card data never reaches NATIO.</strong> You send a payment method type, or a token reference issued by a PCI-compliant provider. Sensitive entry happens on
          provider-hosted pages. <Tok>POST /v1/payment-methods</Tok> rejects anything that looks like a card number.
        </li>
        <li>
          <strong>Every decision is recorded.</strong> Risk evaluation, routing, each provider attempt and each failover are written to the payment timeline, so support and
          finance can answer &ldquo;why did this go there&rdquo; without a provider ticket.
        </li>
      </ul>

      <Note tone="info" title="Regulatory position">
        NATIO is a payment orchestration technology platform. Payment processing and settlement are performed by licensed payment providers connected to the platform.
      </Note>

      <H2 id="what-the-api-does">What the API does</H2>
      <p>
        One request creates a payment. Inside that request NATIO evaluates risk rules, resolves a routing decision into an ordered list of eligible provider accounts, calls the
        first one, and — if the failure is retryable — calls the next. The response carries the final status for synchronous rails, or <Tok>processing</Tok> with a{" "}
        <Tok>next_action</Tok> for rails that need the customer (redirect or QR).
      </p>
      <Code caption="Create a payment" code={CREATE} />
      <p>
        The rest of the API is the same object read back in different shapes: the payment and its attempts, its timeline, its refunds, the ledger transactions it produced, the
        balances and settlements the providers report, and the webhook events that tell you about all of it without polling.
      </p>
      <DocTable
        columns={["Resource", "What you do with it"]}
        rows={[
          [<Tok key="p">/v1/payments</Tok>, "Create, read, list, capture, cancel, refund. The core of the integration."],
          [<Tok key="t">/v1/payments/{"{id}"}/timeline</Tok>, "Every decision and provider interaction for one payment, in order."],
          [<Tok key="r">/v1/refunds/{"{id}"}</Tok>, "Read a refund created against a payment."],
          [<Tok key="po">/v1/payouts</Tok>, "Create, read, list and cancel payouts to beneficiaries."],
          [<Tok key="tx">/v1/transactions</Tok>, "The ledger: one line per movement, with the provider reference used for reconciliation."],
          [<Tok key="b">/v1/balances</Tok>, "What the connected providers hold for the merchant, per currency and provider account."],
          [<Tok key="s">/v1/settlements</Tok>, "Provider settlement records and their line items."],
          [<Tok key="pm">/v1/payment-methods</Tok>, "Store a provider token reference so it can be reused on later payments."],
          [<Tok key="w">/v1/webhooks/test</Tok>, "Send a test event to your configured endpoints while you build the receiver."],
          [<Tok key="sc">/v1/test/scenarios</Tok>, "List the sandbox test scenarios, test keys only."],
        ]}
      />

      <H2 id="object-model">The object model</H2>
      <p>
        A payment is the unit you create; everything else hangs off it. The relationship that matters most is <strong>payment → attempts → transactions</strong>: one payment can
        have several attempts across several providers, but only the attempts that actually moved money produce transactions.
      </p>
      <div className="mb-5 overflow-x-auto rounded-lg border border-night-700 bg-night-900 p-5">
        <div className="min-w-[640px] font-mono text-[11.5px] leading-6 text-mist-200">
          <div>
            payment <span className="text-mist-400">pay_7Kq2…</span> status successful · amount 10000 USD
          </div>
          <div className="text-mist-600">│</div>
          <div>
            ├── attempt 1 <span className="text-rose-300">failed</span> · NATIO Demo Acquirer A · technical_error
          </div>
          <div>
            ├── attempt 2 <span className="text-lime">succeeded</span> · NATIO Demo Acquirer B{" "}
            <span className="text-mist-400">→ transaction txn_… type payment</span>
          </div>
          <div>
            ├── refund <span className="text-mist-400">rf_… → transaction txn_… type refund</span>
          </div>
          <div>
            ├── timeline <span className="text-mist-400">payment.created · risk.evaluated · routing.evaluated · provider.* · failover.initiated · payment.successful</span>
          </div>
          <div>
            └── events <span className="text-mist-400">payment.created · payment.successful → webhook deliveries</span>
          </div>
          <div className="mt-3 text-mist-400">transactions ──→ settlement stl_… (what the provider settled to the merchant)</div>
          <div className="text-mist-400">transactions ──→ reconciliation (matched against the provider report)</div>
        </div>
      </div>
      <DocTable
        columns={["Object", "Id prefix", "What it is"]}
        rows={OBJECTS.map(([name, prefix, description]) => [<strong key={name}>{name}</strong>, <Tok key={prefix}>{prefix}</Tok>, description])}
      />
      <p>
        Payouts are the mirror image: they are created directly rather than derived from a payment, they are routed to a provider that supports the destination rail, and they
        produce their own transactions and settlement lines.
      </p>

      <H2 id="base-urls">Base URLs and conventions</H2>
      <FactList
        items={[
          {
            term: "Production",
            detail: (
              <>
                <Tok>https://api.natio.me</Tok> — requires a live key (<Tok>natio_sk_live_…</Tok>), which is issued after KYB approval.
              </>
            ),
          },
          {
            term: "Local development",
            detail: (
              <>
                <Tok>http://localhost:4000</Tok> — the server list in the{" "}
                <Link href="/docs/api-reference">API reference</Link> is read from the live OpenAPI document.
              </>
            ),
          },
          { term: "Versioning", detail: <>Every resource lives under the <Tok>/v1</Tok> prefix. Breaking changes ship as a new prefix, not as a change to an existing one.</> },
          { term: "Authentication", detail: <><Tok>Authorization: Bearer natio_sk_test_…</Tok> or <Tok>natio_sk_live_…</Tok>. The key determines merchant, project and mode.</> },
          { term: "Mode", detail: <>A key is either test or live. Test keys reach the demo providers only; live keys never accept <Tok>test_scenario</Tok>.</> },
          { term: "Content type", detail: <><Tok>application/json</Tok> on every request with a body. Responses are JSON with a <Tok>x-request-id</Tok> header.</> },
          { term: "Amounts", detail: <>Integers in the minor unit of the currency. <Tok>10000</Tok> with <Tok>USD</Tok> is 100.00 USD.</> },
          { term: "Idempotency", detail: <>Send <Tok>Idempotency-Key</Tok> on every mutating request; replays return the stored response.</> },
          { term: "Pagination", detail: <>Cursor based: <Tok>limit</Tok> (1–200, default 50) and <Tok>cursor</Tok>, with <Tok>next_cursor</Tok> and <Tok>has_more</Tok> on the list.</> },
          { term: "Spec", detail: <><Link href="/openapi.json">OpenAPI 3.1 document</Link>, rendered in the <Link href="/docs/api-reference">API reference</Link>.</> },
        ]}
      />
      <p>
        Supported payment method types: {PAYMENT_METHOD_TYPES.map((t) => <Tok key={t}>{t}</Tok>).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ", ", el]), [])}.
        Supported currencies: <span className="font-mono text-[12px]">{SUPPORTED_CURRENCIES.join(", ")}</span>.
      </p>

      <H2 id="where-to-start">Where to start</H2>
      <LinkCards
        items={[
          { href: "/docs/quickstart", label: "Quickstart", description: "Sandbox account, first test key, first payment with a forced failover, the timeline and a verified webhook — in five steps." },
          { href: "/docs/authentication", label: "Authentication", description: "Bearer keys, test versus live, rotation and revocation, IP allow-lists, rate-limit headers and request ids." },
          { href: "/docs/sandbox", label: "Sandbox and test scenarios", description: "The demo providers, every test scenario with its exact behaviour, the hosted-page simulation and the provider report CSV." },
          { href: "/docs/payments", label: "Payments", description: "Lifecycle and statuses, capture and cancel and refund, next_action, the route and attempts objects, the timeline and idempotency." },
          { href: "/docs/webhooks", label: "Webhooks", description: "Event types, the payload envelope, signature verification in Node and Python, the retry schedule and delivery history." },
          { href: "/docs/errors", label: "Errors and failure codes", description: "The error envelope, error types and HTTP statuses, and the full failure dictionary grouped by retry category." },
          { href: "/docs/api-reference", label: "API reference", description: "Every path and method rendered from the published OpenAPI 3.1 document, with parameters, bodies and responses." },
          { href: "/docs/sdks", label: "SDKs and clients", description: "No official SDKs yet: generate a client from the spec, or copy the typed TypeScript fetch wrapper." },
        ]}
      />
    </>
  );
}
