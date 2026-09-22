import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, H2, H3, Note, Tok } from "@/components/docs/parts";
import { DEMO_PROVIDERS, REFUND_TEST_SCENARIOS, TEST_SCENARIOS } from "@/components/docs/data";

export const metadata: Metadata = {
  title: "Sandbox & test scenarios",
  description: "The NATIO demo providers, the complete test-scenario catalogue, how to trigger each one, the hosted-page simulation for redirect and QR rails, and the sandbox provider report used for reconciliation.",
};

const TRIGGER = `curl https://api.natio.me/v1/payments \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "payment_method": "card",
    "test_scenario": "soft_decline"
  }'`;

const LIST = `curl https://api.natio.me/v1/test/scenarios \\
  -H "Authorization: Bearer natio_sk_test_..."

{
  "data": [
    { "name": "success", "description": "Payment is approved by the first provider." },
    { "name": "authorize", "description": "Payment is authorised only; capture it with POST /v1/payments/{id}/capture." }
  ]
}`;

const LIVE_REJECT = `{
  "error": {
    "type": "invalid_request_error",
    "code": "test_scenario_not_allowed",
    "message": "test_scenario is only accepted with test API keys",
    "param": "test_scenario"
  },
  "request_id": "req_0uwP4ioIZ8q8dgBW"
}`;

const REQUIRES_ACTION = `{
  "id": "pay_9yLEFy41uUGI0CMhbswo",
  "status": "processing",
  "next_action": {
    "url": "http://localhost:4000/sandbox/hosted/pa_lj6mWPXP7g7EAFN9QlC9/mp_mock_acquirer_tTa8hRyaVFXNdq",
    "type": "redirect",
    "expiresAt": "2026-09-22T02:47:58.149Z"
  },
  "route": {
    "provider": { "id": "prv_mKJKu0bhvoQO3EMPKTzt", "code": "demo_acquirer_a", "name": "NATIO Demo Acquirer A" },
    "provider_account_id": "pa_lj6mWPXP7g7EAFN9QlC9",
    "provider_payment_id": "mp_mock_acquirer_tTa8hRyaVFXNdq",
    "attempts": 1,
    "rule": "Cards → Acquirer A, fallback Acquirer B"
  }
}`;

const QR_ACTION = `{
  "type": "qr_code",
  "qrPayload": "NATIO-DEMO-QR|mp_mock_qr_...|10000|VND",
  "url": "https://api.natio.me/sandbox/hosted/pa_.../mp_mock_qr_...",
  "expiresAt": "2026-09-22T03:02:11.402Z"
}`;

const CSV = `provider_reference,natio_reference,type,amount,currency,status
mp_mock_acquirer_2F5S5ySxFfbcpW,pay_GhIQ6vl0fEbcIpC2VsQz,payment,5000,EUR,settled
mp_mock_acquirer_jzQP8MGRTSYTsZ,pay_3dIYLVfvZh2jXf34PKEK,payment,2000,GBP,settled`;

export default function SandboxPage() {
  return (
    <>
      <DocHeader
        eyebrow="Getting started"
        title="Sandbox and test scenarios"
        lead="Test mode runs the full orchestration path — risk, routing, attempts, failover, webhooks, ledger and settlement — against NATIO demo providers. You choose the outcome of each payment, so every branch of your integration is reachable on demand."
      />

      <Note tone="info" title="Same contract, simulated providers">
        The request and response shapes, the status machine, the error envelope and the webhook signatures are identical in test and live mode. Only the providers behind the
        orchestration layer change. No funds move in test mode and no card data is involved at any point.
      </Note>

      <H2 id="demo-providers">Demo providers</H2>
      <p>
        A sandbox account is seeded with three demo provider accounts and a set of routing rules that use them. They are ordinary provider accounts as far as the orchestration
        engine is concerned: they have priorities, fees, limits and simulated latency, and they appear in routing decisions like any other.
      </p>
      <DocTable
        columns={["Provider", "Code", "Type", "Role in the sandbox"]}
        rows={DEMO_PROVIDERS.map((p) => [<strong key={p.code}>{p.name}</strong>, <Tok key={`${p.code}-c`}>{p.code}</Tok>, p.kind, p.role])}
      />
      <p>
        The seeded card rule orders Acquirer A before Acquirer B, which is what makes a failover visible: the first attempt goes to A, and a retryable failure cascades to B
        inside the same request. Routing rules are editable per merchant, so your own sandbox can be shaped to match the production topology you intend to run.
      </p>

      <H2 id="scenarios">Test scenarios</H2>
      <p>
        A scenario is expanded by the orchestrator into a per-attempt outcome hint for the demo adapters. That is why a scenario can describe behaviour across several providers:{" "}
        <Tok>failover</Tok> makes the first attempt fail technically and the second succeed.
      </p>
      <DocTable columns={["test_scenario", "Behaviour"]} rows={TEST_SCENARIOS.map((s) => [<Tok key={s.name}>{s.name}</Tok>, s.description])} />

      <H3 id="triggering">How to trigger a scenario</H3>
      <p>
        Send the scenario name in the <Tok>test_scenario</Tok> field on <Tok>POST /v1/payments</Tok>. No other part of the request changes.
      </p>
      <Code caption="curl" code={TRIGGER} />
      <p>
        The value is echoed back on the payment object as <Tok>test_scenario</Tok>, and the simulated primitive for each attempt appears in the timeline on the{" "}
        <Tok>provider.request_sent</Tok> event (for example <Tok>sandbox: technical_error</Tok>), so it is always clear which branch ran.
      </p>
      <p>
        Refunds accept a smaller set on <Tok>POST /v1/payments/{"{id}"}/refund</Tok>:{" "}
        {REFUND_TEST_SCENARIOS.map((s, i) => (
          <span key={s}>
            {i > 0 ? ", " : ""}
            <Tok>{s}</Tok>
          </span>
        ))}
        .
      </p>
      <p>The catalogue is also readable from the API, so a test harness never has to hardcode it:</p>
      <Code caption="GET /v1/test/scenarios — test keys only" code={LIST} />

      <Note tone="warn" title="Test mode only">
        <Tok>test_scenario</Tok> is rejected outright with a live key — it is never silently ignored. Strip the field in your production code path rather than relying on the
        environment.
      </Note>
      <Code caption="400 Bad Request — live key" code={LIVE_REJECT} />

      <H2 id="hosted-page">Hosted-page simulation</H2>
      <p>
        Redirect and QR rails do not resolve inside the create request. With <Tok>test_scenario: &quot;requires_action&quot;</Tok> the payment comes back as{" "}
        <Tok>processing</Tok> and carries a <Tok>next_action</Tok> object pointing at a sandbox hosted page that stands in for the provider one.
      </p>
      <Code caption="201 Created — requires_action" code={REQUIRES_ACTION} />
      <p>
        Open <Tok>next_action.url</Tok> in a browser. The page is a simulation of a provider checkout: it shows the reference and amount, and offers <strong>approve</strong> or{" "}
        <strong>decline</strong>. Choosing one makes the demo provider send a signed notification back to NATIO exactly as a real provider would, which moves the payment to{" "}
        <Tok>successful</Tok> or <Tok>failed</Tok> and emits the corresponding webhook event. Nothing is polled by your code: the transition arrives as an event.
      </p>
      <p>
        The QR provider returns the same flow with a <Tok>qr_code</Tok> action instead. <Tok>qrPayload</Tok> is the string you would render as a QR image for the customer;{" "}
        <Tok>url</Tok> is the simulation page that completes it.
      </p>
      <Code caption="next_action for a QR rail" code={QR_ACTION} />
      <DocTable
        columns={["Field", "Present on", "Meaning"]}
        rows={[
          [<Tok key="t">type</Tok>, "all", <>One of <Tok key="a">redirect</Tok>, <Tok key="b">qr_code</Tok>, <Tok key="c">display_details</Tok>.</>],
          [<Tok key="u">url</Tok>, "redirect, qr_code", "Where the customer completes the payment. In the sandbox this is the simulation page."],
          [<Tok key="q">qrPayload</Tok>, "qr_code", "The payload to encode into a QR image."],
          [<Tok key="e">expiresAt</Tok>, "all", "After this instant the action can no longer be completed and the payment expires."],
        ]}
      />
      <Note tone="info" title="Return URL">
        Send <Tok>return_url</Tok> on the create request to control where the customer lands after the action. Treat that redirect as a navigation hint only — the payment status
        is whatever the API and the webhook say it is, never what a query parameter on the return URL claims.
      </Note>

      <H2 id="provider-report">Sandbox provider report (CSV)</H2>
      <p>
        Reconciliation is only meaningful if there is a second source of truth to compare against. Each demo provider account keeps its own ledger and can export it as a CSV in
        the same shape a real provider delivers a transaction or settlement report, so the whole reconciliation flow can be exercised end to end.
      </p>
      <p>
        Download it from <Link href="/dashboard/reconciliation">Reconciliation</Link> in the dashboard, per demo provider account, in test mode. Upload it back on the same page to
        run a reconciliation batch.
      </p>
      <Code caption="provider-report-pa_….csv" code={CSV} />
      <DocTable
        columns={["Column", "Meaning"]}
        rows={[
          [<Tok key="a">provider_reference</Tok>, "The provider side identifier of the movement. This is the primary key of the match."],
          [<Tok key="b">natio_reference</Tok>, "The NATIO object the provider recorded against the movement, when it carried one. Used as the fallback match."],
          [<Tok key="c">type</Tok>, <>The kind of movement: <Tok key="t1">payment</Tok>, <Tok key="t2">refund</Tok> or <Tok key="t3">payout</Tok>.</>],
          [<Tok key="d">amount</Tok>, "Integer in the minor unit of the currency, like every amount in the API."],
          [<Tok key="e">currency</Tok>, "ISO 4217 code."],
          [<Tok key="f">status</Tok>, "The status as the provider reports it. Pending and authorised records are not exported; only movements that reached a final state are."],
        ]}
      />
      <p>
        A batch classifies every line as matched, missing on the NATIO side, missing on the provider side, an amount mismatch or a status mismatch. Uploading the demo CSV
        unchanged should produce a clean match; editing an amount or deleting a line is the fastest way to see how each exception is reported before you wire up a real provider
        feed.
      </p>

      <H2 id="coverage">Suggested coverage</H2>
      <p>A sandbox run that exercises these scenarios covers every branch most integrations need:</p>
      <DocTable
        columns={["What you are proving", "Scenario"]}
        rows={[
          ["The happy path and the ledger line it produces", <Tok key="a">success</Tok>],
          ["Manual capture, and cancelling an authorisation instead", <Tok key="b">authorize</Tok>],
          ["Redirect or QR handling, and the event that resolves it", <Tok key="c">requires_action</Tok>],
          ["Soft declines cascading to another provider", <Tok key="d">soft_decline</Tok>],
          ["Hard declines shown to the customer without a retry", <Tok key="e">hard_decline</Tok>],
          ["Technical failover between providers inside one request", <Tok key="f">failover</Tok>],
          ["Timeouts, including the no-double-charge recovery path", <>
            <Tok key="g">timeout</Tok>, <Tok key="h">timeout_recovered</Tok>
          </>],
          ["A provider being down entirely", <Tok key="i">unavailable</Tok>],
          ["Your handling of a terminal failure after every provider is exhausted", <Tok key="j">all_fail</Tok>],
          ["Payments held for manual review, and payments refused by risk", <>
            <Tok key="k">review</Tok>, <Tok key="l">block</Tok>
          </>],
        ]}
      />
    </>
  );
}
