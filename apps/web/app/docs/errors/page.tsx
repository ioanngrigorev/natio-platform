import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, H2, H3, Note, Tok } from "@/components/docs/parts";
import { ERROR_CODES, ERROR_TYPES, FAILURE_CATEGORIES, FAILURE_CODES } from "@/components/docs/data";

export const metadata: Metadata = {
  title: "Errors & failure codes",
  description: "The NATIO error envelope, error types mapped to HTTP status codes, the common error codes, and the full normalised failure dictionary grouped by retry category.",
};

const ENVELOPE = `{
  "error": {
    "type": "invalid_request_error",
    "code": "validation_failed",
    "message": "body.currency: unsupported currency",
    "param": "currency",
    "details": [
      { "path": "currency", "message": "unsupported currency", "code": "custom" }
    ]
  },
  "request_id": "req_0uwP4ioIZ8q8dgBW"
}`;

const FAILURE = `{
  "id": "pay_Bu0waXeXrCN5FbyPnbzy",
  "status": "failed",
  "failure": {
    "code": "stolen_card",
    "category": "hard",
    "message": "Stolen card, pick up"
  },
  "route": {
    "provider": { "code": "demo_acquirer_a", "name": "NATIO Demo Acquirer A" },
    "attempts": 1,
    "rule": "Cards → Acquirer A, fallback Acquirer B"
  }
}`;

const HANDLE = `const res = await fetch("https://api.natio.me/v1/payments", init);
const body = await res.json();

if (!res.ok) {
  // Transport-level error: the payment was not created.
  switch (body.error.code) {
    case "idempotency_in_progress":
      return retryShortly();                 // the first call is still running
    case "rate_limited":
      return backOff(res.headers.get("x-ratelimit-reset"));
    case "validation_failed":
      throw new BugInOurCode(body.error.details);
    default:
      throw new NatioError(body.error, body.request_id);
  }
}

// The call succeeded. The payment may still have failed.
if (body.status === "failed") {
  switch (body.failure.category) {
    case "hard":
      return declineCheckout(body.failure.code);   // never retry this instrument
    case "policy":
      return escalate(body.failure.code);          // configuration or risk, not the customer
    default:
      return offerAnotherMethod(body.failure.code); // soft / technical: already cascaded
  }
}`;

const TONE: Record<string, "ok" | "bad" | "warn" | "info"> = {
  soft: "warn",
  hard: "bad",
  technical: "info",
  policy: "ok",
};

export default function ErrorsPage() {
  return (
    <>
      <DocHeader
        eyebrow="Guides"
        title="Errors and failure codes"
        lead="NATIO separates two different things. An error means the API refused the request. A failure means the request was accepted and the money movement did not happen. They have different shapes, and they need different handling."
      />

      <H2 id="envelope">The error envelope</H2>
      <p>Every error response, at every status code, has the same shape:</p>
      <Code caption="422 Unprocessable Entity" code={ENVELOPE} />
      <DocTable
        columns={["Field", "Always present", "Meaning"]}
        rows={[
          [<Tok key="a">error.type</Tok>, "yes", "The broad class of error. Maps to the HTTP status."],
          [<Tok key="b">error.code</Tok>, "yes", "The stable machine-readable identifier. Branch on this and nothing else."],
          [<Tok key="c">error.message</Tok>, "yes", "A human sentence for logs and for your own operators. Wording can change; never parse it."],
          [<Tok key="d">error.param</Tok>, "no", "The request field that caused the error, when a single field is responsible."],
          [<Tok key="e">error.details</Tok>, "no", "Structured detail. For validation errors, one entry per failing path."],
          [<Tok key="f">request_id</Tok>, "yes", <>Matches the <Tok key="g">x-request-id</Tok> response header. Quote it in support requests.</>],
        ]}
      />

      <H2 id="error-types">Error types and HTTP status</H2>
      <DocTable columns={["error.type", "HTTP status", "Meaning"]} rows={ERROR_TYPES.map((t) => [<Tok key={t.type}>{t.type}</Tok>, <span key={`${t.type}-s`} className="whitespace-nowrap font-mono text-[12px]">{t.status}</span>, t.meaning])} />

      <H2 id="error-codes">Common error codes</H2>
      <DocTable
        columns={["code", "type", "Status", "Message"]}
        rows={ERROR_CODES.map((c) => [
          <Tok key={c.code}>{c.code}</Tok>,
          <span key={`${c.code}-t`} className="font-mono text-[11.5px] text-mist-400">
            {c.type}
          </span>,
          <span key={`${c.code}-s`} className="font-mono text-[12px]">
            {c.status}
          </span>,
          c.message,
        ])}
      />
      <Note tone="info" title="Retry rules for errors">
        <Tok>429</Tok> and <Tok>503</Tok> are worth retrying with backoff, and <Tok>409 idempotency_in_progress</Tok> is worth retrying shortly. Every <Tok>4xx</Tok> that
        describes the request itself — validation, an invalid key, an IP that is not allowed, a reused idempotency key — will produce the same answer forever. Retrying is safe
        only because your mutating calls carry an <Link href="/docs/payments">Idempotency-Key</Link>.
      </Note>

      <H2 id="failures">Payment failures are not errors</H2>
      <p>
        A payment that no provider would complete is still a successful API call: <Tok>201 Created</Tok>, with <Tok>status: &quot;failed&quot;</Tok> and a{" "}
        <Tok>failure</Tok> object. The same object appears on each failed entry in <Tok>attempts[]</Tok>, and on refunds and payouts that fail.
      </p>
      <Code caption="201 Created — a payment that failed" code={FAILURE} />
      <p>
        Provider codes are not returned raw as the decision: each adapter normalises the provider vocabulary into one dictionary, so{" "}
        <Tok>failure.code</Tok> means the same thing regardless of which acquirer produced it. The unmapped provider values are still available on the attempt as{" "}
        <Tok>provider_code</Tok> and <Tok>provider_message</Tok>, for provider support tickets.
      </p>

      <H2 id="categories">Categories drive retry policy</H2>
      <p>
        <Tok>failure.category</Tok> is the field that decides what happens next, inside NATIO and in your own code.
      </p>
      <DocTable
        columns={["Category", "Cascade behaviour", "What it means"]}
        rows={FAILURE_CATEGORIES.map((c) => [
          <Tok key={c.category}>{c.category}</Tok>,
          <span key={`${c.category}-r`} className="whitespace-nowrap">
            {c.retry}
          </span>,
          c.note,
        ])}
      />
      <Note tone="bad" title="Soft and technical may cascade. Hard never retries.">
        A soft decline or a technical failure lets NATIO try the next eligible provider inside the same request, which is what turns a single provider outage into a successful
        payment. A hard decline is a statement about the instrument or the customer: retrying it anywhere produces the same answer, costs a second authorisation attempt and can
        count against you at the issuer. NATIO will not do it, and neither should your code.
      </Note>

      <H2 id="dictionary">Failure dictionary</H2>
      <p>The complete set of normalised codes, grouped by category.</p>
      {FAILURE_CATEGORIES.map((cat) => {
        const codes = FAILURE_CODES.filter((f) => f.category === cat.category);
        return (
          <div key={cat.category}>
            <H3 id={`failures-${cat.category}`}>
              {cat.title}{" "}
              <span className="font-mono text-[12px] font-normal text-mist-400">
                {cat.category} · {cat.retry.toLowerCase()}
              </span>
            </H3>
            <Note tone={TONE[cat.category] ?? "info"}>{cat.note}</Note>
            <DocTable columns={["failure.code", "message"]} rows={codes.map((f) => [<Tok key={f.code}>{f.code}</Tok>, f.message])} />
          </div>
        );
      })}
      <p>
        A code that is not in this dictionary is possible in principle if a provider returns something entirely new; it is treated as a soft decline with the message{" "}
        <em>The transaction could not be completed</em>. Write your handling so that an unknown code degrades to the soft path rather than throwing.
      </p>

      <H2 id="handling">Handling both in one place</H2>
      <p>Branch on the HTTP status first, then on the failure category. Never branch on a message string.</p>
      <Code caption="Node" code={HANDLE} />
      <DocTable
        columns={["What you got", "What to tell the customer", "What to do"]}
        rows={[
          [
            <>
              <Tok key="a">failed</Tok> · <Tok key="b">hard</Tok>
            </>,
            "That payment method was declined. Offer another one.",
            "Do not retry the same instrument. Log the code for your fraud and chargeback analysis.",
          ],
          [
            <>
              <Tok key="c">failed</Tok> · <Tok key="d">soft</Tok>
            </>,
            "The payment did not go through. Try again or use another method.",
            "NATIO already cascaded across the eligible providers. A later retry can succeed; an immediate one usually will not.",
          ],
          [
            <>
              <Tok key="e">failed</Tok> · <Tok key="f">technical</Tok>
            </>,
            "Something went wrong on our side. Please try again.",
            "Every eligible provider failed technically. Alert your operators — this is an availability signal, not a customer problem.",
          ],
          [
            <>
              <Tok key="g">failed</Tok> · <Tok key="h">policy</Tok>
            </>,
            "Nothing, in most cases — this is a configuration or risk outcome.",
            <>
              Check routing coverage and provider limits for <Tok key="i">no_route_available</Tok> and <Tok key="j">unsupported_*</Tok>; check risk rules for{" "}
              <Tok key="k">risk_blocked</Tok>.
            </>,
          ],
          [
            <Tok key="l">4xx / 5xx</Tok>,
            "Nothing — the request never became a payment.",
            <>
              Fix the request, or retry with the same <Tok key="m">Idempotency-Key</Tok>. Log <Tok key="n">request_id</Tok> either way.
            </>,
          ],
        ]}
      />
      <p>
        Every failed payment also carries the whole story on its{" "}
        <Link href="/docs/payments">timeline</Link>: which providers were eligible, what each one answered and why the cascade stopped where it did.
      </p>
    </>
  );
}
