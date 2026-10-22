import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { startTestEnv, stopTestEnv, type TestEnv } from "./setup.js";
import { getDb } from "../../src/db/client.js";
import { merchants, transactions } from "../../src/db/schema/index.js";
import { businessIntelligence, biQuery } from "../../src/modules/analytics/bi.js";
import { adminListMerchants } from "../../src/modules/merchants/service.js";

let env: TestEnv, cookie = "", csrf = "";
beforeAll(async () => {
  env = await startTestEnv();
  await getDb().update(merchants).set({ settings: { defaultCurrency: "EUR" } }).where(eq(merchants.id, env.seed.merchantId));
  const common = { merchantId: env.seed.merchantId, projectId: env.seed.projectId, entityType: "test", entityId: "analytics-fixture" };
  await getDb().insert(transactions).values([
    { ...common, id: "txn_analytics_1", mode: "test", type: "payment", status: "successful", currency: "EUR", amount: 10000, feeAmount: 250, netAmount: 9750, country: "DE", paymentMethodType: "card", occurredAt: new Date("2025-01-01T23:59:59Z") },
    { ...common, id: "txn_analytics_2", mode: "test", type: "payment", status: "failed", currency: "EUR", amount: 20000, netAmount: 0, country: "DE", paymentMethodType: "card", occurredAt: new Date("2025-01-03T00:00:00Z") },
    { ...common, id: "txn_analytics_3", mode: "test", type: "payout", status: "successful", currency: "EUR", amount: -3000, feeAmount: 30, netAmount: -3030, country: null, paymentMethodType: null, occurredAt: new Date("2025-01-03T12:00:00Z") },
    { ...common, id: "txn_analytics_4", mode: "test", type: "payment", status: "successful", currency: "USD", amount: 50000, feeAmount: 100, netAmount: 49900, country: "US", paymentMethodType: "bank_transfer", occurredAt: new Date("2025-01-04T12:00:00Z") },
    { ...common, id: "txn_analytics_live", mode: "live", type: "payment", status: "successful", currency: "EUR", amount: 700, feeAmount: 7, netAmount: 693, occurredAt: new Date("2025-01-01T12:00:00Z") },
  ]);
  const login = await env.app.inject({ method: "POST", url: "/admin/auth/login", payload: { email: env.seed.adminEmail, password: env.seed.password } });
  expect(login.statusCode).toBe(200);
  cookie = login.cookies.find(c => c.name === "natio_admin_session")!.value;
  csrf = login.json().csrf_token;
}, 120000);
afterAll(async () => { await stopTestEnv(env); });

describe("optimized analytics preserve financial boundaries", () => {
  it("reconciles totals and every breakdown, including NULL dimensions", async () => {
    const r = await businessIntelligence(biQuery.parse({ merchant_id: env.seed.merchantId }), "test");
    expect(r.summary).toEqual({ transactions: 3, successful: 2, failed: 1, pending: 0, volume: 10000, fees: 280, payouts: 3000, ledger_net: 6720, settled: 0 });
    for (const rows of [r.daily, r.methods, r.countries, r.merchants]) {
      expect(rows.reduce((sum: number, row: {transactions: number}) => sum + row.transactions, 0)).toBe(3);
      expect(rows.reduce((sum: number, row: {volume: number}) => sum + row.volume, 0)).toBe(10000);
    }
    expect(r.countries.find((row: {label: string | null}) => row.label === null).transactions).toBe(1);
    expect(r.balances.find((row: { currency: string }) => row.currency === "USD").volume).toBe(50000);
  });
  it("isolates mode, dates, currency, status, merchant and empty selections", async () => {
    const live = await businessIntelligence(biQuery.parse({ merchant_id: env.seed.merchantId }), "live");
    expect(live.summary.volume).toBe(700);
    const day = await businessIntelligence(biQuery.parse({ merchant_id: env.seed.merchantId, from: "2025-01-03", to: "2025-01-03", status: "failed" }), "test");
    expect(day.summary.transactions).toBe(1); expect(day.summary.volume).toBe(0);
    const usd = await businessIntelligence(biQuery.parse({ currency: "USD", merchant_id: env.seed.merchantId }), "test");
    expect(usd.summary.volume).toBe(50000);
    const empty = await businessIntelligence(biQuery.parse({ merchant_id: "absent" }), "test");
    expect(empty.summary.transactions).toBe(0); expect(empty.daily).toEqual([]); expect(empty.statuses).toEqual([]);
  });
  it("batches merchant totals without mixing currencies or modes", async () => {
    const [m] = await adminListMerchants(getDb(), { search: env.seed.merchantId, mode: "test" });
    expect(m).toMatchObject({ transactions: 4, volume: 10000, balance: 6720, currency: "EUR" });
    const [live] = await adminListMerchants(getDb(), { search: env.seed.merchantId, mode: "live" });
    expect(live).toMatchObject({ transactions: 1, volume: 700, balance: 693 });
    expect(await adminListMerchants(getDb(), { search: "absent" })).toEqual([]);
  });
  it("reuses snapshots only after authorization and invalidates after admin changes", async () => {
    const get = (mode = "test", cookies = { natio_admin_session: cookie }) => env.app.inject({ method: "GET", url: "/admin/bi", cookies, headers: { "x-natio-mode": mode } });
    const first = await get(), second = await get();
    expect(first.statusCode).toBe(200); expect(second.json().analytics_snapshot_at).toBe(first.json().analytics_snapshot_at);
    expect((await get("test", {} as {natio_admin_session: string})).statusCode).toBe(401);
    expect((await get("live")).json().summary.volume).toBe(700);
    const mutation = await env.app.inject({ method: "POST", url: `/admin/merchants/${env.seed.merchantId}/kyb`, cookies: { natio_admin_session: cookie }, headers: { "x-csrf-token": csrf }, payload: { kyb_status: "approved" } });
    expect(mutation.statusCode).toBe(200);
    expect((await get()).json().analytics_snapshot_at).not.toBe(first.json().analytics_snapshot_at);
  });
});
