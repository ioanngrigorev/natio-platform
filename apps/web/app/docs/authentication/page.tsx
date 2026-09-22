import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, FactList, H2, H3, Note, Tok } from "@/components/docs/parts";

export const metadata: Metadata = {
  title: "Authentication",
  description: "Bearer API keys, test and live modes, key storage, rotation and revocation, per-project IP allow-lists, rate-limit headers, request ids and the 401 and 403 error shapes.",
};

const AUTH = `curl https://api.natio.me/v1/me \\
  -H "Authorization: Bearer natio_sk_test_..."`;

const ME = `{
  "merchant": { "id": "mer_...", "name": "Demo Merchant Ltd" },
  "project": { "id": "prj_...", "name": "Default" },
  "mode": "test",
  "api_key": { "id": "key_...", "prefix": "natio_sk_test_AP8j", "name": "Sandbox key" }
}`;

const HEADERS = `HTTP/1.1 201 Created
content-type: application/json; charset=utf-8
x-request-id: req_sT5KhaixXe6tNK0q
x-ratelimit-limit: 300
x-ratelimit-remaining: 293
x-ratelimit-reset: 36`;

const E401_MISSING = `{
  "error": {
    "type": "authentication_error",
    "code": "unauthorized",
    "message": "Provide your API key as \`Authorization: Bearer natio_sk_test_...\`"
  },
  "request_id": "req_pqumnNFCN09cAqT2"
}`;

const E401_INVALID = `{
  "error": {
    "type": "authentication_error",
    "code": "invalid_api_key",
    "message": "Invalid or revoked API key"
  },
  "request_id": "req_0uwP4ioIZ8q8dgBW"
}`;

const E403_IP = `{
  "error": {
    "type": "permission_error",
    "code": "ip_not_allowed",
    "message": "Request IP is not in the project allow-list"
  },
  "request_id": "req_M2XNd2ZI3qslCEU3v"
}`;

const E429 = `{
  "error": {
    "type": "rate_limit_error",
    "code": "rate_limited",
    "message": "Too many requests"
  },
  "request_id": "req_Yp3BZPrpF6EwG8WS"
}`;

const RETRY = `async function callNatio(path, init, attempt = 0) {
  const res = await fetch(\`https://api.natio.me\${path}\`, init);
  if (res.status === 429 && attempt < 3) {
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? "1");
    await new Promise((r) => setTimeout(r, Math.max(reset, 1) * 1000));
    return callNatio(path, init, attempt + 1);
  }
  return res;
}`;

export default function AuthenticationPage() {
  return (
    <>
      <DocHeader
        eyebrow="Getting started"
        title="Authentication"
        lead="Every call to the NATIO API is authenticated with a secret API key sent as a bearer token. The key alone determines the merchant, the project and whether you are in test or live mode."
      />

      <H2 id="bearer-keys">Bearer API keys</H2>
      <p>
        Send the key in the <Tok>Authorization</Tok> header. There is no other authentication scheme, no signing of API requests, and no merchant or project parameter — those are
        resolved from the key.
      </p>
      <Code caption="Authenticated request" code={AUTH} />
      <p>
        <Tok>GET /v1/me</Tok> is the cheapest way to confirm that a key works and to see exactly which merchant, project and mode it resolves to.
      </p>
      <Code caption="200 OK" code={ME} />

      <H2 id="test-vs-live">Test keys and live keys</H2>
      <p>
        A key is bound to one mode for its whole life. There is no header or parameter that switches mode; you change mode by using a different key. Test and live data are fully
        separated — a test key can never read a live payment and the reverse.
      </p>
      <DocTable
        columns={["", "natio_sk_test_…", "natio_sk_live_…"]}
        rows={[
          ["Providers reached", "NATIO demo providers only", "The licensed providers connected to your account"],
          ["Money movement", "Simulated end to end, no funds move", "Real: funds move between the merchant and licensed providers"],
          [
            <Tok key="ts">test_scenario</Tok>,
            "Accepted on payments and refunds",
            <>
              Rejected with <Tok key="e">400 test_scenario_not_allowed</Tok>
            </>,
          ],
          ["Availability", "Immediately after registration", "Issued only once merchant KYB review is approved"],
          ["Hosted pages", "Sandbox simulation pages", "Provider-hosted pages"],
        ]}
      />
      <Note tone="warn" title="Live keys require KYB approval">
        Creating a live key before the merchant record is approved is refused by the API. Build and certify the whole integration on test keys first — the request and response
        contracts are identical.
      </Note>

      <H2 id="storage">Storage, rotation and revocation</H2>
      <p>
        The secret is generated once and shown once. NATIO stores only a SHA-256 hash of it plus a short display prefix (for example <Tok>natio_sk_test_AP8j</Tok>), so a key can be
        identified in the dashboard and in audit logs without ever being readable again.
      </p>
      <FactList
        items={[
          { term: "Where it belongs", detail: <>A secrets manager or an environment variable on the server. Never in a browser, a mobile app, a repository or a log line.</> },
          { term: "Creating a key", detail: <><Link href="/dashboard/api-keys">Dashboard → API keys</Link>. Each key has a name and a mode; keys are scoped to one project.</> },
          {
            term: "Rotation",
            detail: "Create the new key, deploy it, confirm traffic has moved by watching the last-used timestamp on the old key, then revoke the old key. Both work at once, so there is no downtime window.",
          },
          { term: "Revocation", detail: <>Revoking is immediate and irreversible. The next request with that key returns <Tok>401 invalid_api_key</Tok>.</> },
          { term: "Compromise", detail: "Revoke first, investigate second. Every key creation and revocation is written to the audit trail with the acting user." },
          { term: "Least privilege", detail: "Use one key per deployed service rather than one shared key, so a rotation or a revocation never takes the whole estate down." },
        ]}
      />

      <H2 id="ip-allow-list">IP allow-list per project</H2>
      <p>
        Each project can carry an allow-list of source addresses. When the list is non-empty, any API request from an address outside it is refused before the route runs,
        regardless of whether the key is valid. An empty list means no IP restriction.
      </p>
      <p>
        Entries are exact IPv4 or IPv6 addresses, or CIDR ranges such as <Tok>203.0.113.0/24</Tok> and <Tok>2001:db8::/32</Tok>. Configure the list under project settings in the
        dashboard.
      </p>
      <Note tone="warn" title="Check your egress addresses first">
        The address NATIO sees is the public address your servers egress from, which behind a NAT gateway or a proxy is not the address of the machine making the call. Add the
        range before you enable the list, or you will lock out your own integration.
      </Note>

      <H2 id="rate-limits">Rate limits</H2>
      <p>
        API traffic is rate limited per key over a rolling one-minute window. Responses carry the state of that window, so a client should read the headers rather than hardcode a
        number.
      </p>
      <Code caption="Response headers" code={HEADERS} />
      <DocTable
        columns={["Header", "Meaning"]}
        rows={[
          [<Tok key="l">x-ratelimit-limit</Tok>, "Requests allowed in the current window."],
          [<Tok key="r">x-ratelimit-remaining</Tok>, "Requests still available in the current window."],
          [<Tok key="rs">x-ratelimit-reset</Tok>, "Seconds until the window resets."],
        ]}
      />
      <p>
        Exceeding the window returns <Tok>429</Tok> with the standard error envelope. Back off for at least <Tok>x-ratelimit-reset</Tok> seconds, then retry. Because mutating
        requests should carry an <Tok>Idempotency-Key</Tok>, retrying after a 429 is safe and cannot duplicate a payment.
      </p>
      <Code caption="429 Too Many Requests" code={E429} />
      <Code caption="Backing off on 429" code={RETRY} />

      <H2 id="request-ids">Request ids</H2>
      <p>
        Every response carries an <Tok>x-request-id</Tok> header, and every error body repeats it as a top-level <Tok>request_id</Tok> field. The same id appears in the NATIO
        server logs and in the audit trail for the action, which makes it the fastest way to have a specific call investigated.
      </p>
      <ul>
        <li>Log <Tok>x-request-id</Tok> alongside your own correlation id for every NATIO call, successful or not.</li>
        <li>
          When you open a support request, quote the <Tok>request_id</Tok>, the UTC timestamp and the object id (<Tok>pay_…</Tok>, <Tok>rf_…</Tok>, <Tok>po_…</Tok>). That triple
          identifies the call exactly; a description of the symptom does not.
        </li>
        <li>Never quote the API key itself, or any part of it beyond the visible prefix.</li>
      </ul>

      <H2 id="error-shapes">401 and 403 responses</H2>
      <p>
        Authentication and permission failures use the same envelope as every other error: an <Tok>error</Tok> object with <Tok>type</Tok>, <Tok>code</Tok> and{" "}
        <Tok>message</Tok>, plus the <Tok>request_id</Tok>. Branch on <Tok>error.code</Tok>, never on the message text.
      </p>
      <H3 id="e401">401 — authentication_error</H3>
      <p>No key was presented, or the header was not a bearer token:</p>
      <Code caption="401 Unauthorized" code={E401_MISSING} />
      <p>The key was presented but is unknown or has been revoked:</p>
      <Code caption="401 Unauthorized" code={E401_INVALID} />
      <H3 id="e403">403 — permission_error</H3>
      <p>The key is valid, but the call is not allowed from this source address:</p>
      <Code caption="403 Forbidden" code={E403_IP} />
      <p>
        The other 403 code is <Tok>forbidden</Tok>, returned when a valid key is used for something it is not entitled to — for example a test-only endpoint such as{" "}
        <Tok>GET /v1/test/scenarios</Tok> called with a live key.
      </p>
      <DocTable
        columns={["Status", "Code", "What to do"]}
        rows={[
          [<Tok key="a">401</Tok>, <Tok key="b">unauthorized</Tok>, "Fix the header. It must be exactly Authorization: Bearer <key>."],
          [<Tok key="c">401</Tok>, <Tok key="d">invalid_api_key</Tok>, "The key is wrong, revoked, or from the other environment. Do not retry; it will not recover."],
          [<Tok key="e">403</Tok>, <Tok key="f">ip_not_allowed</Tok>, "Add the calling egress range to the project allow-list."],
          [<Tok key="g">403</Tok>, <Tok key="h">forbidden</Tok>, "The endpoint is not available for this key — usually a test-only endpoint called with a live key."],
        ]}
      />
      <p>
        The full error catalogue, including the failure codes carried by failed payments, is in <Link href="/docs/errors">Errors and failure codes</Link>.
      </p>
    </>
  );
}
