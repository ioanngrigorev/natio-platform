import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { startTestEnv, stopTestEnv, type TestEnv } from "./setup.js";
import { getDb } from "../../src/db/client.js";
import {
  adminUsers,
  paymentAttempts,
  payments,
  pricingPlans,
  providerAccounts,
  routingRules,
  transactions,
} from "../../src/db/schema/index.js";
import {
  runOrchestration,
  failPayment,
  syncAttempt,
} from "../../src/modules/payments/orchestrator.js";
import { loadProviderStats } from "../../src/modules/routing/service.js";
import { closeQueues } from "../../src/lib/queue.js";
import type { PriceTerms } from "../../src/modules/pricing/engine.js";
let env: TestEnv,
  cookie = "",
  csrf = "",
  accountId = "",
  merchantPlan: any,
  providerPlan: any,
  sequence = 0;
const db = () => getDb();
const req = (
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  env.app.inject({
    method,
    url,
    cookies: { natio_admin_session: cookie },
    headers: { "x-csrf-token": csrf, ...headers },
    payload: body as any,
  });
const terms = (side: "merchant" | "provider"): PriceTerms => ({
  name: `Synthetic ${side}`,
  side,
  currency: "USD",
  merchantId: null,
  providerAccountId: null,
  paymentMethod: null,
  country: null,
  priority: 100,
  validFrom: "2025-01-01T00:00:00Z",
  validUntil: null,
  tiers:
    side === "merchant"
      ? [
          {
            from: 0,
            to: 10000,
            rateBps: 300,
            fixed: 20,
            minimum: 0,
            maximum: null,
          },
          {
            from: 10000,
            to: null,
            rateBps: 250,
            fixed: 10,
            minimum: 0,
            maximum: null,
          },
        ]
      : [
          {
            from: 0,
            to: null,
            rateBps: 100,
            fixed: 5,
            minimum: 0,
            maximum: null,
          },
        ],
});
async function payment(extra: Record<string, unknown> = {}) {
  const r = await env.app.inject({
    method: "POST",
    url: "/v1/payments",
    headers: { authorization: `Bearer ${env.seed.testApiKey}` },
    payload: {
      amount: 10000,
      currency: "USD",
      payment_method: "card",
      country: "US",
      device: { ip: `10.10.0.${++sequence}` },
      ...extra,
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
async function createPublished(t: PriceTerms) {
  const created = await req("POST", "/admin/pricing", { terms: t });
  expect(created.statusCode, created.body).toBe(201);
  const p = created.json();
  const published = await req("PATCH", `/admin/pricing/${p.id}`, {
    version: p.version,
    action: "publish",
  });
  expect(published.statusCode, published.body).toBe(200);
  return published.json();
}
beforeAll(async () => {
  env = await startTestEnv();
  const r = await env.app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: env.seed.adminEmail, password: env.seed.password },
  });
  expect(r.statusCode).toBe(200);
  cookie = r.cookies.find((c) => c.name === "natio_admin_session")!.value;
  csrf = r.json().csrf_token;
  const accounts = await db()
    .select()
    .from(providerAccounts)
    .where(eq(providerAccounts.mode, "test"))
    .orderBy(providerAccounts.priority);
  accountId = accounts[0]!.id;
}, 120000);
afterAll(async () => {
  await closeQueues();
  await stopTestEnv(env);
});
describe("routing and pricing integration", () => {
  it("requires authentication, CSRF and a privileged role for writes", async () => {
    expect(
      (await env.app.inject({ method: "GET", url: "/admin/pricing" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await req(
          "POST",
          "/admin/pricing",
          { terms: terms("merchant") },
          { "x-csrf-token": "wrong" },
        )
      ).statusCode,
    ).toBe(403);
    await db()
      .update(adminUsers)
      .set({ role: "readonly" })
      .where(eq(adminUsers.email, env.seed.adminEmail));
    try {
      expect((await req("GET", "/admin/pricing")).statusCode).toBe(200);
      expect(
        (await req("POST", "/admin/pricing", { terms: terms("merchant") }))
          .statusCode,
      ).toBe(403);
      const sim = await req("POST", "/admin/routing/simulate", {
        merchant_id: env.seed.merchantId,
        amount: 10000,
        currency: "USD",
        payment_method: "card",
        failure: "timeout_unknown",
      });
      expect(sim.statusCode, sim.body).toBe(200);
      expect(sim.json().cascade.retry).toBe(false);
    } finally {
      await db()
        .update(adminUsers)
        .set({ role: "superadmin" })
        .where(eq(adminUsers.email, env.seed.adminEmail));
    }
  });
  it("publishes both sides, rejects scope overlap and optimistic version conflicts", async () => {
    merchantPlan = await createPublished(terms("merchant"));
    providerPlan = await createPublished(terms("provider"));
    const draft = await req("POST", "/admin/pricing", {
      terms: terms("merchant"),
    });
    const p = draft.json();
    expect(
      (
        await req("PATCH", `/admin/pricing/${p.id}`, {
          version: p.version,
          action: "publish",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await req("PATCH", `/admin/pricing/${merchantPlan.id}`, {
          version: 1,
          action: "retire",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await req("PATCH", `/admin/pricing/${merchantPlan.id}`, {
          version: merchantPlan.version,
          terms: terms("merchant"),
        })
      ).statusCode,
    ).toBe(409);
    await expect(
      db()
        .update(pricingPlans)
        .set({ terms: { ...terms("merchant"), name: "Tampered" } })
        .where(eq(pricingPlans.id, merchantPlan.id)),
    ).rejects.toThrow();
  });
  it("quotes both fees, isolates mode and does not create a payment", async () => {
    const before = (
      await db()
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(payments)
    )[0]!.n;
    const r = await req("POST", "/admin/pricing/quote", {
      merchantId: env.seed.merchantId,
      providerAccountId: accountId,
      amount: 10000,
      currency: "USD",
      paymentMethod: "card",
      curve: [9999, 10000],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      merchant: { amount: 260 },
      provider: { amount: 105 },
      margin: 155,
    });
    expect(r.json().curve).toHaveLength(2);
    expect(
      (
        await req("GET", "/admin/pricing", undefined, {
          "x-natio-mode": "live",
        })
      ).json().data,
    ).toEqual([]);
    expect(
      (
        await db()
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(payments)
      )[0]!.n,
    ).toBe(before);
  });
  it("records merchant fee in ledger and PSP cost separately with immutable snapshots", async () => {
    const p = await payment({ test_scenario: "success" });
    expect(p.status).toBe("successful");
    expect(p.fee.amount).toBe(260);
    const [a] = await db()
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, p.id));
    expect(a!.feeAmount).toBe(105);
    expect(a!.pricingSnapshot!.merchant.planId).toBe(merchantPlan.id);
    const [t] = await db()
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, p.id));
    expect(t!.feeAmount).toBe(260);
    expect(t!.netAmount).toBe(9740);
    await expect(
      db()
        .update(paymentAttempts)
        .set({ pricingSnapshot: null })
        .where(eq(paymentAttempts.id, a!.id)),
    ).rejects.toThrow();
    const evidence = await req("GET", `/admin/payments/${p.id}/pricing`);
    expect(evidence.json().data[0].captured_pricing.margin).toBe(155);
    expect(p.attempts[0].pricingSnapshot).toBeUndefined();
    expect(p.attempts[0].fee_amount).toBe(260);
  });
  it("keeps authorization tariff terms when a new version is published before partial capture", async () => {
    const p = await payment({
      test_scenario: "authorize",
      capture_method: "manual",
    });
    expect(p.status).toBe("authorized");
    const retired = await req("PATCH", `/admin/pricing/${merchantPlan.id}`, {
      version: merchantPlan.version,
      action: "retire",
    });
    expect(retired.statusCode, retired.body).toBe(200);
    const t = {
      ...terms("merchant"),
      tiers: [
        {
          from: 0,
          to: null,
          rateBps: 500,
          fixed: 20,
          minimum: 0,
          maximum: null,
        },
      ],
    };
    const draft = await req("POST", "/admin/pricing", {
      terms: t,
      cloneId: merchantPlan.id,
    });
    expect(draft.json().revision).toBe(2);
    const active = await req("PATCH", `/admin/pricing/${draft.json().id}`, {
      version: 1,
      action: "publish",
    });
    expect(active.statusCode, active.body).toBe(200);
    const cap = await env.app.inject({
      method: "POST",
      url: `/v1/payments/${p.id}/capture`,
      headers: { authorization: `Bearer ${env.seed.testApiKey}` },
      payload: { amount: 5000 },
    });
    expect(cap.statusCode, cap.body).toBe(200);
    expect(cap.json().fee.amount).toBe(170);
    const [a] = await db()
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, p.id));
    expect(a!.feeAmount).toBe(55);
    expect(a!.pricingSnapshot!.merchant.planId).toBe(merchantPlan.id);
    const next = await payment({ amount: 5000, test_scenario: "success" });
    expect(next.fee.amount).toBe(270);
  });
  it("atomically replaces an active tariff family without a pricing gap", async () => {
    const all = (await req("GET", "/admin/pricing")).json().data;
    const active = all.find(
      (p: any) => p.familyId === merchantPlan.familyId && p.status === "active",
    );
    const draft = (
      await req("POST", "/admin/pricing", {
        terms: { ...active.terms, name: "Atomic replacement" },
        cloneId: active.id,
      })
    ).json();
    const r = await req("PATCH", `/admin/pricing/${draft.id}`, {
      version: draft.version,
      action: "publish",
      replacePrevious: true,
    });
    expect(r.statusCode, r.body).toBe(200);
    const family = await db()
      .select()
      .from(pricingPlans)
      .where(eq(pricingPlans.familyId, active.familyId));
    expect(family.filter((p) => p.status === "active")).toHaveLength(1);
    expect(family.find((p) => p.id === active.id)!.status).toBe("retired");
  });
  it("applies rule attempt limits in real execution, not just simulation", async () => {
    const [r] = await db()
      .select()
      .from(routingRules)
      .where(eq(routingRules.name, "Cards → Acquirer A, fallback Acquirer B"));
    await db()
      .update(routingRules)
      .set({ policy: { maxAttempts: 1 } })
      .where(eq(routingRules.id, r!.id));
    try {
      const p = await payment({ test_scenario: "failover" });
      expect(p.status).toBe("failed");
      expect(p.route.attempts).toBe(1);
    } finally {
      await db()
        .update(routingRules)
        .set({ policy: {} })
        .where(eq(routingRules.id, r!.id));
    }
  });
  it("does not cascade an unresolved timeout and permits no duplicate in-flight attempt", async () => {
    const p = await payment({ test_scenario: "timeout_unknown" });
    expect(p.status).toBe("processing");
    expect(p.route.attempts).toBe(1);
    const again = await runOrchestration(db(), p.id);
    expect(again.status).toBe("processing");
    expect(again.attemptCount).toBe(1);
    await expect(failPayment(db(), again, {code:"technical_error", actor:{type:"system"}})).rejects.toMatchObject({code:"provider_result_pending"});
    const [a] = await db()
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, p.id));
    expect(a!.status).toBe("unknown");
    await syncAttempt(db(), { attemptId: a!.id, tries: 5 });
    expect(
      (await db().select().from(payments).where(eq(payments.id, p.id)))[0]!
        .status,
    ).toBe("processing");
  });
  it("serializes concurrent attempts on the same payment", async () => {
    const p = await payment({ test_scenario: "review" });
    expect(p.status).toBe("pending");
    await db()
      .update(payments)
      .set({ status: "processing", testScenario: "success" })
      .where(eq(payments.id, p.id));
    await Promise.all([
      runOrchestration(db(), p.id),
      runOrchestration(db(), p.id),
    ]);
    const attempts = await db()
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, p.id));
    expect(attempts).toHaveLength(1);
    expect(
      (await db().select().from(payments).where(eq(payments.id, p.id)))[0]!
        .status,
    ).toBe("successful");
  });
  it("isolates provider health by mode and excludes pending customer authentication", async () => {
    const before = await loadProviderStats(db(), "test");
    await payment({ test_scenario: "requires_action" });
    const after = await loadProviderStats(db(), "test");
    expect(after.get(accountId)?.sampleSize).toBe(
      before.get(accountId)?.sampleSize,
    );
    expect((await loadProviderStats(db(), "live")).size).toBe(0);
  });
  it("rejects invalid rule fields and cross-mode provider accounts", async () => {
    const payload = {
      name: "Invalid test route",
      mode: "test",
      strategy: "ordered",
      conditions: [{ field: "not_a_field", op: "eq", value: "x" }],
      routes: [{ provider_account_id: accountId }],
    };
    expect(
      (await req("POST", "/admin/routing/rules", payload)).statusCode,
    ).toBe(422);
    const [live] = await db()
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.mode, "live"));
    expect(
      (
        await req("POST", "/admin/routing/rules", {
          ...payload,
          conditions: [],
          routes: [{ provider_account_id: live!.id }],
        })
      ).statusCode,
    ).toBe(422);
  });
});
