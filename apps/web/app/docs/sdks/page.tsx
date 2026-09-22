import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocTable, H2, H3, Note, Tok } from "@/components/docs/parts";

export const metadata: Metadata = {
  title: "SDKs & clients",
  description: "There are no official NATIO SDKs yet. Generate a client from the published OpenAPI 3.1 document, or copy the minimal typed TypeScript fetch wrapper on this page.",
};

const GEN_TS = `# Types only, from the published spec — no runtime dependency.
npx openapi-typescript https://api.natio.me/openapi.json -o src/natio-api.d.ts

# Then type your own fetch calls against it:
#   import type { components } from "./natio-api";
#   type Payment = components["schemas"]["Payment"];`;

const GEN_OTHER = `# A full client in almost any language (Java, Go, Python, C#, PHP, Ruby, Rust...).
npx @openapitools/openapi-generator-cli generate \\
  -i https://api.natio.me/openapi.json \\
  -g typescript-fetch \\
  -o ./natio-client

# Same command, different target:
#   -g python        -o ./natio-python
#   -g go            -o ./natio-go
#   -g java          -o ./natio-java`;

const CLIENT = `// natio.ts — a complete, dependency-free NATIO client.
// Requires a runtime with global fetch (Node 18+, Deno, Bun, Cloudflare Workers).

// ---------------------------------------------------------------------------
// Types. Only the fields this wrapper touches are modelled; the API returns more.
// ---------------------------------------------------------------------------
export type Mode = "test" | "live";

export type PaymentStatus =
  | "created"
  | "pending"
  | "processing"
  | "authorized"
  | "captured"
  | "successful"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type PaymentMethodType = "card" | "bank_transfer" | "qr" | "open_banking" | "wallet" | "instant" | "local";

export type FailureCategory = "soft" | "hard" | "technical" | "policy";

export interface Failure {
  code: string;
  category: FailureCategory;
  message: string;
}

export interface NextAction {
  type: "redirect" | "qr_code" | "display_details";
  url?: string;
  qrPayload?: string;
  expiresAt?: string;
}

export interface Attempt {
  id: string;
  attempt_number: number;
  status: "created" | "processing" | "unknown" | "authorized" | "succeeded" | "failed" | "cancelled";
  outcome: "success" | "requires_action" | "soft_decline" | "hard_decline" | "technical_error" | "timeout" | "provider_unavailable" | "unknown" | null;
  provider_name: string | null;
  provider_code: string | null;
  provider_message: string | null;
  provider_payment_id: string | null;
  failure: Failure | null;
  fee_amount: number;
  latency_ms: number | null;
  created_at: string;
}

export interface Route {
  provider: { id: string; code: string; name: string } | null;
  provider_account_id: string | null;
  provider_payment_id: string | null;
  attempts: number;
  routing_decision_id: string | null;
  rule: string | null;
}

export interface Payment {
  id: string;
  object: "payment";
  mode: Mode;
  status: PaymentStatus;
  amount: number;
  currency: string;
  captured_amount: number;
  refunded_amount: number;
  capture_method: "automatic" | "manual";
  payment_method: { type: PaymentMethodType; id: string | null };
  country: string | null;
  description: string | null;
  reference: string | null;
  metadata: Record<string, unknown>;
  route: Route;
  failure: Failure | null;
  next_action: NextAction | null;
  fee: { amount: number; currency: string };
  attempts: Attempt[];
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface Refund {
  id: string;
  object: "refund";
  mode: Mode;
  payment_id: string;
  amount: number;
  currency: string;
  status: "created" | "processing" | "successful" | "failed";
  reason: string | null;
  failure: Failure | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  payment_method: PaymentMethodType | { type: PaymentMethodType; token?: string; id?: string };
  capture_method?: "automatic" | "manual";
  country?: string;
  customer?: { id?: string; external_id?: string; email?: string; name?: string; country?: string };
  description?: string;
  reference?: string;
  return_url?: string;
  metadata?: Record<string, string | number | boolean | null>;
  /** Test keys only. */
  test_scenario?: string;
}

export interface ListPaymentsQuery {
  status?: string;
  currency?: string;
  country?: string;
  payment_method?: string;
  reference?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface RefundInput {
  amount?: number;
  reason?: string;
  metadata?: Record<string, string | number | boolean | null>;
  test_scenario?: "success" | "technical_error" | "hard_decline";
}

// ---------------------------------------------------------------------------
// Typed error. Every NATIO error body has this shape.
// ---------------------------------------------------------------------------
export interface ErrorBody {
  error: {
    type: string;
    code: string;
    message: string;
    param?: string;
    details?: unknown;
  };
  request_id?: string;
}

export class NatioApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly param?: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: ErrorBody, requestId?: string) {
    super(body.error.message);
    this.name = "NatioApiError";
    this.status = status;
    this.type = body.error.type;
    this.code = body.error.code;
    this.param = body.error.param;
    this.details = body.error.details;
    this.requestId = body.request_id ?? requestId;
  }

  /** True while retrying with the same Idempotency-Key can still succeed. */
  get retryable(): boolean {
    return this.status === 429 || this.status === 503 || this.code === "idempotency_in_progress";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export interface NatioOptions {
  apiKey: string;
  baseUrl?: string;
  /** Milliseconds before a request is aborted. Default 30s. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  /** Send on every mutating call. Retries with the same key replay the stored response. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class Natio {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: NatioOptions) {
    if (!options.apiKey) throw new Error("NATIO: apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.natio.me").replace(/\\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // -- payments -------------------------------------------------------------

  createPayment(input: CreatePaymentInput, options: RequestOptions = {}): Promise<Payment> {
    return this.request<Payment>("POST", "/v1/payments", { body: input, ...options });
  }

  getPayment(id: string, options: RequestOptions = {}): Promise<Payment> {
    return this.request<Payment>("GET", \`/v1/payments/\${encodeURIComponent(id)}\`, options);
  }

  listPayments(query: ListPaymentsQuery = {}, options: RequestOptions = {}): Promise<Page<Payment>> {
    return this.request<Page<Payment>>("GET", \`/v1/payments\${queryString(query)}\`, options);
  }

  capturePayment(id: string, amount?: number, options: RequestOptions = {}): Promise<Payment> {
    return this.request<Payment>("POST", \`/v1/payments/\${encodeURIComponent(id)}/capture\`, {
      body: amount === undefined ? {} : { amount },
      ...options,
    });
  }

  cancelPayment(id: string, reason?: string, options: RequestOptions = {}): Promise<Payment> {
    return this.request<Payment>("POST", \`/v1/payments/\${encodeURIComponent(id)}/cancel\`, {
      body: reason === undefined ? {} : { reason },
      ...options,
    });
  }

  refund(paymentId: string, input: RefundInput = {}, options: RequestOptions = {}): Promise<Refund> {
    return this.request<Refund>("POST", \`/v1/payments/\${encodeURIComponent(paymentId)}/refund\`, { body: input, ...options });
  }

  /** Walks every page of a payment list. */
  async *eachPayment(query: ListPaymentsQuery = {}): AsyncGenerator<Payment> {
    let cursor = query.cursor;
    do {
      const page = await this.listPayments({ ...query, cursor });
      for (const payment of page.data) yield payment;
      cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
    } while (cursor);
  }

  // -- transport ------------------------------------------------------------

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions & { body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: \`Bearer \${this.apiKey}\`,
      accept: "application/json",
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (options.signal) options.signal.addEventListener("abort", () => controller.abort(), { once: true });

    let res: Response;
    try {
      res = await this.fetchImpl(\`\${this.baseUrl}\${path}\`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const requestId = res.headers.get("x-request-id") ?? undefined;
    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : null;

    if (!res.ok) throw new NatioApiError(res.status, parsed as ErrorBody, requestId);
    return parsed as T;
  }
}

function queryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? \`?\${qs}\` : "";
}`;

const USAGE = `import { Natio, NatioApiError } from "./natio";

const natio = new Natio({ apiKey: process.env.NATIO_API_KEY! });

try {
  const payment = await natio.createPayment(
    {
      amount: 10000,          // 100.00 USD — integer minor units
      currency: "USD",
      payment_method: "card",
      country: "US",
      reference: "ORD-1001",
      customer: { external_id: "cust_42", email: "buyer@example.com" },
    },
    { idempotencyKey: "order-1001" },  // safe to retry this exact call
  );

  if (payment.next_action) {
    // Redirect or QR rail: hand the action to the customer, then wait for the webhook.
    return redirectTo(payment.next_action.url!);
  }

  if (payment.status === "failed" && payment.failure) {
    // Hard declines are final; soft and technical failures already cascaded across providers.
    return payment.failure.category === "hard" ? offerAnotherMethod() : askToRetry();
  }

  console.log(payment.status, payment.route.provider?.name, payment.route.attempts);

  // Later, a partial refund with its own idempotency key.
  const refund = await natio.refund(payment.id, { amount: 2500, reason: "customer_request" }, { idempotencyKey: \`refund-\${payment.id}-1\` });
  console.log(refund.status);
} catch (err) {
  if (err instanceof NatioApiError) {
    // Always log the request id — it is what support needs.
    console.error(err.status, err.code, err.message, err.requestId);
    if (err.retryable) scheduleRetry();
  } else {
    throw err;
  }
}

// Paging without cursor bookkeeping.
for await (const p of natio.eachPayment({ status: "failed", limit: 100 })) {
  await analyse(p);
}`;

export default function SdksPage() {
  return (
    <>
      <DocHeader
        eyebrow="Reference"
        title="SDKs and clients"
        lead="There are no official NATIO SDKs yet. The API is deliberately plain HTTP and JSON, and the full OpenAPI 3.1 document is published, so a generated client or a small hand-written wrapper is all you need."
      />

      <Note tone="warn" title="No official SDKs at this time">
        NATIO does not currently publish or maintain client libraries for any language. Nothing on this page is a NATIO-supported package: the generators below are third-party
        tools, and the wrapper further down is example code for you to copy into your own repository and own.
      </Note>

      <H2 id="spec">The OpenAPI document</H2>
      <p>
        The machine-readable contract is the source of truth for everything in this portal. It is OpenAPI 3.1, it is generated from the API itself rather than maintained by
        hand, and it is served without authentication.
      </p>
      <Code
        caption="Fetch the spec"
        code={`# On the website origin
curl -s https://natio.me/openapi.json

# Or directly from the API
curl -s https://api.natio.me/openapi.json`}
      />
      <p>
        The same document is rendered, endpoint by endpoint, in the <Link href="/docs/api-reference">API reference</Link> — including the server list, the security scheme, every
        parameter and every response code.
      </p>

      <H2 id="generate">Generating a client</H2>
      <H3 id="typescript">TypeScript types</H3>
      <p>
        If you already have a fetch layer, the lightest option is to generate types only and keep your own transport. No runtime dependency is added.
      </p>
      <Code caption="openapi-typescript" code={GEN_TS} />
      <H3 id="full-client">A full client, any language</H3>
      <Code caption="openapi-generator" code={GEN_OTHER} />
      <DocTable
        columns={["Tool", "Produces", "Good when"]}
        rows={[
          ["openapi-typescript", "TypeScript type declarations only", "You want typing without a generated runtime, and you already wrap fetch."],
          ["openapi-generator", "A full client with models and a transport layer", "You want method calls out of the box, or you are not in TypeScript."],
          ["Your own wrapper", "Exactly the surface your codebase needs", "You use a handful of endpoints — which is most integrations. Start from the code below."],
        ]}
      />
      <Note tone="info" title="Whatever you generate, keep these three things">
        Send an <Tok>Idempotency-Key</Tok> on every mutating call; log <Tok>x-request-id</Tok> from every response; and branch on <Tok>error.code</Tok> and{" "}
        <Tok>failure.category</Tok>, never on message text. Generators do not do any of that for you.
      </Note>

      <H2 id="wrapper">A minimal typed TypeScript client</H2>
      <p>
        Complete and dependency-free: create, read and list payments, capture, cancel and refund, idempotency-key support, a request timeout, cursor paging and a typed error
        class. Copy it into your project as <Tok>natio.ts</Tok> and extend it as you need more endpoints.
      </p>
      <Code caption="natio.ts" code={CLIENT} />

      <H3 id="usage">Using it</H3>
      <Code caption="Example" code={USAGE} />
      <p>
        Two details are worth keeping when you adapt this. The idempotency key is derived from <em>your</em> identifier for the operation, not generated per call — that is what
        makes a retry a replay instead of a second payment. And an error thrown by the transport (<Tok>NatioApiError</Tok>) is a different thing from a payment whose{" "}
        <Tok>status</Tok> is <Tok>failed</Tok>; the two are handled in different places above for exactly that reason. Both are covered in{" "}
        <Link href="/docs/errors">Errors and failure codes</Link>.
      </p>

      <H2 id="webhook-receiver">Receiving webhooks</H2>
      <p>
        A client library does not help with the other half of the integration. Signature verification is a dozen lines and is given in full, in Node and Python, in{" "}
        <Link href="/docs/webhooks">Webhooks</Link> — including the one rule that a generated client will never enforce for you: verify against the raw request body.
      </p>
    </>
  );
}
