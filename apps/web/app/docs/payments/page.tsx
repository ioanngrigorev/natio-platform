import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, H2, H3, Note, Tok } from "@/components/docs/parts";
import { PaymentLifecycle } from "@/components/docs/payment-lifecycle";
import { CURRENCY_EXPONENTS, PAYMENT_METHOD_TYPES, PAYMENT_STATUSES, TIMELINE_EVENTS } from "@/components/docs/data";
import { StatusBadge } from "@/components/ui";

export const metadata: Metadata = {
  title: "Payments",
  description: "The payment lifecycle and status table, create, capture, cancel and refund, capture methods, next_action, the route and attempts objects, the timeline, idempotency semantics and money representation.",
};

const CREATE = `curl https://api.natio.me/v1/payments \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "payment_method": "card",
    "capture_method": "automatic",
    "country": "US",
    "reference": "ORD-1001",
    "description": "Order 1001",
    "customer": { "external_id": "cust_42", "email": "buyer@example.com" },
    "return_url": "https://merchant.example/return",
    "metadata": { "cart_id": "c_991" }
  }'`;

const AUTHORIZE = `# capture_method: "manual" holds the funds instead of taking them
{
  "id": "pay_Jj6lYt0liW18i9K5LM7g",
  "status": "authorized",
  "amount": 10000,
  "captured_amount": 0,
  "capture_method": "manual",
  "route": {
    "provider": { "id": "prv_mKJKu0bhvoQO3EMPKTzt", "code": "demo_acquirer_a", "name": "NATIO Demo Acquirer A" },
    "provider_account_id": "pa_lj6mWPXP7g7EAFN9QlC9",
    "provider_account_name": "Acquirer A · Test",
    "provider_payment_id": "mp_mock_acquirer_bfpwNJ4L19U3HQ",
    "attempts": 1,
    "routing_decision_id": "rd_RFkIqEV0vx61j5jicY0B",
    "rule": "Cards → Acquirer A, fallback Acquirer B"
  }
}`;

const CAPTURE = `curl -X POST https://api.natio.me/v1/payments/pay_Jj6lYt0liW18i9K5LM7g/capture \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: capture-1001" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": 10000 }'

# 200 OK
{
  "id": "pay_Jj6lYt0liW18i9K5LM7g",
  "status": "successful",
  "amount": 10000,
  "captured_amount": 10000,
  "refunded_amount": 0
}`;

const CANCEL = `curl -X POST https://api.natio.me/v1/payments/pay_aAdBl7rkJnhZC8xZeIER/cancel \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "reason": "customer abandoned checkout" }'

# 200 OK
{
  "id": "pay_aAdBl7rkJnhZC8xZeIER",
  "status": "cancelled",
  "amount": 5000,
  "currency": "EUR",
  "captured_amount": 0
}`;

const REFUND = `curl -X POST https://api.natio.me/v1/payments/pay_Jj6lYt0liW18i9K5LM7g/refund \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: refund-1001" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": 2500, "reason": "customer_request" }'

# 201 Created
{
  "id": "rf_MvEcSaFW6vw9YX76swGu",
  "object": "refund",
  "mode": "test",
  "payment_id": "pay_Jj6lYt0liW18i9K5LM7g",
  "amount": 2500,
  "currency": "USD",
  "status": "successful",
  "reason": "customer_request",
  "provider_account_id": "pa_lj6mWPXP7g7EAFN9QlC9",
  "provider_refund_id": "mrf_mock_acquirer_PNORRwIkWWLQbV",
  "failure": null,
  "metadata": {},
  "created_at": "2026-09-22T02:19:05.459Z",
  "updated_at": "2026-09-22T02:19:05.521Z"
}`;

const NEXT_ACTION = `{
  "id": "pay_9yLEFy41uUGI0CMhbswo",
  "status": "processing",
  "next_action": {
    "type": "redirect",
    "url": "https://api.natio.me/sandbox/hosted/pa_.../mp_mock_acquirer_tTa8hRyaVFXNdq",
    "expiresAt": "2026-09-22T02:47:58.149Z"
  }
}`;

const ATTEMPTS = `"route": {
  "provider": { "id": "prv_v96z...", "code": "demo_acquirer_b", "name": "NATIO Demo Acquirer B" },
  "provider_account_id": "pa_cePo211O81vjjA3TKEFR",
  "provider_account_name": "Acquirer B · Test",
  "provider_payment_id": "mp_mock_acquirer_6o3bRyJA3t84f8",
  "attempts": 2,
  "routing_decision_id": "rd_Z16Ekb6EV4vQ1rpFNDjl",
  "rule": "Cards → Acquirer A, fallback Acquirer B"
},
"attempts": [
  {
    "attempt_number": 1,
    "status": "failed",
    "outcome": "technical_error",
    "provider_name": "NATIO Demo Acquirer A",
    "provider_code": "GW-500",
    "provider_message": "Internal gateway error",
    "failure": { "code": "technical_error", "category": "technical", "message": "The provider returned a technical error" },
    "fee_amount": 0,
    "latency_ms": 46
  },
  {
    "attempt_number": 2,
    "status": "succeeded",
    "outcome": "success",
    "provider_name": "NATIO Demo Acquirer B",
    "provider_payment_id": "mp_mock_acquirer_6o3bRyJA3t84f8",
    "failure": null,
    "fee_amount": 320,
    "latency_ms": 82
  }
]`;

const TIMELINE = `curl https://api.natio.me/v1/payments/pay_lfsWb45Pf5wJ1ZGgROzH/timeline \\
  -H "Authorization: Bearer natio_sk_test_..."

{
  "payment_id": "pay_lfsWb45Pf5wJ1ZGgROzH",
  "data": [
    {
      "id": "pev_M2XNd2ZI3qslCEU3vP8H",
      "type": "failover.initiated",
      "title": "Fallback initiated",
      "description": "technical error is retryable → next provider NATIO Demo Acquirer B",
      "attempt_id": "att_cAuoJEW1DCRqt3mth0OJ",
      "data": { "reason": "technical_error_is_retryable", "next_provider_account_id": "pa_cePo211O81vjjA3TKEFR" },
      "created_at": "2026-09-22T02:10:34.047Z"
    }
  ]
}`;

const IDEMPOTENT = `# First call
POST /v1/payments   Idempotency-Key: order-1001
→ 201 Created    { "id": "pay_lfsWb45Pf5wJ1ZGgROzH", ... }

# Same key, byte-equivalent body → the stored response, not a second payment
POST /v1/payments   Idempotency-Key: order-1001
→ 201 Created
  idempotent-replayed: true
  { "id": "pay_lfsWb45Pf5wJ1ZGgROzH", ... }

# Same key, different body
POST /v1/payments   Idempotency-Key: order-1001   { "amount": 20000, ... }
→ 422 Unprocessable Entity
  {
    "error": {
      "type": "idempotency_error",
      "code": "idempotency_key_reused",
      "message": "Idempotency-Key was already used with a different request payload"
    },
    "request_id": "req_eAHZ5GTlg7cHsoER"
  }

# Same key while the first call is still running
→ 409 Conflict
  {
    "error": {
      "type": "idempotency_error",
      "code": "idempotency_in_progress",
      "message": "A request with this Idempotency-Key is still being processed"
    },
    "request_id": "req_..."
  }`;

export default function PaymentsPage() {
  return (
    <>
      <DocHeader
        eyebrow="Guides"
        title="Payments"
        lead="A payment is the unit of orchestration: one object, one status, and as many provider attempts as the routing rules and the failure categories allow. This page covers its lifecycle, the operations on it, and the two things every integration gets wrong — idempotency and money representation."
      />

      <H2 id="lifecycle">Lifecycle</H2>
      <p>
        The status machine is enforced in the API, not in the client. An invalid move returns <Tok>409 invalid_state_transition</Tok> rather than silently doing nothing, and the
        guard is applied at the database level so two concurrent writers can never produce an invalid path.
      </p>
      <PaymentLifecycle />
      <DocTable
        columns={["Status", "Meaning", "Can move to"]}
        rows={PAYMENT_STATUSES.map((s) => [
          <span key={s.status} className="whitespace-nowrap">
            <StatusBadge variant="dark" status={s.status} label={s.status} />
          </span>,
          s.meaning,
          <span key={`${s.status}-n`} className="font-mono text-[11.5px] text-mist-400">
            {s.next}
          </span>,
        ])}
      />
      <Note tone="info" title="Status is about the payment, not the provider">
        A payment can be <Tok>successful</Tok> after a provider failed: that failure is an attempt outcome, not the payment outcome. Read <Tok>status</Tok> for the decision you
        show the customer, and <Tok>attempts[]</Tok> for what happened on the way there.
      </Note>

      <H2 id="create">Create a payment</H2>
      <p>
        <Tok>POST /v1/payments</Tok> runs risk evaluation, routing and the provider calls synchronously. The response is <Tok>201 Created</Tok> with the final status for
        synchronous rails, or <Tok>processing</Tok> with a <Tok>next_action</Tok> for rails that need the customer.
      </p>
      <Code caption="Request" code={CREATE} />
      <DocTable
        columns={["Field", "Required", "Notes"]}
        rows={[
          [<Tok key="a">amount</Tok>, "yes", "Positive integer in the minor unit of the currency."],
          [<Tok key="b">currency</Tok>, "yes", "Three-letter ISO 4217 code from the supported list."],
          [
            <Tok key="c">payment_method</Tok>,
            "yes",
            <>
              A type string ({PAYMENT_METHOD_TYPES.map((t, i) => (
                <span key={t}>
                  {i > 0 ? ", " : ""}
                  <Tok>{t}</Tok>
                </span>
              ))}
              ), or an object <Tok key="o">{"{ type, token?, id? }"}</Tok> referencing a stored provider token.
            </>,
          ],
          [<Tok key="d">capture_method</Tok>, "no", <>
            <Tok key="x">automatic</Tok> (default) or <Tok key="y">manual</Tok>.
          </>],
          [<Tok key="e">country</Tok>, "no", "Two-letter country code. Used by routing rules and by provider eligibility."],
          [<Tok key="f">customer</Tok>, "no", <>
            <Tok key="z">id</Tok>, <Tok key="z2">external_id</Tok>, <Tok key="z3">email</Tok>, <Tok key="z4">name</Tok>, <Tok key="z5">country</Tok>. Used for risk signals and for support lookups.
          </>],
          [<Tok key="g">reference</Tok>, "no", "Your order identifier. Searchable and carried onto the ledger."],
          [<Tok key="h">description</Tok>, "no", "Free text, up to 500 characters."],
          [<Tok key="i">return_url</Tok>, "no", "Where the customer returns after a redirect or QR action."],
          [<Tok key="j">metadata</Tok>, "no", "Up to 50 keys of string, number, boolean or null. Returned on the payment and on webhook payloads."],
          [<Tok key="k">test_scenario</Tok>, "no", <>Test keys only. See <Link key="l" href="/docs/sandbox">Sandbox</Link>.</>],
          [<Tok key="m">device</Tok>, "no", <>
            <Tok key="n">ip</Tok>, <Tok key="o2">user_agent</Tok>, <Tok key="p">fingerprint</Tok>. Risk signals from the customer session.
          </>],
        ]}
      />
      <Note tone="bad" title="Never send card data">
        The request body has no field for a card number, and the API rejects anything that looks like one on <Tok>POST /v1/payment-methods</Tok>. Sensitive entry belongs on a
        provider-hosted page or a PCI-compliant tokenisation service; NATIO receives the type or the token reference only.
      </Note>

      <H2 id="capture-method">Capture method</H2>
      <DocTable
        columns={["capture_method", "What happens", "When to use it"]}
        rows={[
          [
            <Tok key="a">automatic</Tok>,
            <>
              Authorisation and capture in one provider call. A successful payment lands directly on <Tok key="b">successful</Tok> with{" "}
              <Tok key="c">captured_amount</Tok> equal to <Tok key="d">amount</Tok>.
            </>,
            "Goods or services delivered immediately: digital products, subscriptions, top-ups.",
          ],
          [
            <Tok key="e">manual</Tok>,
            <>
              Funds are authorised and held. The payment stops at <Tok key="f">authorized</Tok> with <Tok key="g">captured_amount: 0</Tok> until you capture or cancel.
            </>,
            "Anything you confirm before charging: stock checks, shipping, fraud review, bookings.",
          ],
        ]}
      />
      <Code caption="Manual capture — 201 Created" code={AUTHORIZE} />
      <H3 id="capture">Capture</H3>
      <p>
        <Tok>POST /v1/payments/{"{id}"}/capture</Tok> takes an optional <Tok>amount</Tok>; omit it to capture the full authorised amount. Partial capture is supported where the
        provider supports it.
      </p>
      <Code caption="Capture" code={CAPTURE} />
      <p>
        If the provider rejects the capture, a <Tok>capture.failed</Tok> timeline event is written and the payment stays <Tok>authorized</Tok> — it does not fail. Authorisations
        also expire at the provider; capture inside the window the provider grants, or cancel.
      </p>
      <H3 id="cancel">Cancel</H3>
      <p>
        <Tok>POST /v1/payments/{"{id}"}/cancel</Tok> releases an authorisation or abandons a payment that has not completed. The optional <Tok>reason</Tok> is recorded on the
        timeline and in the audit trail.
      </p>
      <Code caption="Cancel" code={CANCEL} />
      <H3 id="refund">Refund</H3>
      <p>
        <Tok>POST /v1/payments/{"{id}"}/refund</Tok> returns money through the provider that took the payment. Omit <Tok>amount</Tok> for a full refund; send a smaller amount for
        a partial one. Refunds can be repeated until the captured amount is exhausted.
      </p>
      <Code caption="Partial refund" code={REFUND} />
      <p>
        A settled refund moves the payment to <Tok>partially_refunded</Tok> or <Tok>refunded</Tok> and increases <Tok>refunded_amount</Tok>. A rejected refund leaves the payment
        amounts untouched and carries its own <Tok>failure</Tok> object. Read refunds back with{" "}
        <Tok>GET /v1/payments/{"{id}"}/refunds</Tok> or <Tok>GET /v1/refunds/{"{id}"}</Tok>.
      </p>

      <H2 id="next-action">next_action: redirect and QR rails</H2>
      <p>
        When the provider needs the customer, the create call returns <Tok>processing</Tok> and a <Tok>next_action</Tok> object. Your code hands that to the customer and then
        waits for the webhook; it does not poll and it does not decide the outcome itself.
      </p>
      <Code caption="201 Created — action required" code={NEXT_ACTION} />
      <DocTable
        columns={["next_action.type", "What you do"]}
        rows={[
          [<Tok key="a">redirect</Tok>, <>Send the browser to <Tok key="b">url</Tok>. The customer returns to your <Tok key="c">return_url</Tok> when the provider is done.</>],
          [<Tok key="d">qr_code</Tok>, <>Render <Tok key="e">qrPayload</Tok> as a QR image for the customer to scan. <Tok key="f">url</Tok> is the provider page that completes it.</>],
          [<Tok key="g">display_details</Tok>, "Show the instructions the provider returned, for rails where the customer pushes money themselves."],
        ]}
      />
      <Note tone="warn" title="The return URL is not the outcome">
        A customer can close the tab, lose connectivity or come back on a different device. The authoritative transitions are the{" "}
        <Link href="/docs/webhooks">webhook events</Link> and <Tok>GET /v1/payments/{"{id}"}</Tok>. Treat the return as a navigation hint and re-read the payment.
      </Note>
      <p>
        <Tok>next_action.expiresAt</Tok> is when the action stops being completable. After that the provider expires the payment, which surfaces as a failure with code{" "}
        <Tok>payment_expired</Tok>.
      </p>

      <H2 id="route-attempts">The route and attempts objects</H2>
      <p>
        <Tok>route</Tok> is the summary of where the payment ended up; <Tok>attempts[]</Tok> is the full history of how it got there. Both are returned inline on every payment,
        so support questions rarely need a second call.
      </p>
      <Code caption="Excerpt from a payment that failed over" code={ATTEMPTS} />
      <DocTable
        columns={["route field", "Meaning"]}
        rows={[
          [<Tok key="a">provider</Tok>, "The provider that processed the payment: id, code and display name. Null while no attempt has succeeded."],
          [<Tok key="b">provider_account_id</Tok>, "The specific provider account (credentials, fees, limits) that was used."],
          [<Tok key="c">provider_payment_id</Tok>, "The provider side identifier. Quote this in a provider support ticket."],
          [<Tok key="d">attempts</Tok>, "How many provider calls the payment took. Greater than 1 means a cascade occurred."],
          [<Tok key="e">routing_decision_id</Tok>, "The recorded routing decision, including every candidate and its score."],
          [<Tok key="f">rule</Tok>, "The routing rule that matched, or null when the default scoring strategy was used."],
        ]}
      />
      <DocTable
        columns={["attempt field", "Meaning"]}
        rows={[
          [<Tok key="a">attempt_number</Tok>, "1-based position in the cascade for this payment."],
          [
            <Tok key="b">status</Tok>,
            <span key="s" className="font-mono text-[11.5px]">
              created · processing · unknown · authorized · succeeded · failed · cancelled
            </span>,
          ],
          [
            <Tok key="c">outcome</Tok>,
            <span key="o" className="font-mono text-[11.5px]">
              success · requires_action · soft_decline · hard_decline · technical_error · timeout · provider_unavailable · unknown
            </span>,
          ],
          [<Tok key="d">provider_code</Tok>, "The raw code the provider returned, unmapped. Useful when talking to the provider."],
          [<Tok key="e">provider_message</Tok>, "The provider message, unmapped. Do not show it to customers."],
          [<Tok key="f">failure</Tok>, <>The normalised <Link key="l" href="/docs/errors">failure object</Link>: code, category and message. This is what you branch on.</>],
          [<Tok key="g">fee_amount</Tok>, "Fee charged by that provider account, in minor units. Zero on attempts that did not move money."],
          [<Tok key="h">latency_ms</Tok>, "Provider round-trip for that attempt."],
        ]}
      />
      <p>
        Whether a failed attempt is followed by another one is decided by the failure <em>category</em>: soft declines and technical failures may cascade to the next eligible
        provider, hard declines never do. The full dictionary is in <Link href="/docs/errors">Errors and failure codes</Link>.
      </p>

      <H2 id="timeline">Timeline</H2>
      <p>
        <Tok>GET /v1/payments/{"{id}"}/timeline</Tok> returns every decision and provider interaction in order. It is the same data the dashboard renders, and it is the fastest
        answer to &ldquo;why did this payment go there&rdquo;.
      </p>
      <Code caption="Timeline event" code={TIMELINE} />
      <p>
        Each event has a stable <Tok>type</Tok>, a human <Tok>title</Tok> and <Tok>description</Tok>, an optional <Tok>attempt_id</Tok> tying it to one provider call, and a{" "}
        <Tok>data</Tok> object whose shape depends on the type. Branch on <Tok>type</Tok>; treat <Tok>title</Tok> and <Tok>description</Tok> as display text.
      </p>
      <DocTable columns={["type", "What it records"]} rows={TIMELINE_EVENTS.map((e) => [<Tok key={e.type}>{e.type}</Tok>, e.meaning])} />
      <Note tone="info" title="Timeline events are not webhook events">
        The timeline is the internal narrative of one payment and is read on demand. Webhooks are the subset of state changes you subscribe to and are pushed to your endpoints.
        The names overlap deliberately, but the two lists are not the same.
      </Note>

      <H2 id="idempotency">Idempotency</H2>
      <p>
        Every mutating endpoint accepts an <Tok>Idempotency-Key</Tok> header, up to 255 characters. Use one per logical operation — your order id for the payment, your refund id
        for the refund — and reuse it on every retry of that operation, including retries after a timeout or a 429.
      </p>
      <DocTable
        columns={["Situation", "Result"]}
        rows={[
          [
            "Same key, same body",
            <>
              The stored response is replayed verbatim with the original status code and the header <Tok key="a">Idempotent-Replayed: true</Tok>. The handler does not run again.
            </>,
          ],
          [
            "Same key, different body",
            <>
              <Tok key="b">422</Tok> <Tok key="c">idempotency_key_reused</Tok>. Nothing is created.
            </>,
          ],
          [
            "Same key, first call still in flight",
            <>
              <Tok key="d">409</Tok> <Tok key="e">idempotency_in_progress</Tok>. Retry shortly; the stored response will be replayed once the first call finishes.
            </>,
          ],
          ["No key at all", "The request executes normally. A retry creates a second payment — which is exactly the failure mode the header exists to prevent."],
        ]}
      />
      <Code caption="The three outcomes" code={IDEMPOTENT} />
      <p>
        Bodies are compared by a stable hash that ignores key order, so re-serialising the same object is safe. Keys are scoped per merchant, per mode and per operation, so the
        same key can be used for a payment and for a capture without colliding. Keys expire after a retention window; a replay is only guaranteed while the record is retained.
      </p>

      <H2 id="money">Money representation</H2>
      <p>
        All amounts — <Tok>amount</Tok>, <Tok>captured_amount</Tok>, <Tok>refunded_amount</Tok>, <Tok>fee.amount</Tok>, ledger and settlement amounts — are integers in the minor
        unit of the currency. There are no decimals anywhere in the API, which removes rounding and float ambiguity from the contract.
      </p>
      <DocTable
        columns={["Decimals", "Currencies", "Example"]}
        rows={CURRENCY_EXPONENTS.map((c) => [<Tok key={c.exponent}>{c.exponent}</Tok>, c.currencies, <span key={`${c.exponent}-e`}>{c.example}</span>])}
      />
      <Note tone="warn" title="Zero-decimal currencies are the classic bug">
        <Tok>10000</Tok> is 100.00 USD but 10000 JPY — a hundredfold difference. Convert from your own representation using the exponent of the currency, never a fixed
        multiplication by 100.
      </Note>
      <p>
        Currency is a three-letter ISO 4217 code and must be one of the supported list; anything else is refused at validation with{" "}
        <Tok>422 validation_failed</Tok> before a provider is ever contacted.
      </p>

      <H2 id="reading">Reading payments back</H2>
      <DocTable
        columns={["Call", "Returns"]}
        rows={[
          [<Tok key="a">GET /v1/payments/{"{id}"}</Tok>, "The payment with its route, risk, failure, fee and full attempts array."],
          [<Tok key="b">GET /v1/payments</Tok>, <>A cursor-paginated list. Filter by <Tok key="c">status</Tok>, <Tok key="d">currency</Tok>, <Tok key="e">country</Tok>, <Tok key="f">payment_method</Tok>, <Tok key="g">reference</Tok>, <Tok key="h">search</Tok>, <Tok key="i">from</Tok> and <Tok key="j">to</Tok>.</>],
          [<Tok key="k">GET /v1/payments/{"{id}"}/timeline</Tok>, "Every decision and provider interaction, in order."],
          [<Tok key="l">GET /v1/payments/{"{id}"}/refunds</Tok>, "Every refund created against the payment."],
          [<Tok key="m">GET /v1/transactions</Tok>, "The ledger lines the payment produced, with the provider reference used in reconciliation."],
        ]}
      />
      <p>
        Lists are cursor based: send <Tok>limit</Tok> (1–200, default 50) and pass <Tok>next_cursor</Tok> from the previous page back as <Tok>cursor</Tok> while{" "}
        <Tok>has_more</Tok> is true. Every parameter is documented in the <Link href="/docs/api-reference">API reference</Link>.
      </p>
    </>
  );
}
