import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, H2, H3, Note, Tok } from "@/components/docs/parts";
import { WEBHOOK_EVENT_DESCRIPTIONS, WEBHOOK_EVENT_TYPES, WEBHOOK_RETRY_SCHEDULE } from "@/components/docs/data";

export const metadata: Metadata = {
  title: "Webhooks",
  description: "Event types, the payload envelope, Natio-Signature verification in Node and Python, the retry schedule, delivery history and manual resend, and receiver best practices.",
};

const ENVELOPE = `{
  "id": "evt_8sQ1mB4nZpL2xR7wT0dK",
  "type": "payment.successful",
  "mode": "test",
  "created_at": "2026-09-22T02:10:34.159Z",
  "data": {
    "object": {
      "id": "pay_lfsWb45Pf5wJ1ZGgROzH",
      "object": "payment",
      "mode": "test",
      "status": "successful",
      "amount": 10000,
      "currency": "USD",
      "captured_amount": 10000,
      "refunded_amount": 0,
      "reference": "ORD-1001",
      "route": {
        "provider": { "code": "demo_acquirer_b", "name": "NATIO Demo Acquirer B" },
        "attempts": 2,
        "rule": "Cards → Acquirer A, fallback Acquirer B"
      },
      "failure": null,
      "created_at": "2026-09-22T02:10:33.845Z"
    }
  }
}`;

const HEADERS = `POST /webhooks/natio HTTP/1.1
content-type: application/json
user-agent: NATIO-Webhooks/1.0
natio-signature: t=1758507034,v1=9f2c1b...c47a
natio-event-id: evt_8sQ1mB4nZpL2xR7wT0dK
natio-event-type: payment.successful
natio-delivery-id: whd_3pQ8xV2kR9mL1nW6tY4z
natio-delivery-attempt: 1`;

const NODE = `import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300; // 5 minutes

/**
 * Verify a Natio-Signature header against the RAW request body.
 * @param {string} rawBody  the exact bytes NATIO sent, as a string
 * @param {string} header   the value of the Natio-Signature header
 * @param {string} secret   your endpoint signing secret (whsec_...)
 */
export function verifyNatioSignature(rawBody, header, secret) {
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );

  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;

  // Reject replays: the timestamp is signed, so it cannot be tampered with.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Express: express.raw() keeps the body as a Buffer, so nothing re-serialises it.
// ---------------------------------------------------------------------------
import express from "express";

const app = express();
const seen = new Set(); // replace with a durable store keyed on event id

app.post("/webhooks/natio", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body.toString("utf8");

  if (!verifyNatioSignature(rawBody, req.get("natio-signature"), process.env.NATIO_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }

  const event = JSON.parse(rawBody);

  // 1. Acknowledge immediately — do not process inside the request.
  res.sendStatus(200);

  // 2. Deduplicate on the event id: the same event can arrive more than once.
  if (seen.has(event.id)) return;
  seen.add(event.id);

  // 3. Hand off to your queue.
  void enqueue(event);
});

app.listen(3000);`;

const PYTHON = `import hashlib
import hmac
import json
import time

TOLERANCE_SECONDS = 300  # 5 minutes


def verify_natio_signature(raw_body: bytes, header: str | None, secret: str) -> bool:
    """Verify a Natio-Signature header against the RAW request body."""
    if not header:
        return False

    parts = {}
    for kv in header.split(","):
        key, _, value = kv.partition("=")
        parts[key.strip()] = value.strip()

    try:
        t = int(parts["t"])
        v1 = parts["v1"]
    except (KeyError, ValueError):
        return False

    # Reject replays.
    if abs(int(time.time()) - t) > TOLERANCE_SECONDS:
        return False

    signed_payload = f"{t}.".encode("utf-8") + raw_body
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


# ---------------------------------------------------------------------------
# Flask: request.get_data() returns the raw bytes, before any JSON parsing.
# ---------------------------------------------------------------------------
import os

from flask import Flask, request

app = Flask(__name__)
seen = set()  # replace with a durable store keyed on event id


@app.post("/webhooks/natio")
def natio_webhook():
    raw_body = request.get_data()

    if not verify_natio_signature(raw_body, request.headers.get("Natio-Signature"), os.environ["NATIO_WEBHOOK_SECRET"]):
        return "", 400

    event = json.loads(raw_body)

    if event["id"] not in seen:
        seen.add(event["id"])
        enqueue(event)  # process asynchronously

    return "", 200`;

const TEST_EVENT = `curl -X POST https://api.natio.me/v1/webhooks/test \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "event_type": "payment.successful" }'`;

export default function WebhooksPage() {
  return (
    <>
      <DocHeader
        eyebrow="Guides"
        title="Webhooks"
        lead="Webhooks are how your systems learn that something changed without polling. Every event is persisted before any delivery is attempted, every delivery is signed, and every attempt is recorded and replayable."
      />

      <H2 id="event-types">Event types</H2>
      <p>
        An endpoint subscribes to a list of event types, or to <Tok>*</Tok> for all of them. Unknown types are rejected when the endpoint is saved, so a typo fails loudly rather
        than silently dropping traffic.
      </p>
      <DocTable
        columns={["Event type", "Sent when"]}
        rows={WEBHOOK_EVENT_TYPES.map((t) => [<Tok key={t}>{t}</Tok>, WEBHOOK_EVENT_DESCRIPTIONS[t] ?? ""])}
      />
      <Note tone="info" title="Subscribe narrowly">
        Most integrations need only the terminal events: <Tok>payment.successful</Tok>, <Tok>payment.failed</Tok>, <Tok>payment.cancelled</Tok>,{" "}
        <Tok>payment.refunded</Tok> and the refund and payout results. Subscribing to everything multiplies deliveries without adding information.
      </Note>

      <H2 id="envelope">Payload envelope</H2>
      <p>
        Every delivery has the same top-level shape. The object that changed is always nested under <Tok>data.object</Tok> and is the same serialisation you get from the
        corresponding API endpoint, so one code path can handle both.
      </p>
      <Code caption="Request body" code={ENVELOPE} />
      <DocTable
        columns={["Field", "Meaning"]}
        rows={[
          [<Tok key="a">id</Tok>, <>Event id, prefixed <Tok key="b">evt_</Tok>. Stable across every delivery attempt and every endpoint. Deduplicate on this.</>],
          [<Tok key="c">type</Tok>, "The event type from the table above."],
          [<Tok key="d">mode</Tok>, <><Tok key="e">test</Tok> or <Tok key="f">live</Tok>. Endpoints are per mode, so this should always match the endpoint you registered.</>],
          [<Tok key="g">created_at</Tok>, "When the event was emitted, ISO 8601 UTC. Not when this delivery attempt was made."],
          [<Tok key="h">data.object</Tok>, "The payment, refund, payout or settlement object as it stood when the event was emitted."],
        ]}
      />
      <p>Alongside the body, each request carries identifying headers:</p>
      <Code caption="Delivery headers" code={HEADERS} />
      <DocTable
        columns={["Header", "Meaning"]}
        rows={[
          [<Tok key="a">natio-signature</Tok>, <>The signature to verify: <Tok key="s">t=&lt;unix&gt;,v1=&lt;hex&gt;</Tok>.</>],
          [<Tok key="b">natio-event-id</Tok>, "The event id, matching id in the body."],
          [<Tok key="c">natio-event-type</Tok>, "The event type, for cheap routing before parsing."],
          [<Tok key="d">natio-delivery-id</Tok>, "This delivery to this endpoint. Quote it in support requests about a missing webhook."],
          [<Tok key="e">natio-delivery-attempt</Tok>, "1-based attempt number. Anything above 1 means an earlier attempt did not get a 2xx."],
        ]}
      />

      <H2 id="signatures">Signature verification</H2>
      <p>
        Each endpoint has its own signing secret (<Tok>whsec_…</Tok>), shown once when the endpoint is created. The header is:
      </p>
      <Code caption="Natio-Signature" code={`Natio-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`} />
      <p>To verify:</p>
      <ol className="mb-4 list-decimal pl-5 text-[15px] leading-7 text-mist-200">
        <li>
          Split the header on commas into <Tok>t</Tok> and <Tok>v1</Tok>.
        </li>
        <li>
          Reject the request if <Tok>t</Tok> is more than <strong>5 minutes</strong> away from your current time, in either direction. The timestamp is inside the signed payload,
          so an attacker cannot move it.
        </li>
        <li>
          Compute <Tok>HMAC-SHA256(secret, &quot;&lt;t&gt;.&lt;raw body&gt;&quot;)</Tok> and hex-encode it.
        </li>
        <li>
          Compare it to <Tok>v1</Tok> with a constant-time comparison.
        </li>
      </ol>
      <Note tone="bad" title="Use the raw body, always">
        The signature covers the exact bytes NATIO sent. If a body parser has already turned the request into an object, re-serialising it changes whitespace, key order and
        number formatting, and the signature will never match. Capture the raw buffer before any JSON middleware runs, and keep it as bytes or as a UTF-8 string — never as a
        parsed object.
      </Note>
      <H3 id="node">Node</H3>
      <Code caption="Node — node:crypto" code={NODE} />
      <H3 id="python">Python</H3>
      <Code caption="Python — hmac / hashlib" code={PYTHON} />

      <H2 id="retries">Retry schedule</H2>
      <p>
        A delivery succeeds on any <Tok>2xx</Tok>. Anything else — a 4xx, a 5xx, a connection error or a timeout — is a failure and is retried with a fixed backoff. Redirects are
        not followed.
      </p>
      <DocTable columns={["Attempt", "Sent"]} rows={WEBHOOK_RETRY_SCHEDULE.map((r) => [<Tok key={r.attempt}>{r.attempt}</Tok>, r.delay])} />
      <p>
        The maximum number of attempts is configurable per deployment and defaults to <strong>6</strong>. When it is reached, the delivery is marked{" "}
        <Tok>exhausted</Tok> and stops. The event itself is never lost: it remains in the delivery history and can be resent manually.
      </p>
      <DocTable
        columns={["Delivery status", "Meaning"]}
        rows={[
          [<Tok key="a">pending</Tok>, "Queued, not yet attempted, or waiting for its next scheduled attempt."],
          [<Tok key="b">delivering</Tok>, "An attempt is in flight. A delivery is claimed before sending, so it is never sent twice concurrently."],
          [<Tok key="c">succeeded</Tok>, "A 2xx was received. No further attempts."],
          [<Tok key="d">failed</Tok>, "The last attempt did not succeed and another one is scheduled."],
          [<Tok key="e">exhausted</Tok>, "The attempt limit was reached. Only a manual resend will try again."],
        ]}
      />
      <Note tone="warn" title="Respond fast">
        Deliveries time out server-side. If your handler does real work before answering — writing to a database, calling another service — a slow dependency turns into a failed
        delivery and a retry storm. Answer 2xx first, process afterwards.
      </Note>

      <H2 id="history">Delivery history and manual resend</H2>
      <p>
        Every delivery and every individual attempt is stored: the request headers that were sent (with the signature truncated), the response status, the response body up to 2
        KB, the error if the request never completed, and the duration. Open{" "}
        <Link href="/dashboard/webhooks">Webhooks</Link> in the dashboard to inspect them.
      </p>
      <ul>
        <li>Filter deliveries by endpoint, event type and status to find what did not land.</li>
        <li>Open a delivery to see the exact payload that was sent and the response your server returned on each attempt.</li>
        <li>
          <strong>Resend</strong> replays that delivery immediately with the same event id and the same payload. It is safe precisely because you deduplicate on the event id.
        </li>
        <li>Resending works even for an exhausted delivery, and even while the endpoint is disabled, so you can fix a receiver and then replay what it missed.</li>
      </ul>

      <H3 id="test-events">Sending a test event</H3>
      <p>
        <Tok>POST /v1/webhooks/test</Tok> emits an event of the type you name to the endpoints registered for that key, so you can build and debug a receiver without creating
        payments.
      </p>
      <Code caption="Test event" code={TEST_EVENT} />
      <p>
        The test event is signed and delivered exactly like a real one, including retries and delivery history. There is also a test button on each endpoint in the dashboard.
      </p>

      <H2 id="best-practices">Best practices</H2>
      <DocTable
        columns={["Rule", "Why"]}
        rows={[
          ["Respond 2xx in milliseconds, process asynchronously", "The delivery times out server-side. Acknowledge, enqueue, return. Never do business logic inside the request."],
          [
            <>
              Deduplicate on <Tok key="a">event.id</Tok>
            </>,
            "Delivery is at-least-once. Retries, manual resends and network ambiguity all produce repeats of the same event id.",
          ],
          ["Make the handler idempotent", "Deduplication is a cache, not a guarantee. Writing the same terminal state twice must be harmless."],
          [
            <>
              Verify before you parse, and use the raw body
            </>,
            "An unverified payload is untrusted input. Parsing first also tempts you to re-serialise, which breaks the signature.",
          ],
          ["Ignore event types you do not handle", "New event types can appear. Return 2xx for them rather than 400, or you will generate retries for events you do not care about."],
          [
            <>
              Treat the event as a notification, not as the truth
            </>,
            <>
              Events can arrive out of order. When ordering matters, re-read the object with <Tok key="b">GET /v1/payments/{"{id}"}</Tok> and act on that.
            </>,
          ],
          ["Store the delivery id you received", "It is the fastest way to have one specific delivery investigated."],
          ["Keep the endpoint on HTTPS and publicly reachable", "Endpoint URLs are validated when saved; private and loopback addresses are refused in production."],
          ["Rotate the signing secret like an API key", "Create the new endpoint, run both, move traffic, delete the old one."],
        ]}
      />
    </>
  );
}
