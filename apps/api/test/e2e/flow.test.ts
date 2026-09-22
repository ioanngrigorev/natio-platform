import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { verifyWebhookSignature } from "../../src/lib/crypto.js";
import { drainQueues } from "../../src/lib/queue.js";
import { startTestEnv, stopTestEnv, type TestEnv } from "./setup.js";

// ---------------------------------------------------------------------------
// Shared state across the (sequential) steps of the MVP flow
// ---------------------------------------------------------------------------
let env: TestEnv;

let merchantCookie = "";
let merchantCsrf = "";
let adminCookie = "";
let adminCsrf = "";

let webhookSecret = "";
let webhookEndpointId = "";

let failoverPaymentId = "";
const failoverIdempotencyKey = `idem_failover_${Date.now()}`;

let acquirerAAccountId = "";
let acquirerBAccountId = "";

type Json = Record<string, any>;

const json = (res: LightMyRequestResponse): Json => res.json() as Json;

type Method = InjectOptions["method"];
type Payload = InjectOptions["payload"];

function inject(options: InjectOptions): Promise<LightMyRequestResponse> {
  return env.app.inject(options);
}

function apiKeyRequest(method: Method, url: string, opts: { body?: unknown; headers?: Record<string, string>; key?: string } = {}) {
  return inject({
    method,
    url,
    headers: { authorization: `Bearer ${opts.key ?? env.seed.testApiKey}`, ...(opts.headers ?? {}) },
    payload: opts.body as Payload,
  });
}

function dashboardRequest(method: Method, url: string, opts: { body?: unknown; csrf?: boolean; cookie?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.csrf !== false && method !== "GET") headers["x-csrf-token"] = merchantCsrf;
  return inject({
    method,
    url,
    headers,
    cookies: opts.cookie === false ? {} : { natio_session: merchantCookie },
    payload: opts.body as Payload,
  });
}

function adminRequest(method: Method, url: string, opts: { body?: unknown; csrf?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.csrf !== false && method !== "GET") headers["x-csrf-token"] = adminCsrf;
  return inject({
    method,
    url,
    headers,
    cookies: { natio_admin_session: adminCookie },
    payload: opts.body as Payload,
  });
}

/**
 * Every `app.inject` request comes from 127.0.0.1. The seeded risk rules count payments and
 * failures per IP, so each test payment gets its own device IP unless a test sets one on purpose.
 */
let ipSeq = 0;
function uniqueIp(): string {
  const n = ++ipSeq;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${(n & 254) + 1}`;
}

async function createPayment(body: Json, headers: Record<string, string> = {}) {
  const payload = body.device ? body : { ...body, device: { ip: uniqueIp() } };
  const res = await apiKeyRequest("POST", "/v1/payments", { body: payload, headers });
  expect(res.statusCode, res.body).toBe(201);
  return json(res);
}

async function timelineTypes(paymentId: string): Promise<string[]> {
  const res = await apiKeyRequest("GET", `/v1/payments/${paymentId}/timeline`);
  expect(res.statusCode, res.body).toBe(200);
  return (json(res).data as Array<{ type: string }>).map((e) => e.type);
}

/** Asserts that `expected` appear in `actual` in that relative order (other entries may be interleaved). */
function expectRelativeOrder(actual: string[], expected: string[]) {
  let cursor = -1;
  for (const type of expected) {
    const idx = actual.indexOf(type, cursor + 1);
    expect(idx, `expected "${type}" after position ${cursor} in [${actual.join(", ")}]`).toBeGreaterThan(cursor);
    cursor = idx;
  }
}

const cardPayment = (extra: Json = {}): Json => ({ amount: 10_000, currency: "USD", payment_method: "card", country: "US", ...extra });

/** Payload of the first (failover) payment; reused verbatim by the idempotency checks. */
const failoverPayload: Json = cardPayment({ test_scenario: "failover", reference: "ORD-FAILOVER-1", customer: { email: "buyer@example.com", name: "Buyer" }, device: { ip: "203.0.113.10" } });

beforeAll(async () => {
  env = await startTestEnv();
}, 120_000);

afterAll(async () => {
  await stopTestEnv(env);
});

describe("NATIO MVP end-to-end flow", () => {
  it("health endpoint reports a working database", async () => {
    const res = await env.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ status: "ok", checks: { database: "ok", queue: "ok" } });
  });

  // ------------------------------------------------------------------ (a) dashboard login
  it("(a) merchant can log into the dashboard and receives a session cookie + CSRF token", async () => {
    const res = await env.app.inject({ method: "POST", url: "/dashboard/auth/login", payload: { email: env.seed.merchantEmail, password: env.seed.password } });
    expect(res.statusCode, res.body).toBe(200);
    const body = json(res);
    expect(body.user.email).toBe(env.seed.merchantEmail);
    expect(body.user.role).toBe("owner");
    expect(body.merchant.id).toBe(env.seed.merchantId);
    expect(typeof body.csrf_token).toBe("string");
    expect(body.csrf_token.length).toBeGreaterThan(10);
    expect(body.permissions).toContain("webhooks.manage");
    const cookie = res.cookies.find((c) => c.name === "natio_session");
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    merchantCookie = cookie!.value;
    merchantCsrf = body.csrf_token;

    const me = await dashboardRequest("GET", "/dashboard/auth/me");
    expect(me.statusCode).toBe(200);
    expect(json(me).mode).toBe("test");
    expect(json(me).projects.map((p: Json) => p.id)).toContain(env.seed.projectId);
  });

  it("rejects a bad password and unauthenticated dashboard access", async () => {
    const bad = await env.app.inject({ method: "POST", url: "/dashboard/auth/login", payload: { email: env.seed.merchantEmail, password: "definitely-wrong" } });
    expect(bad.statusCode).toBe(401);
    const anon = await dashboardRequest("GET", "/dashboard/payments", { cookie: false });
    expect(anon.statusCode).toBe(401);
    expect(json(anon).error.code).toBe("unauthorized");
  });

  // ------------------------------------------------------------------ (b) webhook endpoint
  it("(b) creates a webhook endpoint subscribed to every event and returns the signing secret once", async () => {
    const res = await dashboardRequest("POST", "/dashboard/webhooks/endpoints", { body: { url: env.receiver.url, description: "e2e receiver", events: [] } });
    expect(res.statusCode, res.body).toBe(201);
    const body = json(res);
    expect(body.object).toBe("webhook_endpoint");
    expect(body.url).toBe(env.receiver.url);
    expect(body.mode).toBe("test");
    expect(body.project_id).toBe(env.seed.projectId);
    expect(body.events).toEqual([]);
    expect(body.status).toBe("active");
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.secret_prefix).toBe(body.secret.slice(0, 11));
    webhookSecret = body.secret;
    webhookEndpointId = body.id;

    const list = await dashboardRequest("GET", "/dashboard/webhooks/endpoints");
    expect(list.statusCode).toBe(200);
    const listed = json(list).data.find((e: Json) => e.id === webhookEndpointId);
    expect(listed).toBeDefined();
    expect(listed.secret).toBeUndefined();
  });

  // ------------------------------------------------------------------ (c) failover payment
  it("(c) processes a card payment with automatic failover from Acquirer A to Acquirer B", async () => {
    const body = await createPayment(failoverPayload, { "idempotency-key": failoverIdempotencyKey });
    failoverPaymentId = body.id;
    expect(body.id).toMatch(/^pay_/);
    expect(body.object).toBe("payment");
    expect(body.mode).toBe("test");
    expect(body.status).toBe("successful");
    expect(body.amount).toBe(10_000);
    expect(body.currency).toBe("USD");
    expect(body.captured_amount).toBe(10_000);
    expect(body.refunded_amount).toBe(0);
    expect(body.test_scenario).toBe("failover");
    expect(body.failure).toBeNull();
    expect(body.customer.email).toBe("buyer@example.com");
    expect(body.route.attempts).toBe(2);
    expect(body.route.provider.name).toBe("NATIO Demo Acquirer B");
    expect(body.route.rule).toBe("Cards → Acquirer A, fallback Acquirer B");
    expect(body.route.provider_payment_id).toMatch(/^mp_/);
    expect(body.attempts).toHaveLength(2);
    expect(body.attempts[0]).toMatchObject({ attempt_number: 1, outcome: "technical_error", status: "failed", provider_name: "NATIO Demo Acquirer A" });
    expect(body.attempts[0].failure.code).toBe("technical_error");
    expect(body.attempts[1]).toMatchObject({ attempt_number: 2, outcome: "success", status: "succeeded", provider_name: "NATIO Demo Acquirer B" });
    expect(body.attempts[1].provider_payment_id).toBe(body.route.provider_payment_id);
    // fee: 2.9% + 30 on Acquirer B
    expect(body.fee).toEqual({ amount: 290 + 30, currency: "USD" });
    expect(body.risk.score).toBe(0);
    expect(typeof body.processing_time_ms).toBe("number");
  });

  it("GET /v1/payments/{id} returns the same payment and unknown ids are 404", async () => {
    const res = await apiKeyRequest("GET", `/v1/payments/${failoverPaymentId}`);
    expect(res.statusCode).toBe(200);
    expect(json(res).id).toBe(failoverPaymentId);
    expect(json(res).status).toBe("successful");
    const missing = await apiKeyRequest("GET", "/v1/payments/pay_doesnotexist");
    expect(missing.statusCode).toBe(404);
    expect(json(missing).error.code).toBe("resource_not_found");
  });

  // ------------------------------------------------------------------ (d) timeline
  it("(d) the timeline narrates the failover in order", async () => {
    const types = await timelineTypes(failoverPaymentId);
    expectRelativeOrder(types, ["payment.created", "risk.evaluated", "routing.evaluated", "provider.selected", "provider.request_sent", "provider.error", "failover.initiated", "payment.successful"]);
    expect(types.filter((t) => t === "provider.selected")).toHaveLength(2);
    expect(types.filter((t) => t === "provider.request_sent")).toHaveLength(2);
    expect(types).toContain("webhook.queued");
    expect(types).not.toContain("payment.failed");
  });

  // ------------------------------------------------------------------ (e) idempotency
  it("(e) replays the stored response for the same Idempotency-Key and rejects a different payload", async () => {
    const replay = await apiKeyRequest("POST", "/v1/payments", { body: failoverPayload, headers: { "idempotency-key": failoverIdempotencyKey } });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(json(replay).id).toBe(failoverPaymentId);

    // Same payload, keys in a different order → still a replay.
    const reordered = await apiKeyRequest("POST", "/v1/payments", {
      body: { device: { ip: "203.0.113.10" }, customer: { name: "Buyer", email: "buyer@example.com" }, reference: "ORD-FAILOVER-1", test_scenario: "failover", country: "US", payment_method: "card", currency: "USD", amount: 10_000 },
      headers: { "idempotency-key": failoverIdempotencyKey },
    });
    expect(reordered.statusCode).toBe(201);
    expect(reordered.headers["idempotent-replayed"]).toBe("true");
    expect(json(reordered).id).toBe(failoverPaymentId);

    const mismatch = await apiKeyRequest("POST", "/v1/payments", { body: { ...failoverPayload, amount: 10_001 }, headers: { "idempotency-key": failoverIdempotencyKey } });
    expect(mismatch.statusCode).toBe(422);
    expect(json(mismatch).error.code).toBe("idempotency_key_reused");
    expect(json(mismatch).error.type).toBe("idempotency_error");

    // Only one payment with that reference exists.
    const list = await apiKeyRequest("GET", "/v1/payments?reference=ORD-FAILOVER-1");
    expect(list.statusCode).toBe(200);
    expect(json(list).data).toHaveLength(1);
  });

  // ------------------------------------------------------------------ (f) webhooks delivered & signed
  it("(f) delivers signed webhooks for payment.created, payment.processing and payment.successful", async () => {
    await drainQueues();
    const received = env.receiver.forObject(failoverPaymentId);
    const types = received.map((r) => r.json.type as string);
    expect(types).toEqual(expect.arrayContaining(["payment.created", "payment.processing", "payment.successful"]));
    expect(types).toHaveLength(3);
    // Delivered in the order the events were produced.
    expectRelativeOrder(types, ["payment.created", "payment.processing", "payment.successful"]);
    for (const r of received) {
      const sig = r.headers["natio-signature"];
      expect(typeof sig).toBe("string");
      expect(verifyWebhookSignature(webhookSecret, r.body, sig as string)).toBe(true);
      expect(verifyWebhookSignature("whsec_wrong", r.body, sig as string)).toBe(false);
      expect(r.headers["natio-event-type"]).toBe(r.json.type);
      expect(r.headers["natio-event-id"]).toBe(r.json.id);
      expect(r.headers["natio-delivery-id"]).toMatch(/^whd_/);
      expect(r.headers["natio-delivery-attempt"]).toBe("1");
      expect(r.headers["user-agent"]).toBe("NATIO-Webhooks/1.0");
      expect(r.headers["content-type"]).toBe("application/json");
      expect(r.json.mode).toBe("test");
      expect((r.json.data as Json).object.id).toBe(failoverPaymentId);
    }
    const successful = received.find((r) => r.json.type === "payment.successful")!;
    expect((successful.json.data as Json).object.status).toBe("successful");
    expect((successful.json.data as Json).object.route.provider.name).toBe("NATIO Demo Acquirer B");
    const created = received.find((r) => r.json.type === "payment.created")!;
    expect((created.json.data as Json).object.status).toBe("created");
  });

  // ------------------------------------------------------------------ (g) dashboard payments
  it("(g) the dashboard lists the payment and shows its timeline and successful webhook deliveries", async () => {
    const list = await dashboardRequest("GET", "/dashboard/payments");
    expect(list.statusCode, list.body).toBe(200);
    expect(json(list).data.map((p: Json) => p.id)).toContain(failoverPaymentId);

    const detail = await dashboardRequest("GET", `/dashboard/payments/${failoverPaymentId}`);
    expect(detail.statusCode, detail.body).toBe(200);
    const body = json(detail);
    expect(body.id).toBe(failoverPaymentId);
    expect(body.status).toBe("successful");
    expect(Array.isArray(body.timeline)).toBe(true);
    expectRelativeOrder(
      body.timeline.map((e: Json) => e.type),
      ["payment.created", "provider.error", "failover.initiated", "payment.successful"],
    );
    expect(body.refunds).toEqual([]);
    expect(body.webhook_deliveries).toHaveLength(3);
    for (const d of body.webhook_deliveries) {
      expect(d.status).toBe("succeeded");
      expect(d.endpoint_id).toBe(webhookEndpointId);
      expect(d.attempt_count).toBe(1);
      expect(d.last_response_status).toBe(200);
      expect(d.delivered_at).toBeTruthy();
    }
    expect(body.webhook_deliveries.map((d: Json) => d.event_type).sort()).toEqual(["payment.created", "payment.processing", "payment.successful"]);
  });

  // ------------------------------------------------------------------ (h) deliveries list
  it("(h) the dashboard deliveries list shows succeeded deliveries with attempt details", async () => {
    const res = await dashboardRequest("GET", `/dashboard/webhooks/deliveries?endpoint_id=${webhookEndpointId}`);
    expect(res.statusCode).toBe(200);
    const data = json(res).data as Json[];
    expect(data.length).toBeGreaterThanOrEqual(3);
    expect(data.every((d) => d.status === "succeeded")).toBe(true);
    expect(data.every((d) => d.endpoint_url === env.receiver.url)).toBe(true);
    const only = await dashboardRequest("GET", "/dashboard/webhooks/deliveries?status=succeeded");
    expect(json(only).data.length).toBeGreaterThanOrEqual(3);

    const detail = await dashboardRequest("GET", `/dashboard/webhooks/deliveries/${data[0]!.id}`);
    expect(detail.statusCode).toBe(200);
    expect(json(detail).attempts).toHaveLength(1);
    expect(json(detail).attempts[0].response_status).toBe(200);
    // The signature is redacted in stored request headers.
    expect(json(detail).attempts[0].request_headers["natio-signature"]).toMatch(/…$/);
  });

  // ------------------------------------------------------------------ (i) auth failures
  it("(i) rejects dashboard mutations without a CSRF token and API calls with a wrong key", async () => {
    const noCsrf = await dashboardRequest("POST", "/dashboard/webhooks/endpoints", { body: { url: env.receiver.url, events: [] }, csrf: false });
    expect(noCsrf.statusCode).toBe(403);
    expect(json(noCsrf).error.code).toBe("forbidden");
    expect(json(noCsrf).error.message).toMatch(/CSRF/);

    const badCsrf = await env.app.inject({ method: "POST", url: "/dashboard/webhooks/endpoints", headers: { "x-csrf-token": "nope" }, cookies: { natio_session: merchantCookie }, payload: { url: env.receiver.url, events: [] } });
    expect(badCsrf.statusCode).toBe(403);

    const wrongKey = await apiKeyRequest("GET", "/v1/me", { key: "natio_sk_test_000000000000000000000000000000ab" });
    expect(wrongKey.statusCode).toBe(401);
    expect(json(wrongKey).error.code).toBe("invalid_api_key");

    const noKey = await env.app.inject({ method: "GET", url: "/v1/me" });
    expect(noKey.statusCode).toBe(401);
    expect(json(noKey).error.code).toBe("unauthorized");

    const wrongKeyPost = await apiKeyRequest("POST", "/v1/payments", { body: cardPayment(), key: "natio_sk_live_000000000000000000000000000000ab" });
    expect(wrongKeyPost.statusCode).toBe(401);

    const me = await apiKeyRequest("GET", "/v1/me");
    expect(me.statusCode).toBe(200);
    expect(json(me)).toMatchObject({ mode: "test", merchant: { id: env.seed.merchantId }, project: { id: env.seed.projectId } });
  });

  it("validates payment payloads", async () => {
    const res = await apiKeyRequest("POST", "/v1/payments", { body: { amount: -5, currency: "USD", payment_method: "card" } });
    expect(res.statusCode).toBe(422);
    expect(json(res).error.code).toBe("validation_failed");
    const unknownScenario = await apiKeyRequest("POST", "/v1/payments", { body: cardPayment({ test_scenario: "explode" }) });
    expect(unknownScenario.statusCode).toBe(422);
    const badCurrency = await apiKeyRequest("POST", "/v1/payments", { body: cardPayment({ currency: "XXX" }) });
    expect(badCurrency.statusCode).toBe(422);
  });

  // ------------------------------------------------------------------ (j) sandbox scenarios
  it("(j) hard_decline fails immediately without retry", async () => {
    const body = await createPayment(cardPayment({ test_scenario: "hard_decline" }));
    expect(body.status).toBe("failed");
    expect(body.failure).toMatchObject({ code: "stolen_card", category: "hard" });
    expect(body.route.attempts).toBe(1);
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]).toMatchObject({ outcome: "hard_decline", provider_name: "NATIO Demo Acquirer A" });
    expect(body.captured_amount).toBe(0);
    const types = await timelineTypes(body.id);
    expectRelativeOrder(types, ["provider.selected", "provider.request_sent", "provider.declined", "retry.stopped", "payment.failed"]);
    expect(types).not.toContain("failover.initiated");
  });

  it("(j) timeout_recovered adopts the provider's result after a lost response (no double charge)", async () => {
    const body = await createPayment(cardPayment({ test_scenario: "timeout_recovered" }));
    expect(body.status).toBe("successful");
    expect(body.route.attempts).toBe(1);
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]).toMatchObject({ outcome: "success", status: "succeeded", provider_name: "NATIO Demo Acquirer A" });
    expect(body.route.provider.name).toBe("NATIO Demo Acquirer A");
    const types = await timelineTypes(body.id);
    expectRelativeOrder(types, ["provider.request_sent", "provider.timeout", "provider.lookup", "payment.successful"]);
    expect(types).not.toContain("failover.initiated");
  });

  it("(j) timeout fails over only after the provider confirms no charge exists", async () => {
    const body = await createPayment(cardPayment({ test_scenario: "timeout" }));
    expect(body.status).toBe("successful");
    expect(body.route.attempts).toBe(2);
    expect(body.attempts[0]).toMatchObject({ outcome: "timeout", status: "failed", provider_name: "NATIO Demo Acquirer A" });
    expect(body.attempts[1]).toMatchObject({ outcome: "success", provider_name: "NATIO Demo Acquirer B" });
    const types = await timelineTypes(body.id);
    expectRelativeOrder(types, ["provider.timeout", "provider.lookup", "failover.initiated", "provider.selected", "payment.successful"]);
  });

  it("(j) all_fail exhausts the eligible providers and fails", async () => {
    const body = await createPayment(cardPayment({ test_scenario: "all_fail" }));
    expect(body.status).toBe("failed");
    expect(["attempts_exhausted", "technical_error"]).toContain(body.failure.code);
    expect(body.failure.category).toBe("technical");
    expect(body.route.attempts).toBe(2);
    expect(body.attempts.map((a: Json) => a.outcome)).toEqual(["technical_error", "technical_error"]);
    expect(body.attempts.map((a: Json) => a.provider_name)).toEqual(["NATIO Demo Acquirer A", "NATIO Demo Acquirer B"]);
    const types = await timelineTypes(body.id);
    expectRelativeOrder(types, ["provider.error", "failover.initiated", "provider.error", "retry.stopped", "payment.failed"]);
  });

  it("(j) soft_decline cascades to the next provider; unavailable fails over", async () => {
    const soft = await createPayment(cardPayment({ test_scenario: "soft_decline" }));
    expect(soft.status).toBe("successful");
    expect(soft.route.attempts).toBe(2);
    expect(soft.attempts[0]).toMatchObject({ outcome: "soft_decline" });
    expect(soft.attempts[0].failure.code).toBe("insufficient_funds");
    const unavailable = await createPayment(cardPayment({ test_scenario: "unavailable" }));
    expect(unavailable.status).toBe("successful");
    expect(unavailable.route.attempts).toBe(2);
    expect(unavailable.attempts[0]).toMatchObject({ outcome: "provider_unavailable" });
    expect(await timelineTypes(unavailable.id)).toContain("provider.unavailable");
  });

  // ------------------------------------------------------------------ (k) refunds
  it("(k) refunds part of a payment, then rejects a refund above the remaining amount", async () => {
    const payment = await createPayment(cardPayment({ test_scenario: "success", reference: "ORD-REFUND-1" }));
    expect(payment.status).toBe("successful");
    expect(payment.route.attempts).toBe(1);

    const refund = await apiKeyRequest("POST", `/v1/payments/${payment.id}/refund`, { body: { amount: 2_500, reason: "customer_request" } });
    expect(refund.statusCode, refund.body).toBe(201);
    const r = json(refund);
    expect(r).toMatchObject({ object: "refund", payment_id: payment.id, amount: 2_500, currency: "USD", status: "successful", reason: "customer_request" });
    expect(r.provider_refund_id).toMatch(/^mrf_/);
    expect(r.failure).toBeNull();

    const after = await apiKeyRequest("GET", `/v1/payments/${payment.id}`);
    expect(json(after).status).toBe("partially_refunded");
    expect(json(after).refunded_amount).toBe(2_500);
    expect(json(after).captured_amount).toBe(10_000);

    const tooMuch = await apiKeyRequest("POST", `/v1/payments/${payment.id}/refund`, { body: { amount: 10_000 } });
    expect(tooMuch.statusCode).toBe(400);
    expect(json(tooMuch).error.code).toBe("refund_amount_invalid");
    expect(json(tooMuch).error.param).toBe("amount");

    const listed = await apiKeyRequest("GET", `/v1/payments/${payment.id}/refunds`);
    expect(json(listed).data.map((x: Json) => x.id)).toEqual([r.id]);
    const byId = await apiKeyRequest("GET", `/v1/refunds/${r.id}`);
    expect(byId.statusCode).toBe(200);
    expect(json(byId).status).toBe("successful");

    // Refunding the remainder fully refunds the payment.
    const rest = await apiKeyRequest("POST", `/v1/payments/${payment.id}/refund`, { body: {} });
    expect(rest.statusCode, rest.body).toBe(201);
    expect(json(rest).amount).toBe(7_500);
    const finalState = await apiKeyRequest("GET", `/v1/payments/${payment.id}`);
    expect(json(finalState).status).toBe("refunded");
    expect(json(finalState).refunded_amount).toBe(10_000);
    const nothingLeft = await apiKeyRequest("POST", `/v1/payments/${payment.id}/refund`, { body: { amount: 1 } });
    expect(nothingLeft.statusCode).toBe(409);
    expect(json(nothingLeft).error.code).toBe("payment_not_refundable");
    const types = await timelineTypes(payment.id);
    expect(types.filter((t) => t === "refund.successful")).toHaveLength(2);
  });

  it("refunds are refused for failed payments", async () => {
    const failed = await createPayment(cardPayment({ test_scenario: "hard_decline" }));
    const res = await apiKeyRequest("POST", `/v1/payments/${failed.id}/refund`, { body: { amount: 100 } });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("payment_not_refundable");
  });

  // ------------------------------------------------------------------ (l) manual capture
  it("(l) authorizes with manual capture and captures on request", async () => {
    const auth = await createPayment(cardPayment({ capture_method: "manual", test_scenario: "authorize" }));
    expect(auth.status).toBe("authorized");
    expect(auth.capture_method).toBe("manual");
    expect(auth.captured_amount).toBe(0);
    expect(auth.fee.amount).toBe(0);
    expect(auth.route.provider.name).toBe("NATIO Demo Acquirer A");
    expect(auth.attempts[0]).toMatchObject({ status: "authorized", outcome: "success" });
    expect(await timelineTypes(auth.id)).toContain("payment.authorized");

    // Capture more than authorized is refused.
    const tooMuch = await apiKeyRequest("POST", `/v1/payments/${auth.id}/capture`, { body: { amount: 20_000 } });
    expect(tooMuch.statusCode).toBe(400);
    expect(json(tooMuch).error.code).toBe("amount_exceeds_authorization");

    const cap = await apiKeyRequest("POST", `/v1/payments/${auth.id}/capture`, { body: {} });
    expect(cap.statusCode, cap.body).toBe(200);
    expect(json(cap).status).toBe("successful");
    expect(json(cap).captured_amount).toBe(10_000);
    expect(json(cap).fee.amount).toBe(240 + 20); // 2.4% + 20 on Acquirer A
    expect(await timelineTypes(auth.id)).toContain("payment.captured");

    // A second capture is an invalid transition.
    const again = await apiKeyRequest("POST", `/v1/payments/${auth.id}/capture`, { body: {} });
    expect(again.statusCode).toBe(409);
    expect(json(again).error.code).toBe("invalid_state_transition");
  });

  it("cancels an authorized payment", async () => {
    const auth = await createPayment(cardPayment({ capture_method: "manual", test_scenario: "authorize" }));
    expect(auth.status).toBe("authorized");
    const res = await apiKeyRequest("POST", `/v1/payments/${auth.id}/cancel`, { body: { reason: "changed_mind" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res).status).toBe("cancelled");
    const again = await apiKeyRequest("POST", `/v1/payments/${auth.id}/cancel`, { body: {} });
    expect(again.statusCode).toBe(409);
  });

  // ------------------------------------------------------------------ (m) payouts
  it("(m) creates a payout routed to Acquirer B", async () => {
    const res = await apiKeyRequest("POST", "/v1/payouts", { body: { amount: 50_000, currency: "EUR", destination: { type: "bank_account", token: "t", display: "IBAN ****4321", country: "DE" }, reference: "PO-1" } });
    expect(res.statusCode, res.body).toBe(201);
    const body = json(res);
    expect(body).toMatchObject({ object: "payout", mode: "test", status: "successful", amount: 50_000, currency: "EUR", reference: "PO-1" });
    expect(body.destination).toEqual({ type: "bank_account", display: "IBAN ****4321", holder_name: null, country: "DE" });
    expect(body.route.provider_name).toBe("NATIO Demo Acquirer B");
    expect(body.route.provider_payout_id).toMatch(/^mpo_/);
    expect(body.fee.amount).toBe(Math.round(50_000 * 0.029) + 30);
    expect(body.failure).toBeNull();

    const get = await apiKeyRequest("GET", `/v1/payouts/${body.id}`);
    expect(get.statusCode).toBe(200);
    expect(json(get).status).toBe("successful");
    const list = await apiKeyRequest("GET", "/v1/payouts");
    expect(json(list).data.map((p: Json) => p.id)).toContain(body.id);
  });

  it("payouts reject unmasked destinations and a hard decline fails the payout", async () => {
    const unmasked = await apiKeyRequest("POST", "/v1/payouts", { body: { amount: 100, currency: "EUR", destination: { type: "bank_account", display: "DE89370400440532013000" } } });
    expect(unmasked.statusCode).toBe(422);
    const declined = await apiKeyRequest("POST", "/v1/payouts", { body: { amount: 100, currency: "EUR", destination: { type: "bank_account", display: "IBAN ****0000" }, test_scenario: "hard_decline" } });
    expect(declined.statusCode).toBe(201);
    expect(json(declined).status).toBe("failed");
    expect(json(declined).failure.code).toBe("invalid_account");
  });

  // ------------------------------------------------------------------ (n) transactions & balances
  it("(n) lists payment, refund and payout ledger rows and reports non-custodial balances", async () => {
    const res = await apiKeyRequest("GET", "/v1/transactions?limit=200");
    expect(res.statusCode).toBe(200);
    const data = json(res).data as Json[];
    const types = new Set(data.map((t) => t.type));
    expect(types.has("payment")).toBe(true);
    expect(types.has("refund")).toBe(true);
    expect(types.has("payout")).toBe(true);
    const payoutRow = data.find((t) => t.type === "payout" && t.status === "successful")!;
    expect(payoutRow.amount).toBe(-50_000);
    expect(payoutRow.provider_name).toBe("NATIO Demo Acquirer B");
    const refundRow = data.find((t) => t.type === "refund" && t.amount === -2_500)!;
    expect(refundRow.status).toBe("successful");
    const failoverRow = data.find((t) => t.payment_id === failoverPaymentId)!;
    expect(failoverRow).toMatchObject({ type: "payment", status: "successful", amount: 10_000, fee_amount: 320, net_amount: 9_680 });

    const byType = await apiKeyRequest("GET", "/v1/transactions?type=refund");
    expect((json(byType).data as Json[]).every((t) => t.type === "refund")).toBe(true);

    const balances = await apiKeyRequest("GET", "/v1/balances");
    expect(balances.statusCode).toBe(200);
    expect(json(balances).custodian).toBe(false);
    expect(Array.isArray(json(balances).data)).toBe(true);
  });

  // ------------------------------------------------------------------ (o) risk & admin review
  it("(o) risk block fails the payment; review holds it until an admin approves", async () => {
    const blocked = await createPayment(cardPayment({ test_scenario: "block" }));
    expect(blocked.status).toBe("failed");
    expect(blocked.failure.code).toBe("risk_blocked");
    expect(blocked.failure.category).toBe("policy");
    expect(blocked.route.attempts).toBe(0);
    expect(blocked.risk.score).toBe(100);
    const blockedTypes = await timelineTypes(blocked.id);
    expectRelativeOrder(blockedTypes, ["payment.created", "risk.evaluated", "payment.failed"]);
    expect(blockedTypes).not.toContain("routing.evaluated");

    const review = await createPayment(cardPayment({ test_scenario: "review" }));
    expect(review.status).toBe("pending");
    expect(review.risk.score).toBe(60);
    expect(await timelineTypes(review.id)).toContain("risk.review");

    // A high amount trips the seeded review rule without a scenario hint.
    const highValue = await createPayment(cardPayment({ amount: 1_000_000 }));
    expect(highValue.status).toBe("pending");

    // Admin login
    const login = await env.app.inject({ method: "POST", url: "/admin/auth/login", payload: { email: env.seed.adminEmail, password: env.seed.password } });
    expect(login.statusCode, login.body).toBe(200);
    expect(json(login).admin.role).toBe("superadmin");
    const cookie = login.cookies.find((c) => c.name === "natio_admin_session");
    expect(cookie).toBeDefined();
    adminCookie = cookie!.value;
    adminCsrf = json(login).csrf_token;

    const noCsrf = await adminRequest("POST", `/admin/payments/${review.id}/review`, { body: { decision: "approve" }, csrf: false });
    expect(noCsrf.statusCode).toBe(403);

    const approved = await adminRequest("POST", `/admin/payments/${review.id}/review`, { body: { decision: "approve" } });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(json(approved).status).toBe("successful");
    expect(json(approved).route.attempts).toBe(1);
    const reviewTypes = await timelineTypes(review.id);
    expectRelativeOrder(reviewTypes, ["risk.review", "risk.reviewed", "routing.evaluated", "payment.successful"]);

    const rejected = await adminRequest("POST", `/admin/payments/${highValue.id}/review`, { body: { decision: "reject" } });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(json(rejected).status).toBe("failed");
    expect(json(rejected).failure.code).toBe("risk_blocked");

    const again = await adminRequest("POST", `/admin/payments/${review.id}/review`, { body: { decision: "approve" } });
    expect(again.statusCode).toBe(409);
    expect(json(again).error.code).toBe("not_pending");

    const adminDetail = await adminRequest("GET", `/admin/payments/${review.id}`);
    expect(adminDetail.statusCode).toBe(200);
    expect(json(adminDetail).risk_decision.decision).toBe("review");
    expect(json(adminDetail).risk_decision.matchedRules.some((m: Json) => m.id === "sandbox")).toBe(true);
    expect(json(adminDetail).merchant.id).toBe(env.seed.merchantId);
  });

  it("risk velocity: five failed attempts from one IP block the next payment from that IP", async () => {
    const ip = "198.51.100.77";
    for (let i = 0; i < 5; i++) {
      const failed = await createPayment(cardPayment({ test_scenario: "hard_decline", device: { ip } }));
      expect(failed.status).toBe("failed");
      expect(failed.failure.code).toBe("stolen_card");
    }
    const blocked = await createPayment(cardPayment({ device: { ip } }));
    expect(blocked.status).toBe("failed");
    expect(blocked.failure.code).toBe("risk_blocked");
    expect(blocked.risk.score).toBeGreaterThanOrEqual(80);
    const detail = await adminRequest("GET", `/admin/payments/${blocked.id}`);
    expect(json(detail).risk_decision.decision).toBe("block");
    expect(json(detail).risk_decision.signals.failed_attempts_24h).toBe(5);
    expect(json(detail).risk_decision.matchedRules.map((m: Json) => m.name)).toContain("≥ 5 failed attempts in 24h");
    // A different IP is unaffected.
    const fine = await createPayment(cardPayment());
    expect(fine.status).toBe("successful");
  });

  // ------------------------------------------------------------------ (p) admin provider operations
  it("(p) admin can health-check an account, simulate an outage that triggers failover, and everything is audited", async () => {
    const providers = await adminRequest("GET", "/admin/providers?mode=test");
    expect(providers.statusCode).toBe(200);
    const data = json(providers).data as Json[];
    const a = data.find((p) => p.code === "demo_acquirer_a")!;
    const b = data.find((p) => p.code === "demo_acquirer_b")!;
    expect(a.adapter_registered).toBe(true);
    acquirerAAccountId = a.accounts.find((x: Json) => x.mode === "test").id;
    acquirerBAccountId = b.accounts.find((x: Json) => x.mode === "test").id;
    expect(acquirerAAccountId).toMatch(/^pa_/);
    expect(a.accounts.every((x: Json) => x.credentials === undefined && x.credentials_enc === undefined)).toBe(true);
    expect(a.accounts.find((x: Json) => x.mode === "test").health.attempts).toBeGreaterThan(0);

    const health = await adminRequest("POST", `/admin/provider-accounts/${acquirerAAccountId}/health-check`);
    expect(health.statusCode, health.body).toBe(200);
    expect(json(health).ok).toBe(true);
    expect(typeof json(health).latencyMs).toBe("number");

    const outage = await adminRequest("PATCH", `/admin/provider-accounts/${acquirerAAccountId}`, { body: { config: { simulation: { forceOutcome: "provider_unavailable" } } } });
    expect(outage.statusCode, outage.body).toBe(200);
    expect(json(outage).config.simulation.forceOutcome).toBe("provider_unavailable");
    expect(json(outage).has_credentials).toBe(true);

    const unhealthy = await adminRequest("POST", `/admin/provider-accounts/${acquirerAAccountId}/health-check`);
    expect(json(unhealthy).ok).toBe(false);

    const payment = await createPayment(cardPayment({ reference: "ORD-OUTAGE-1" }));
    expect(payment.status).toBe("successful");
    expect(payment.route.attempts).toBe(2);
    expect(payment.route.provider.name).toBe("NATIO Demo Acquirer B");
    expect(payment.attempts[0]).toMatchObject({ outcome: "provider_unavailable", provider_name: "NATIO Demo Acquirer A" });
    expect(payment.attempts[1]).toMatchObject({ outcome: "success", provider_name: "NATIO Demo Acquirer B" });
    const types = await timelineTypes(payment.id);
    expectRelativeOrder(types, ["provider.request_sent", "provider.unavailable", "failover.initiated", "payment.successful"]);

    const events = await adminRequest("GET", `/admin/provider-accounts/${acquirerAAccountId}/events`);
    expect(events.statusCode).toBe(200);
    expect((json(events).data as Json[]).some((e) => e.type === "provider.unavailable")).toBe(true);

    const reset = await adminRequest("PATCH", `/admin/provider-accounts/${acquirerAAccountId}`, { body: { config: { simulation: { forceOutcome: null } } } });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(json(reset).config.simulation?.forceOutcome ?? null).toBeNull();

    const recovered = await createPayment(cardPayment());
    expect(recovered.status).toBe("successful");
    expect(recovered.route.attempts).toBe(1);
    expect(recovered.route.provider.name).toBe("NATIO Demo Acquirer A");

    const audit = await adminRequest("GET", "/admin/audit?action=provider_account.updated");
    expect(audit.statusCode).toBe(200);
    const rows = json(audit).data as Json[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.action === "provider_account.updated")).toBe(true);
    expect(rows[0]).toMatchObject({ actor_type: "admin_user", entity_type: "provider_account", entity_id: acquirerAAccountId });
    const allAudit = await adminRequest("GET", "/admin/audit?limit=200");
    const actions = new Set((json(allAudit).data as Json[]).map((r) => r.action));
    expect(actions.has("payment.review_approve")).toBe(true);
    expect(actions.has("payment.review_reject")).toBe(true);
    expect(actions.has("webhook_endpoint.created")).toBe(true);
    expect(actions.has("refund.created")).toBe(true);
    expect(actions.has("payout.created")).toBe(true);
    expect(actions.has("payment.captured")).toBe(true);
  });

  it("admin RBAC: a readonly/support admin cannot manage providers", async () => {
    const login = await env.app.inject({ method: "POST", url: "/admin/auth/login", payload: { email: "support@natio.local", password: env.seed.password } });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = login.cookies.find((c) => c.name === "natio_admin_session")!.value;
    const csrf = json(login).csrf_token;
    const denied = await env.app.inject({ method: "POST", url: `/admin/provider-accounts/${acquirerAAccountId}/health-check`, headers: { "x-csrf-token": csrf }, cookies: { natio_admin_session: cookie } });
    expect(denied.statusCode).toBe(403);
    expect(json(denied).error.message).toMatch(/providers.manage/);
    const allowed = await env.app.inject({ method: "GET", url: "/admin/overview", cookies: { natio_admin_session: cookie } });
    expect(allowed.statusCode).toBe(200);
  });

  // ------------------------------------------------------------------ (q) routing rules
  it("(q) creates a routing rule, sees it selected by the simulator, and deletes it", async () => {
    const create = await adminRequest("POST", "/admin/routing/rules", {
      body: {
        name: "e2e · EUR wallets → Acquirer B",
        mode: "test",
        merchant_id: env.seed.merchantId,
        priority: 100,
        transaction_type: "payment",
        conditions: [
          { field: "currency", op: "eq", value: "EUR" },
          { field: "payment_method", op: "eq", value: "wallet" },
        ],
        strategy: "ordered",
        routes: [{ provider_account_id: acquirerBAccountId }],
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    const ruleId = json(create).id as string;
    expect(ruleId).toMatch(/^rr_/);

    const listed = await adminRequest("GET", `/admin/routing/rules?mode=test&merchant_id=${env.seed.merchantId}`);
    const rule = (json(listed).data as Json[]).find((r) => r.id === ruleId)!;
    expect(rule.routes).toHaveLength(1);
    expect(rule.routes[0].provider_account_id).toBe(acquirerBAccountId);
    expect(rule.routes[0].provider_name).toBe("NATIO Demo Acquirer B");

    const sim = await adminRequest("POST", "/admin/routing/simulate", { body: { merchant_id: env.seed.merchantId, amount: 1_000, currency: "eur", payment_method: "wallet", country: "DE" } });
    expect(sim.statusCode, sim.body).toBe(200);
    expect(json(sim).rule).toEqual({ id: ruleId, name: "e2e · EUR wallets → Acquirer B" });
    expect(json(sim).strategy).toBe("ordered");
    expect(json(sim).ordered).toHaveLength(1);
    expect(json(sim).ordered[0]).toMatchObject({ provider_account_id: acquirerBAccountId, provider: "NATIO Demo Acquirer B" });
    expect(json(sim).candidates.every((c: Json) => c.eligible)).toBe(true);

    // USD wallets are not covered by the new rule → the seeded score rule applies.
    const other = await adminRequest("POST", "/admin/routing/simulate", { body: { merchant_id: env.seed.merchantId, amount: 1_000, currency: "USD", payment_method: "wallet" } });
    expect(json(other).rule.id).not.toBe(ruleId);
    expect(json(other).rule.name).toBe("Wallets → best score");
    expect(json(other).strategy).toBe("score");

    // The rule is live for real payments too.
    const wallet = await createPayment({ amount: 1_000, currency: "EUR", payment_method: "wallet", country: "DE" });
    expect(wallet.status).toBe("successful");
    expect(wallet.route.rule).toBe("e2e · EUR wallets → Acquirer B");
    expect(wallet.route.provider.name).toBe("NATIO Demo Acquirer B");

    const del = await adminRequest("DELETE", `/admin/routing/rules/${ruleId}`);
    expect(del.statusCode, del.body).toBe(200);
    expect(json(del)).toEqual({ ok: true });
    const afterDelete = await adminRequest("POST", "/admin/routing/simulate", { body: { merchant_id: env.seed.merchantId, amount: 1_000, currency: "EUR", payment_method: "wallet", country: "DE" } });
    expect(json(afterDelete).rule?.id ?? null).not.toBe(ruleId);
    expect(json(afterDelete).rule.name).toBe("Wallets → best score");
    const gone = await adminRequest("DELETE", `/admin/routing/rules/${ruleId}`);
    expect(gone.statusCode).toBe(404);
  });

  it("all webhook deliveries produced by the flow end up succeeded", async () => {
    await drainQueues();
    const res = await dashboardRequest("GET", "/dashboard/webhooks/deliveries?limit=200");
    const data = json(res).data as Json[];
    expect(data.length).toBeGreaterThan(10);
    const notOk = data.filter((d) => d.status !== "succeeded").map((d) => ({ id: d.id, status: d.status, type: d.event_type, err: d.last_error, http: d.last_response_status, attempts: d.attempt_count }));
    expect(notOk, JSON.stringify(notOk)).toEqual([]);
    expect(env.receiver.received.length).toBe(data.length);
    for (const r of env.receiver.received) expect(verifyWebhookSignature(webhookSecret, r.body, r.headers["natio-signature"] as string)).toBe(true);
    const eventTypes = new Set(data.map((d) => d.event_type));
    for (const t of ["payment.created", "payment.successful", "payment.failed", "payment.authorized", "payment.cancelled", "payment.refunded", "refund.successful", "payout.created", "payout.successful", "payout.failed"]) {
      expect(eventTypes.has(t), t).toBe(true);
    }
  });
});
