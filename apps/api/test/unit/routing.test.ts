import { describe, expect, it } from "vitest";
import type { RuleCondition } from "../../src/db/schema/index.js";
import {
  buildRoute,
  costBps,
  DEFAULT_WEIGHTS,
  eligibility,
  matchesCondition,
  matchesRule,
  scoreCandidate,
  selectRule,
  type AccountRow,
  type Candidate,
  type ProviderRow,
  type ProviderStats,
  type RouteRow,
  type RoutingContext,
  type RuleWithRoutes,
} from "../../src/modules/routing/engine.js";

// ---------------------------------------------------------------------------
// Fixtures (plain objects shaped like Drizzle rows)
// ---------------------------------------------------------------------------
let seq = 0;
const nextId = (p: string) => `${p}_${String(++seq).padStart(4, "0")}`;

function provider(over: Partial<ProviderRow> = {}): ProviderRow {
  const id = over.id ?? nextId("prv");
  return {
    id,
    code: over.code ?? id,
    name: over.name ?? `Provider ${id}`,
    type: "acquirer",
    adapterKey: "mock_acquirer",
    status: "active",
    supportedMethods: ["card", "wallet"],
    supportedCurrencies: ["USD", "EUR"],
    supportedCountries: [],
    capabilities: { payments: true, refunds: true, capture: true, payouts: false },
    settlementEntity: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as ProviderRow;
}

function account(providerId: string, over: Partial<AccountRow> = {}): AccountRow {
  const id = over.id ?? nextId("pa");
  return {
    id,
    providerId,
    merchantId: null,
    mode: "test",
    name: over.name ?? `Account ${id}`,
    status: "active",
    priority: 100,
    credentialsEnc: null,
    config: {},
    feePercent: "2.0" as never,
    feeFixedMinor: 0,
    limits: {},
    currencies: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as AccountRow;
}

function candidate(pOver: Partial<ProviderRow> = {}, aOver: Partial<AccountRow> = {}, stats?: ProviderStats): Candidate {
  const p = provider(pOver);
  const a = account(p.id, aOver);
  return { account: a, provider: p, stats };
}

function rule(over: Partial<RuleWithRoutes> = {}, routeAccountIds: Array<string | { id: string; weight?: number }> = []): RuleWithRoutes {
  const id = over.id ?? nextId("rr");
  const routes: RouteRow[] = routeAccountIds.map((r, i) => {
    const acc = typeof r === "string" ? { id: r } : r;
    return { id: nextId("prt"), routingRuleId: id, providerAccountId: acc.id, position: i, weight: acc.weight ?? 100, createdAt: new Date() } as RouteRow;
  });
  return {
    id,
    merchantId: null,
    projectId: null,
    mode: "test",
    name: over.name ?? `Rule ${id}`,
    description: null,
    priority: 100,
    enabled: true,
    transactionType: "payment",
    conditions: [],
    strategy: "ordered",
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
    routes: over.routes ?? routes,
  } as RuleWithRoutes;
}

const baseCtx: RoutingContext = {
  transactionType: "payment",
  merchantId: "mer_1",
  projectId: "prj_1",
  mode: "test",
  amount: 10_000,
  currency: "USD",
  paymentMethod: "card",
  country: "US",
  customerCountry: "de",
  riskScore: 20,
  seed: "pay_seed",
};

const cond = (field: RuleCondition["field"], op: RuleCondition["op"], value: RuleCondition["value"]): RuleCondition => ({ field, op, value });

// ---------------------------------------------------------------------------
// matchesCondition
// ---------------------------------------------------------------------------
describe("matchesCondition", () => {
  it("eq / neq compare case-insensitively for strings", () => {
    expect(matchesCondition(cond("currency", "eq", "usd"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("currency", "eq", "EUR"), baseCtx)).toBe(false);
    expect(matchesCondition(cond("currency", "neq", "EUR"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("currency", "neq", "usd"), baseCtx)).toBe(false);
    expect(matchesCondition(cond("country", "eq", "us"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("customer_country", "eq", "DE"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("payment_method", "eq", "card"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("merchant_id", "eq", "mer_1"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("project_id", "eq", "prj_1"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("transaction_type", "eq", "payment"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("transaction_type", "eq", "payout"), baseCtx)).toBe(false);
  });

  it("eq on numbers", () => {
    expect(matchesCondition(cond("amount", "eq", 10_000), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "eq", 10_001), baseCtx)).toBe(false);
    expect(matchesCondition(cond("risk_score", "eq", 20), baseCtx)).toBe(true);
  });

  it("in / not_in", () => {
    expect(matchesCondition(cond("country", "in", ["ca", "US"]), baseCtx)).toBe(true);
    expect(matchesCondition(cond("country", "in", ["CA", "GB"]), baseCtx)).toBe(false);
    expect(matchesCondition(cond("country", "not_in", ["CA", "GB"]), baseCtx)).toBe(true);
    expect(matchesCondition(cond("country", "not_in", ["us"]), baseCtx)).toBe(false);
    // scalar value is treated as a one-element list
    expect(matchesCondition(cond("payment_method", "in", "card"), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "in", [1, 10_000]), baseCtx)).toBe(true);
  });

  it("gt / gte / lt / lte on amount", () => {
    expect(matchesCondition(cond("amount", "gt", 9_999), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "gt", 10_000), baseCtx)).toBe(false);
    expect(matchesCondition(cond("amount", "gte", 10_000), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "gte", 10_001), baseCtx)).toBe(false);
    expect(matchesCondition(cond("amount", "lt", 10_001), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "lt", 10_000), baseCtx)).toBe(false);
    expect(matchesCondition(cond("amount", "lte", 10_000), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "lte", 9_999), baseCtx)).toBe(false);
    // numeric strings are coerced
    expect(matchesCondition(cond("amount", "gt", "500"), baseCtx)).toBe(true);
  });

  it("between is inclusive on both ends", () => {
    expect(matchesCondition(cond("amount", "between", [10_000, 20_000]), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "between", [5_000, 10_000]), baseCtx)).toBe(true);
    expect(matchesCondition(cond("amount", "between", [10_001, 20_000]), baseCtx)).toBe(false);
    expect(matchesCondition(cond("amount", "between", [1, 9_999]), baseCtx)).toBe(false);
    expect(matchesCondition(cond("risk_score", "between", [0, 50]), baseCtx)).toBe(true);
  });

  it("missing field: only neq / not_in match", () => {
    const ctx: RoutingContext = { ...baseCtx, country: null, customerCountry: undefined };
    expect(matchesCondition(cond("country", "eq", "US"), ctx)).toBe(false);
    expect(matchesCondition(cond("country", "in", ["US"]), ctx)).toBe(false);
    expect(matchesCondition(cond("country", "gt", 1), ctx)).toBe(false);
    expect(matchesCondition(cond("country", "neq", "US"), ctx)).toBe(true);
    expect(matchesCondition(cond("country", "not_in", ["US"]), ctx)).toBe(true);
    expect(matchesCondition(cond("customer_country", "eq", "DE"), ctx)).toBe(false);
    expect(matchesCondition(cond("customer_country", "neq", "DE"), ctx)).toBe(true);
  });

  it("unknown field never matches with eq", () => {
    expect(matchesCondition({ field: "does_not_exist" as never, op: "eq", value: "x" }, baseCtx)).toBe(false);
    expect(matchesCondition({ field: "does_not_exist" as never, op: "neq", value: "x" }, baseCtx)).toBe(true);
  });

  it("unknown operator never matches", () => {
    expect(matchesCondition({ field: "currency", op: "regex" as never, value: "USD" }, baseCtx)).toBe(false);
  });

  it("risk_score defaults to 0 when absent", () => {
    const ctx: RoutingContext = { ...baseCtx, riskScore: null };
    expect(matchesCondition(cond("risk_score", "eq", 0), ctx)).toBe(true);
    expect(matchesCondition(cond("risk_score", "lt", 1), ctx)).toBe(true);
  });

  it("hour_of_day / day_of_week use ctx.now (UTC)", () => {
    const now = new Date(Date.UTC(2026, 0, 4, 13, 30)); // Sunday 13:30 UTC
    const ctx: RoutingContext = { ...baseCtx, now };
    expect(matchesCondition(cond("hour_of_day", "eq", 13), ctx)).toBe(true);
    expect(matchesCondition(cond("hour_of_day", "between", [9, 17]), ctx)).toBe(true);
    expect(matchesCondition(cond("hour_of_day", "gt", 13), ctx)).toBe(false);
    expect(matchesCondition(cond("day_of_week", "eq", 0), ctx)).toBe(true);
    expect(matchesCondition(cond("day_of_week", "in", [1, 2, 3, 4, 5]), ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesRule / selectRule
// ---------------------------------------------------------------------------
describe("matchesRule", () => {
  it("checks enabled, mode, transaction type, scope and conditions", () => {
    expect(matchesRule(rule(), baseCtx)).toBe(true);
    expect(matchesRule(rule({ enabled: false }), baseCtx)).toBe(false);
    expect(matchesRule(rule({ mode: "live" }), baseCtx)).toBe(false);
    expect(matchesRule(rule({ transactionType: "payout" }), baseCtx)).toBe(false);
    expect(matchesRule(rule({ merchantId: "mer_other" }), baseCtx)).toBe(false);
    expect(matchesRule(rule({ merchantId: "mer_1" }), baseCtx)).toBe(true);
    expect(matchesRule(rule({ projectId: "prj_other" }), baseCtx)).toBe(false);
    expect(matchesRule(rule({ projectId: "prj_1" }), baseCtx)).toBe(true);
    expect(matchesRule(rule({ conditions: [cond("currency", "eq", "USD"), cond("amount", "gt", 100)] }), baseCtx)).toBe(true);
    expect(matchesRule(rule({ conditions: [cond("currency", "eq", "USD"), cond("amount", "gt", 100_000)] }), baseCtx)).toBe(false);
  });
});

describe("selectRule", () => {
  it("prefers merchant-scoped rules over global ones regardless of priority", () => {
    const global = rule({ name: "global", priority: 1 });
    const scoped = rule({ name: "scoped", merchantId: "mer_1", priority: 500 });
    expect(selectRule([global, scoped], baseCtx)?.name).toBe("scoped");
    expect(selectRule([scoped, global], baseCtx)?.name).toBe("scoped");
  });

  it("orders by priority ascending within the same scope", () => {
    const p10 = rule({ name: "p10", priority: 10 });
    const p5 = rule({ name: "p5", priority: 5 });
    const p20 = rule({ name: "p20", priority: 20 });
    expect(selectRule([p10, p20, p5], baseCtx)?.name).toBe("p5");
    const s10 = rule({ name: "s10", merchantId: "mer_1", priority: 10 });
    const s3 = rule({ name: "s3", merchantId: "mer_1", priority: 3 });
    expect(selectRule([p5, s10, s3], baseCtx)?.name).toBe("s3");
  });

  it("breaks priority ties by creation time", () => {
    const older = rule({ name: "older", priority: 10, createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = rule({ name: "newer", priority: 10, createdAt: new Date("2026-02-01T00:00:00Z") });
    expect(selectRule([newer, older], baseCtx)?.name).toBe("older");
  });

  it("skips rules that do not match and returns null when nothing matches", () => {
    const disabled = rule({ name: "disabled", priority: 1, enabled: false });
    const wrongMode = rule({ name: "live", priority: 2, mode: "live" });
    const otherMerchant = rule({ name: "other", priority: 0, merchantId: "mer_x" });
    const noMatch = rule({ name: "eur", priority: 3, conditions: [cond("currency", "eq", "EUR")] });
    const match = rule({ name: "usd", priority: 4, conditions: [cond("currency", "eq", "USD")] });
    expect(selectRule([disabled, wrongMode, otherMerchant, noMatch, match], baseCtx)?.name).toBe("usd");
    expect(selectRule([disabled, wrongMode, otherMerchant, noMatch], baseCtx)).toBeNull();
    expect(selectRule([], baseCtx)).toBeNull();
  });

  it("does not mutate the input array", () => {
    const a = rule({ name: "a", priority: 2 });
    const b = rule({ name: "b", priority: 1 });
    const input = [a, b];
    selectRule(input, baseCtx);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// eligibility
// ---------------------------------------------------------------------------
describe("eligibility", () => {
  it("returns no reasons for a fully eligible candidate", () => {
    expect(eligibility(candidate(), baseCtx)).toEqual([]);
  });

  it("provider disabled", () => {
    expect(eligibility(candidate({ status: "disabled" }), baseCtx)).toContain("provider_disabled");
  });

  it("account disabled", () => {
    expect(eligibility(candidate({}, { status: "disabled" }), baseCtx)).toContain("account_disabled");
  });

  it("mode mismatch", () => {
    expect(eligibility(candidate({}, { mode: "live" }), baseCtx)).toContain("mode_mismatch");
    expect(eligibility(candidate({}, { mode: "live" }), { ...baseCtx, mode: "live" })).toEqual([]);
  });

  it("account dedicated to another merchant", () => {
    expect(eligibility(candidate({}, { merchantId: "mer_other" }), baseCtx)).toContain("account_belongs_to_other_merchant");
    expect(eligibility(candidate({}, { merchantId: "mer_1" }), baseCtx)).toEqual([]);
  });

  it("capabilities: payments / payouts", () => {
    const noPayments = candidate({ capabilities: { payments: false, refunds: true, capture: true, payouts: true } });
    expect(eligibility(noPayments, baseCtx)).toContain("payments_not_supported");
    expect(eligibility(noPayments, { ...baseCtx, transactionType: "payout" })).not.toContain("payouts_not_supported");
    const noPayouts = candidate();
    expect(eligibility(noPayouts, { ...baseCtx, transactionType: "payout" })).toContain("payouts_not_supported");
  });

  it("method not supported (payments only; empty list means any)", () => {
    expect(eligibility(candidate({ supportedMethods: ["wallet"] }), baseCtx)).toContain("method_not_supported");
    expect(eligibility(candidate({ supportedMethods: [] }), { ...baseCtx, paymentMethod: "qr" })).toEqual([]);
    // payouts do not check the payment method list
    const c = candidate({ supportedMethods: ["wallet"], capabilities: { payments: true, refunds: true, capture: true, payouts: true } });
    expect(eligibility(c, { ...baseCtx, transactionType: "payout", paymentMethod: "bank_account" })).toEqual([]);
  });

  it("currency not supported, with account currencies overriding provider currencies", () => {
    expect(eligibility(candidate({ supportedCurrencies: ["EUR"] }), baseCtx)).toContain("currency_not_supported");
    expect(eligibility(candidate({ supportedCurrencies: ["USD"] }), { ...baseCtx, currency: "usd" })).toEqual([]);
    // account restricts to EUR even though the provider supports USD
    expect(eligibility(candidate({ supportedCurrencies: ["USD", "EUR"] }, { currencies: ["EUR"] }), baseCtx)).toContain("currency_not_supported");
    // account explicitly allows USD even though the provider list does not
    expect(eligibility(candidate({ supportedCurrencies: ["EUR"] }, { currencies: ["USD"] }), baseCtx)).toEqual([]);
    // empty lists everywhere = any currency
    expect(eligibility(candidate({ supportedCurrencies: [] }), { ...baseCtx, currency: "KZT" })).toEqual([]);
  });

  it("country not supported (only when a country is known)", () => {
    expect(eligibility(candidate({ supportedCountries: ["VN", "TH"] }), baseCtx)).toContain("country_not_supported");
    expect(eligibility(candidate({ supportedCountries: ["US"] }), { ...baseCtx, country: "us" })).toEqual([]);
    expect(eligibility(candidate({ supportedCountries: ["VN"] }), { ...baseCtx, country: null })).toEqual([]);
  });

  it("min / max amount limits", () => {
    expect(eligibility(candidate({}, { limits: { minAmount: 20_000 } }), baseCtx)).toContain("below_min_amount");
    expect(eligibility(candidate({}, { limits: { maxAmount: 5_000 } }), baseCtx)).toContain("above_max_amount");
    expect(eligibility(candidate({}, { limits: { minAmount: 10_000, maxAmount: 10_000 } }), baseCtx)).toEqual([]);
    expect(eligibility(candidate({}, { limits: null as never }), baseCtx)).toEqual([]);
  });

  it("already attempted", () => {
    const c = candidate();
    expect(eligibility(c, { ...baseCtx, excludeAccountIds: [c.account.id] })).toContain("already_attempted");
    expect(eligibility(c, { ...baseCtx, excludeAccountIds: ["pa_other"] })).toEqual([]);
  });

  it("accumulates several reasons", () => {
    const c = candidate({ status: "disabled", supportedCurrencies: ["EUR"] }, { status: "disabled", mode: "live" });
    const reasons = eligibility(c, baseCtx);
    expect(reasons).toEqual(expect.arrayContaining(["provider_disabled", "account_disabled", "mode_mismatch", "currency_not_supported"]));
  });
});

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------
describe("scoreCandidate", () => {
  it("costBps converts percent + fixed fee into basis points", () => {
    expect(costBps(account("p", { feePercent: "2.0" as never, feeFixedMinor: 0 }), 10_000)).toBe(200);
    expect(costBps(account("p", { feePercent: "0" as never, feeFixedMinor: 100 }), 10_000)).toBe(100);
    expect(costBps(account("p", { feePercent: "1.5" as never, feeFixedMinor: 30 }), 10_000)).toBe(180);
    expect(costBps(account("p", { feePercent: "1" as never, feeFixedMinor: 30 }), 0)).toBe(100);
  });

  it("cheaper provider scores higher, all else equal", () => {
    const cheap = candidate({}, { feePercent: "1.0" as never, feeFixedMinor: 0 });
    const pricey = candidate({}, { feePercent: "3.0" as never, feeFixedMinor: 50 });
    const sc = scoreCandidate(cheap, baseCtx);
    const sp = scoreCandidate(pricey, baseCtx);
    expect(sc.score).toBeGreaterThan(sp.score);
    expect(sc.factors.cost_bps).toBe(100);
    expect(sp.factors.cost_bps).toBe(350);
  });

  it("better approval rate scores higher, all else equal", () => {
    const stats = (approvalRate: number): ProviderStats => ({ approvalRate, uptime: 1, avgLatencyMs: 300, sampleSize: 50 });
    const good = candidate({}, {}, stats(0.98));
    const bad = candidate({}, {}, stats(0.7));
    expect(scoreCandidate(good, baseCtx).score).toBeGreaterThan(scoreCandidate(bad, baseCtx).score);
    expect(scoreCandidate(good, baseCtx).factors.approval_rate).toBe(0.98);
  });

  it("better uptime and lower latency score higher", () => {
    const base: ProviderStats = { approvalRate: 0.9, uptime: 1, avgLatencyMs: 300, sampleSize: 50 };
    const up = candidate({}, {}, base);
    const down = candidate({}, {}, { ...base, uptime: 0.5 });
    expect(scoreCandidate(up, baseCtx).score).toBeGreaterThan(scoreCandidate(down, baseCtx).score);
    const fast = candidate({}, {}, base);
    const slow = candidate({}, {}, { ...base, avgLatencyMs: 2_500 });
    expect(scoreCandidate(fast, baseCtx).score).toBeGreaterThan(scoreCandidate(slow, baseCtx).score);
  });

  it("ignores stats with a small sample and falls back to defaults", () => {
    const tiny = candidate({}, {}, { approvalRate: 0.1, uptime: 0.1, avgLatencyMs: 2_900, sampleSize: 4 });
    const none = candidate({}, {});
    expect(scoreCandidate(tiny, baseCtx).score).toBe(scoreCandidate(none, baseCtx).score);
    expect(scoreCandidate(tiny, baseCtx).factors).toMatchObject({ approval_rate: 0.9, uptime: 1, avg_latency_ms: 300 });
  });

  it("lower priority number is a (tiny) tiebreak in favour of the account", () => {
    const a = candidate({}, { priority: 10 });
    const b = candidate({}, { priority: 90 });
    expect(scoreCandidate(a, baseCtx).score).toBeGreaterThan(scoreCandidate(b, baseCtx).score);
    expect(scoreCandidate(a, baseCtx).score - scoreCandidate(b, baseCtx).score).toBeLessThan(0.02);
  });

  it("respects custom weights", () => {
    const cheap = candidate({}, { feePercent: "0.5" as never });
    const pricey = candidate({}, { feePercent: "4.0" as never });
    const noCostWeight = { ...DEFAULT_WEIGHTS, cost: 0 };
    expect(scoreCandidate(cheap, baseCtx, noCostWeight).score).toBeCloseTo(scoreCandidate(pricey, baseCtx, noCostWeight).score, 3);
  });
});

// ---------------------------------------------------------------------------
// buildRoute
// ---------------------------------------------------------------------------
describe("buildRoute", () => {
  function pool() {
    const a = candidate({ name: "A" }, { name: "A·test", priority: 10, feePercent: "2.4" as never, feeFixedMinor: 20 });
    const b = candidate({ name: "B" }, { name: "B·test", priority: 20, feePercent: "2.9" as never, feeFixedMinor: 30 });
    const c = candidate({ name: "C" }, { name: "C·test", priority: 30, feePercent: "1.2" as never, feeFixedMinor: 0 });
    return { a, b, c, all: [a, b, c] };
  }

  it("ordered strategy follows route positions and filters ineligible accounts", () => {
    const { a, b, c, all } = pool();
    const r = rule({ name: "cards", strategy: "ordered", conditions: [cond("payment_method", "eq", "card")] }, [b.account.id, a.account.id, c.account.id]);
    const res = buildRoute([r], all, { ...baseCtx, excludeAccountIds: [a.account.id] });
    expect(res.rule?.id).toBe(r.id);
    expect(res.strategy).toBe("ordered");
    expect(res.reason).toBe('rule "cards" matched');
    expect(res.ordered.map((x) => x.provider.name)).toEqual(["B", "C"]);
    expect(res.candidates).toHaveLength(3);
    const evalA = res.candidates.find((x) => x.providerAccountId === a.account.id)!;
    expect(evalA.eligible).toBe(false);
    expect(evalA.reasons).toEqual(["already_attempted"]);
    expect(evalA.providerName).toBe("A");
    expect(evalA.accountName).toBe("A·test");
    expect(typeof evalA.score).toBe("number");
    expect(evalA.factors).toBeDefined();
    for (const x of res.candidates.filter((y) => y.providerAccountId !== a.account.id)) expect(x.eligible).toBe(true);
  });

  it("ordered strategy skips route entries that reference unknown accounts", () => {
    const { a, b, all } = pool();
    const r = rule({ strategy: "ordered" }, ["pa_missing", b.account.id, a.account.id]);
    const res = buildRoute([r], all, baseCtx);
    expect(res.ordered.map((x) => x.account.id)).toEqual([b.account.id, a.account.id]);
    expect(res.candidates).toHaveLength(2);
  });

  it("score strategy orders by descending score", () => {
    const { a, b, c, all } = pool();
    const r = rule({ strategy: "score" }, [a.account.id, b.account.id, c.account.id]);
    const res = buildRoute([r], all, baseCtx);
    expect(res.strategy).toBe("score");
    const scores = res.ordered.map((x) => scoreCandidate(x, baseCtx).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]!);
    // C is the cheapest → first
    expect(res.ordered[0]!.provider.name).toBe("C");
  });

  it("score strategy breaks ties by account priority", () => {
    const x = candidate({ name: "X" }, { priority: 50, feePercent: "2" as never });
    const y = candidate({ name: "Y" }, { priority: 5, feePercent: "2" as never });
    const r = rule({ strategy: "score" }, [x.account.id, y.account.id]);
    const res = buildRoute([r], [x, y], baseCtx);
    expect(res.ordered.map((c) => c.provider.name)).toEqual(["Y", "X"]);
  });

  it("weighted strategy is deterministic for the same seed and is a permutation of the eligible set", () => {
    const { a, b, c, all } = pool();
    const r = rule({ strategy: "weighted" }, [
      { id: a.account.id, weight: 70 },
      { id: b.account.id, weight: 20 },
      { id: c.account.id, weight: 10 },
    ]);
    const first = buildRoute([r], all, { ...baseCtx, seed: "pay_abc" });
    const second = buildRoute([r], all, { ...baseCtx, seed: "pay_abc" });
    expect(first.strategy).toBe("weighted");
    expect(first.ordered.map((x) => x.account.id)).toEqual(second.ordered.map((x) => x.account.id));
    expect([...first.ordered.map((x) => x.account.id)].sort()).toEqual([a.account.id, b.account.id, c.account.id].sort());
    // Also deterministic without a seed (falls back to the merchant id).
    const noSeed1 = buildRoute([r], all, { ...baseCtx, seed: undefined });
    const noSeed2 = buildRoute([r], all, { ...baseCtx, seed: undefined });
    expect(noSeed1.ordered.map((x) => x.account.id)).toEqual(noSeed2.ordered.map((x) => x.account.id));
  });

  it("weighted strategy varies with the seed over many payments and favours the heavy weight", () => {
    const { a, b, c, all } = pool();
    const r = rule({ strategy: "weighted" }, [
      { id: a.account.id, weight: 90 },
      { id: b.account.id, weight: 5 },
      { id: c.account.id, weight: 5 },
    ]);
    const firsts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const res = buildRoute([r], all, { ...baseCtx, seed: `pay_${i}` });
      const id = res.ordered[0]!.account.id;
      firsts.set(id, (firsts.get(id) ?? 0) + 1);
    }
    expect(firsts.get(a.account.id) ?? 0).toBeGreaterThan(120);
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("falls back to default scoring over all candidates when no rule matches", () => {
    const { a, b, c, all } = pool();
    const eur = rule({ strategy: "ordered", conditions: [cond("currency", "eq", "EUR")] }, [a.account.id]);
    const res = buildRoute([eur], all, baseCtx);
    expect(res.rule).toBeNull();
    expect(res.strategy).toBe("score");
    expect(res.reason).toBe("no rule matched; default scoring used");
    expect(res.ordered).toHaveLength(3);
    expect(res.ordered[0]!.provider.name).toBe("C");
    expect(res.candidates.map((x) => x.providerAccountId).sort()).toEqual([a.account.id, b.account.id, c.account.id].sort());
  });

  it("falls back to default scoring when the matched rule has no routes", () => {
    const { all } = pool();
    const empty = rule({ name: "empty", strategy: "ordered" }, []);
    const res = buildRoute([empty], all, baseCtx);
    expect(res.rule?.id).toBe(empty.id);
    expect(res.strategy).toBe("score");
    expect(res.reason).toBe('rule "empty" matched but has no providers; default scoring used');
    expect(res.ordered).toHaveLength(3);
  });

  it("returns an empty ordered list when nothing is eligible", () => {
    const { a, b, all } = pool();
    const r = rule({ strategy: "ordered" }, [a.account.id, b.account.id]);
    const res = buildRoute([r], all, { ...baseCtx, currency: "JPY" });
    expect(res.ordered).toEqual([]);
    expect(res.candidates.every((x) => !x.eligible && x.reasons.includes("currency_not_supported"))).toBe(true);
  });

  it("excludes already attempted accounts from the fallback route", () => {
    const { a, b, c, all } = pool();
    const res = buildRoute([], all, { ...baseCtx, excludeAccountIds: [a.account.id, c.account.id] });
    expect(res.ordered.map((x) => x.account.id)).toEqual([b.account.id]);
  });
});
