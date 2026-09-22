import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, H2, H3, Note, Step, Tok } from "@/components/docs/parts";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "From a sandbox account to a verified webhook in five steps: create a test key, run a payment with a forced provider failover, read the timeline and verify a signature.",
};

const CURL_CREATE = `curl https://api.natio.me/v1/payments \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "payment_method": "card",
    "country": "US",
    "reference": "ORD-1001",
    "customer": {
      "external_id": "cust_42",
      "email": "buyer@example.com"
    },
    "test_scenario": "failover"
  }'`;

const NODE_CREATE = `// Node 18+ / any runtime with global fetch. No dependencies.
const res = await fetch("https://api.natio.me/v1/payments", {
  method: "POST",
  headers: {
    authorization: \`Bearer \${process.env.NATIO_API_KEY}\`,
    "content-type": "application/json",
    "idempotency-key": "order-1001",
  },
  body: JSON.stringify({
    amount: 10000,
    currency: "USD",
    payment_method: "card",
    country: "US",
    reference: "ORD-1001",
    customer: { external_id: "cust_42", email: "buyer@example.com" },
    test_scenario: "failover",
  }),
});

const payment = await res.json();
if (!res.ok) throw new Error(\`\${payment.error.code}: \${payment.error.message} (\${payment.request_id})\`);

console.log(payment.status);           // "successful"
console.log(payment.route.provider);   // { code: "demo_acquirer_b", ... }
console.log(payment.route.attempts);   // 2`;

const RESPONSE = `{
  "id": "pay_lfsWb45Pf5wJ1ZGgROzH",
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
  "description": null,
  "reference": "ORD-1001",
  "customer": {
    "id": "cus_z2q9iklt6fTJ2DG0g54c",
    "external_id": "cust_42",
    "email": "buyer@example.com",
    "name": null,
    "country": null
  },
  "metadata": {},
  "route": {
    "provider": {
      "id": "prv_v96zqY136WnbslKckAqf",
      "code": "demo_acquirer_b",
      "name": "NATIO Demo Acquirer B"
    },
    "provider_account_id": "pa_cePo211O81vjjA3TKEFR",
    "provider_account_name": "Acquirer B · Test",
    "provider_payment_id": "mp_mock_acquirer_6o3bRyJA3t84f8",
    "attempts": 2,
    "routing_decision_id": "rd_Z16Ekb6EV4vQ1rpFNDjl",
    "rule": "Cards → Acquirer A, fallback Acquirer B"
  },
  "risk": { "decision_id": "rkd_0u5JsiZwiE8VEUaU1rsS", "score": 0 },
  "failure": null,
  "next_action": null,
  "fee": { "amount": 320, "currency": "USD" },
  "processing_time_ms": 303,
  "test_scenario": "failover",
  "attempts": [
    {
      "id": "att_cAuoJEW1DCRqt3mth0OJ",
      "attempt_number": 1,
      "status": "failed",
      "outcome": "technical_error",
      "provider_id": "prv_mKJKu0bhvoQO3EMPKTzt",
      "provider_name": "NATIO Demo Acquirer A",
      "provider_account_id": "pa_lj6mWPXP7g7EAFN9QlC9",
      "provider_account_name": "Acquirer A · Test",
      "provider_payment_id": null,
      "provider_code": "GW-500",
      "provider_message": "Internal gateway error",
      "failure": {
        "code": "technical_error",
        "category": "technical",
        "message": "The provider returned a technical error"
      },
      "fee_amount": 0,
      "latency_ms": 46,
      "request_sent_at": "2026-09-22T02:10:33.990Z",
      "responded_at": "2026-09-22T02:10:34.044Z",
      "created_at": "2026-09-22T02:10:33.982Z"
    },
    {
      "id": "att_oz9CT4J3o1tpQwwl3KC0",
      "attempt_number": 2,
      "status": "succeeded",
      "outcome": "success",
      "provider_id": "prv_v96zqY136WnbslKckAqf",
      "provider_name": "NATIO Demo Acquirer B",
      "provider_account_id": "pa_cePo211O81vjjA3TKEFR",
      "provider_account_name": "Acquirer B · Test",
      "provider_payment_id": "mp_mock_acquirer_6o3bRyJA3t84f8",
      "provider_code": null,
      "provider_message": null,
      "failure": null,
      "fee_amount": 320,
      "latency_ms": 82,
      "request_sent_at": "2026-09-22T02:10:34.057Z",
      "responded_at": "2026-09-22T02:10:34.148Z",
      "created_at": "2026-09-22T02:10:34.048Z"
    }
  ],
  "created_at": "2026-09-22T02:10:33.845Z",
  "updated_at": "2026-09-22T02:10:34.149Z",
  "processed_at": "2026-09-22T02:10:34.149Z"
}`;

const GET_PAYMENT = `curl https://api.natio.me/v1/payments/pay_lfsWb45Pf5wJ1ZGgROzH \\
  -H "Authorization: Bearer natio_sk_test_..."

curl https://api.natio.me/v1/payments/pay_lfsWb45Pf5wJ1ZGgROzH/timeline \\
  -H "Authorization: Bearer natio_sk_test_..."`;

const TIMELINE = `{
  "payment_id": "pay_lfsWb45Pf5wJ1ZGgROzH",
  "data": [
    {
      "id": "pev_GfdKajG2gXI5Dj3HPW2T",
      "type": "payment.created",
      "title": "Payment created",
      "description": "100.00 USD · card · US",
      "attempt_id": null,
      "data": { "amount": 10000, "method": "card", "currency": "USD", "reference": "ORD-1001" },
      "created_at": "2026-09-22T02:10:33.845Z"
    },
    {
      "id": "pev_Il1s2aw8LFWxqh8tqqs9",
      "type": "risk.evaluated",
      "title": "Risk evaluated: ALLOW",
      "description": "score 0 · no rules matched",
      "attempt_id": null,
      "data": { "score": 0, "matched": [], "decision": "allow" },
      "created_at": "2026-09-22T02:10:33.880Z"
    },
    {
      "id": "pev_A9GKhXMA7usf7RkzixGc",
      "type": "routing.evaluated",
      "title": "Routing rule evaluated: Cards → Acquirer A, fallback Acquirer B",
      "description": "ordered strategy · 2 eligible provider(s) · rule \\"Cards → Acquirer A, fallback Acquirer B\\" matched",
      "attempt_id": null,
      "data": {
        "rule_id": "rr_VZVcRTv6uglIhiS0vVxx",
        "strategy": "ordered",
        "candidates": [
          { "score": 15.696, "account": "Acquirer A · Test", "reasons": [], "eligible": true, "provider": "NATIO Demo Acquirer A" },
          { "score": 35.798, "account": "Acquirer B · Test", "reasons": [], "eligible": true, "provider": "NATIO Demo Acquirer B" }
        ],
        "routing_decision_id": "rd_Z16Ekb6EV4vQ1rpFNDjl"
      },
      "created_at": "2026-09-22T02:10:33.976Z"
    },
    {
      "id": "pev_nWgECzGAmbDrmC7pc6a5",
      "type": "provider.selected",
      "title": "NATIO Demo Acquirer A selected",
      "description": "Attempt 1 · account Acquirer A · Test · fee 2.4% + 20",
      "attempt_id": "att_cAuoJEW1DCRqt3mth0OJ",
      "data": { "provider_id": "prv_mKJKu0bhvoQO3EMPKTzt", "attempt_number": 1, "provider_account_id": "pa_lj6mWPXP7g7EAFN9QlC9" },
      "created_at": "2026-09-22T02:10:33.982Z"
    },
    {
      "id": "pev_f984LMd8xvXP4iftGPiE",
      "type": "provider.request_sent",
      "title": "Request sent to provider",
      "description": "NATIO Demo Acquirer A · createPayment · sandbox: technical_error",
      "attempt_id": "att_cAuoJEW1DCRqt3mth0OJ",
      "data": { "adapter": "mock_acquirer", "simulate": "technical_error" },
      "created_at": "2026-09-22T02:10:33.998Z"
    },
    {
      "id": "pev_Yp3BZPrpF6EwG8WST3wI",
      "type": "provider.error",
      "title": "Provider technical error",
      "description": "NATIO Demo Acquirer A · GW-500 Internal gateway error",
      "attempt_id": "att_cAuoJEW1DCRqt3mth0OJ",
      "data": { "latency_ms": 46, "failure_code": "technical_error", "provider_code": "GW-500" },
      "created_at": "2026-09-22T02:10:34.046Z"
    },
    {
      "id": "pev_M2XNd2ZI3qslCEU3vP8H",
      "type": "failover.initiated",
      "title": "Fallback initiated",
      "description": "technical error is retryable → next provider NATIO Demo Acquirer B",
      "attempt_id": "att_cAuoJEW1DCRqt3mth0OJ",
      "data": { "reason": "technical_error_is_retryable", "next_provider_account_id": "pa_cePo211O81vjjA3TKEFR" },
      "created_at": "2026-09-22T02:10:34.047Z"
    },
    {
      "id": "pev_gd5Oy7Ez6xRqXSAQatg6",
      "type": "provider.selected",
      "title": "NATIO Demo Acquirer B selected",
      "description": "Attempt 2 · account Acquirer B · Test · fee 2.9% + 30",
      "attempt_id": "att_oz9CT4J3o1tpQwwl3KC0",
      "data": { "provider_id": "prv_v96zqY136WnbslKckAqf", "attempt_number": 2, "provider_account_id": "pa_cePo211O81vjjA3TKEFR" },
      "created_at": "2026-09-22T02:10:34.048Z"
    },
    {
      "id": "pev_nXDO2knZyjlwBgC4MZ22",
      "type": "payment.successful",
      "title": "Payment successful",
      "description": "NATIO Demo Acquirer B · Acquirer B · Test · 82 ms",
      "attempt_id": "att_oz9CT4J3o1tpQwwl3KC0",
      "data": { "fee_amount": 320, "latency_ms": 82, "provider_payment_id": "mp_mock_acquirer_6o3bRyJA3t84f8" },
      "created_at": "2026-09-22T02:10:34.148Z"
    },
    {
      "id": "pev_gPuwiuVNOKaWc3SsAtlm",
      "type": "webhook.queued",
      "title": "Webhook queued for merchant",
      "description": "1 endpoint(s) subscribed to payment.successful",
      "attempt_id": null,
      "data": { "endpoints": 1, "event_type": "payment.successful" },
      "created_at": "2026-09-22T02:10:34.159Z"
    }
  ]
}`;

const VERIFY = `import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

const app = express();

// The raw body is mandatory: the signature covers the exact bytes NATIO sent.
app.post("/webhooks/natio", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  const header = req.get("natio-signature") ?? "";

  const parts = Object.fromEntries(header.split(",").map((kv) => {
    const i = kv.indexOf("=");
    return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
  }));

  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isFinite(t) || !v1) return res.sendStatus(400);
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > 300) return res.sendStatus(400); // 5 minute tolerance

  const expected = createHmac("sha256", process.env.NATIO_WEBHOOK_SECRET!)
    .update(\`\${t}.\${raw}\`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.sendStatus(400);

  const event = JSON.parse(raw);
  // Acknowledge first, then process asynchronously and deduplicate on event.id.
  res.sendStatus(200);
  void handle(event);
});`;

const TEST_EVENT = `curl -X POST https://api.natio.me/v1/webhooks/test \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "event_type": "payment.successful" }'`;

export default function QuickstartPage() {
  return (
    <>
      <DocHeader
        eyebrow="Getting started"
        title="Quickstart"
        lead="Five steps from nothing to a verified integration: a sandbox account, a test key, a payment that deliberately fails over between two demo providers, the timeline that proves it, and a signed webhook you have verified yourself."
      />

      <Note tone="info" title="What you need">
        A terminal with <Tok>curl</Tok>, or any runtime with <Tok>fetch</Tok>. Nothing is installed, and no card data is involved at any point: the sandbox uses NATIO demo
        providers only.
      </Note>

      <Step n={1} title="Create a sandbox account">
        <p>
          Register at <Link href="/dashboard/register">/dashboard/register</Link>. The account starts in <strong>test mode</strong> with the demo providers already connected and
          a default set of routing rules, so payments can be orchestrated immediately.
        </p>
        <p>
          Live mode is a separate step: live API keys are only issued once the merchant KYB review is approved. Everything in this quickstart runs in test mode and never touches
          production money movement.
        </p>
      </Step>

      <Step n={2} title="Get a test API key">
        <p>
          In the dashboard open <Link href="/dashboard/api-keys">API keys</Link> and create a key with mode <Tok>test</Tok>. The secret is shown once and stored as a SHA-256
          hash, so copy it into your environment straight away.
        </p>
        <Code
          caption="Shape of a key"
          code={`natio_sk_test_AP8j...        test mode — demo providers, test_scenario accepted
natio_sk_live_...            live mode — real providers, issued after KYB approval

# keep it out of source control
export NATIO_API_KEY="natio_sk_test_..."`}
        />
        <p>
          Every request authenticates with <Tok>Authorization: Bearer $NATIO_API_KEY</Tok>. The key identifies the merchant, the project and the mode; you never send those as
          parameters. Details and rotation rules are in <Link href="/docs/authentication">Authentication</Link>.
        </p>
      </Step>

      <Step n={3} title="Create your first payment">
        <p>
          Create a 100.00 USD card payment and force a provider failover with <Tok>test_scenario: &quot;failover&quot;</Tok>. The first demo acquirer will fail technically, and
          NATIO will cascade to the second one inside the same request.
        </p>
        <Code caption="curl" code={CURL_CREATE} />
        <Code caption="Node — fetch" code={NODE_CREATE} />
        <H3 id="response">The response</H3>
        <p>
          <Tok>201 Created</Tok>. The payment is <Tok>successful</Tok>, but look at <Tok>route.attempts</Tok>: it took two. The first attempt failed at NATIO Demo Acquirer A
          with <Tok>technical_error</Tok>; the second succeeded at NATIO Demo Acquirer B. Both are returned inline, with the provider code, message, fee and latency of each.
        </p>
        <Code caption="201 Created" code={RESPONSE} />
        <DocTable
          columns={["Field", "Why it matters"]}
          rows={[
            [<Tok key="s">status</Tok>, <>The outcome of the whole payment, not of one provider call. See the <Link key="l" href="/docs/payments">status table</Link>.</>],
            [<Tok key="r">route.provider</Tok>, "The provider account that actually processed the payment — the second one here."],
            [<Tok key="ra">route.attempts</Tok>, "How many provider calls it took. Anything above 1 means a cascade happened."],
            [<Tok key="rr">route.rule</Tok>, "The routing rule that produced the candidate order."],
            [<Tok key="a">attempts[]</Tok>, "One entry per provider call, in order, with the normalised failure object on the ones that failed."],
            [<Tok key="f">fee</Tok>, "The fee charged by the provider account that succeeded, in minor units."],
            [<Tok key="na">next_action</Tok>, <><Tok key="n">null</Tok> here because cards are synchronous. Redirect and QR rails return an object to hand to the customer.</>],
          ]}
        />
        <Note tone="warn" title="Amounts are integers in the minor unit">
          <Tok>10000</Tok> with <Tok>USD</Tok> is 100.00 USD. Never send a decimal. Zero-decimal currencies such as JPY and VND take the amount as-is.
        </Note>
      </Step>

      <Step n={4} title="Read the payment and its timeline">
        <p>
          The payment object is the state; the timeline is the explanation. It records the risk decision, the routing decision with every candidate and its score, each provider
          request, the failure that triggered the cascade, and the success that closed it.
        </p>
        <Code caption="curl" code={GET_PAYMENT} />
        <Code caption="GET /v1/payments/{id}/timeline — 200 OK" code={TIMELINE} />
        <p>
          That is the whole failover, in order: <Tok>routing.evaluated</Tok> with two eligible candidates, <Tok>provider.selected</Tok> for Acquirer A,{" "}
          <Tok>provider.error</Tok> with the raw provider code <Tok>GW-500</Tok>, <Tok>failover.initiated</Tok> because a technical error is retryable, then{" "}
          <Tok>provider.selected</Tok> for Acquirer B and <Tok>payment.successful</Tok>. Each timeline event type is listed in{" "}
          <Link href="/docs/payments">Payments</Link>.
        </p>
      </Step>

      <Step n={5} title="Add a webhook endpoint and verify the signature">
        <p>
          Polling is not required. Add an endpoint under <Link href="/dashboard/webhooks">Webhooks</Link> in the dashboard, choose the event types you care about, and store the{" "}
          <Tok>whsec_…</Tok> signing secret that is shown once.
        </p>
        <p>
          Every delivery carries a <Tok>Natio-Signature</Tok> header of the form <Tok>t=&lt;unix&gt;,v1=&lt;hex&gt;</Tok>, where the hex value is an HMAC-SHA256 over{" "}
          <Tok>&quot;&lt;t&gt;.&lt;raw body&gt;&quot;</Tok> with your endpoint secret. Verify it against the raw bytes, and reject timestamps older than five minutes.
        </p>
        <Code caption="Node — Express receiver" code={VERIFY} />
        <Note tone="bad" title="Use the raw body">
          A JSON parse and re-serialise changes whitespace and key order, and the signature will not match. Capture the raw request body before any body parser touches it.
        </Note>
        <p>Trigger a delivery without creating another payment:</p>
        <Code caption="Send a test event" code={TEST_EVENT} />
        <p>
          The dashboard shows every delivery, each attempt with its response status, and a manual resend button. Retries, the full event list and a Python verifier are in{" "}
          <Link href="/docs/webhooks">Webhooks</Link>.
        </p>
      </Step>

      <H2 id="next">Where to go next</H2>
      <ul>
        <li>
          <Link href="/docs/sandbox">Sandbox and test scenarios</Link> — every scenario you can force, including timeouts, recovered timeouts, risk review and total failure.
        </li>
        <li>
          <Link href="/docs/payments">Payments</Link> — manual capture, cancel, refunds, <Tok>next_action</Tok> for redirect and QR rails, and idempotency semantics.
        </li>
        <li>
          <Link href="/docs/errors">Errors and failure codes</Link> — what to retry, what to show the customer, and what never to retry.
        </li>
        <li>
          <Link href="/docs/api-reference">API reference</Link> — every endpoint, rendered from the published OpenAPI document.
        </li>
      </ul>
    </>
  );
}
