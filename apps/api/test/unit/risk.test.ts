import { describe, expect, it } from "vitest";
import type { RiskCondition } from "../../src/db/schema/index.js";
import { evaluateRisk, matchesRiskCondition, type RiskRuleRow, type RiskSignals } from "../../src/modules/risk/engine.js";

let seq = 0;

function riskRule(over: Partial<RiskRuleRow> & { conditions: RiskCondition[] }): RiskRuleRow {
  const id = over.id ?? `rk_${String(++seq).padStart(4, "0")}`;
  return {
    id,
    merchantId: null,
    mode: "test",
    name: over.name ?? `Rule ${id}`,
    description: null,
    priority: 100,
    enabled: true,
    action: "review",
    score: 0,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as RiskRuleRow;
}

const signals: RiskSignals = {
  country: "us",
  amount: 50_000,
  currency: "usd",
  paymentMethod: "card",
  merchantId: "mer_1",
  ip: "203.0.113.9",
  deviceFingerprint: "fp_1",
  customerEmail: "Buyer@Example.com",
  velocity1h: 2,
  velocity24h: 5,
  failedAttempts24h: 1,
  amount24h: 120_000,
};

const c = (field: RiskCondition["field"], op: RiskCondition["op"], value: RiskCondition["value"]): RiskCondition => ({ field, op, value });

describe("matchesRiskCondition", () => {
  it("compares strings case-insensitively and numbers numerically", () => {
    expect(matchesRiskCondition(c("country", "eq", "US"), signals)).toBe(true);
    expect(matchesRiskCondition(c("currency", "in", ["EUR", "usd"]), signals)).toBe(true);
    expect(matchesRiskCondition(c("payment_method", "neq", "card"), signals)).toBe(false);
    expect(matchesRiskCondition(c("merchant_id", "eq", "mer_1"), signals)).toBe(true);
    expect(matchesRiskCondition(c("ip", "eq", "203.0.113.9"), signals)).toBe(true);
    expect(matchesRiskCondition(c("device_fingerprint", "eq", "fp_1"), signals)).toBe(true);
    expect(matchesRiskCondition(c("customer_email", "eq", "buyer@example.com"), signals)).toBe(true);
    expect(matchesRiskCondition(c("amount", "gte", 50_000), signals)).toBe(true);
    expect(matchesRiskCondition(c("amount", "gt", 50_000), signals)).toBe(false);
    expect(matchesRiskCondition(c("amount", "lt", 50_001), signals)).toBe(true);
    expect(matchesRiskCondition(c("amount", "lte", 49_999), signals)).toBe(false);
    expect(matchesRiskCondition(c("velocity_1h", "gt", 1), signals)).toBe(true);
    expect(matchesRiskCondition(c("velocity_24h", "eq", 5), signals)).toBe(true);
    expect(matchesRiskCondition(c("failed_attempts_24h", "gte", 5), signals)).toBe(false);
    expect(matchesRiskCondition(c("amount_24h", "gt", 100_000), signals)).toBe(true);
    expect(matchesRiskCondition(c("country", "not_in", ["KP", "IR"]), signals)).toBe(true);
  });

  it("missing signals only satisfy neq / not_in; velocity signals default to 0", () => {
    const s: RiskSignals = { amount: 1, currency: "USD", paymentMethod: "card", merchantId: "m" };
    expect(matchesRiskCondition(c("country", "eq", "US"), s)).toBe(false);
    expect(matchesRiskCondition(c("country", "in", ["US"]), s)).toBe(false);
    expect(matchesRiskCondition(c("country", "neq", "US"), s)).toBe(true);
    expect(matchesRiskCondition(c("country", "not_in", ["US"]), s)).toBe(true);
    expect(matchesRiskCondition(c("ip", "eq", "1.2.3.4"), s)).toBe(false);
    expect(matchesRiskCondition(c("customer_email", "neq", "x"), s)).toBe(true);
    expect(matchesRiskCondition(c("velocity_1h", "eq", 0), s)).toBe(true);
    expect(matchesRiskCondition(c("failed_attempts_24h", "lt", 1), s)).toBe(true);
    expect(matchesRiskCondition({ field: "bogus" as never, op: "eq", value: 1 }, s)).toBe(false);
    expect(matchesRiskCondition({ field: "amount", op: "between" as never, value: [0, 10] }, s)).toBe(false);
  });
});

describe("evaluateRisk", () => {
  it("allows with score 0 when no rules match", () => {
    const rules = [riskRule({ conditions: [c("country", "in", ["KP", "IR"])], action: "block", score: 100 })];
    expect(evaluateRisk(rules, signals, "test")).toEqual({ decision: "allow", score: 0, matched: [] });
    expect(evaluateRisk([], signals, "test")).toEqual({ decision: "allow", score: 0, matched: [] });
  });

  it("block wins over review (and review over allow) regardless of order", () => {
    const review = riskRule({ name: "review", priority: 1, conditions: [c("amount", "gte", 1)], action: "review", score: 20 });
    const block = riskRule({ name: "block", priority: 50, conditions: [c("country", "eq", "US")], action: "block", score: 30 });
    const allow = riskRule({ name: "allow", priority: 99, conditions: [c("currency", "eq", "USD")], action: "allow", score: 5 });
    const r1 = evaluateRisk([review, block, allow], signals, "test");
    expect(r1.decision).toBe("block");
    expect(r1.score).toBe(55);
    expect(r1.matched.map((m) => m.name)).toEqual(["review", "block", "allow"]);
    const r2 = evaluateRisk([block, allow, review], signals, "test");
    expect(r2.decision).toBe("block");
    expect(r2.matched.map((m) => m.name)).toEqual(["review", "block", "allow"]); // sorted by priority
    const r3 = evaluateRisk([allow, review], signals, "test");
    expect(r3.decision).toBe("review");
  });

  it("accumulates scores and caps at 100", () => {
    const rules = [
      riskRule({ conditions: [c("amount", "gt", 1)], action: "review", score: 60 }),
      riskRule({ conditions: [c("amount", "gt", 2)], action: "review", score: 60 }),
      riskRule({ conditions: [c("amount", "gt", 3)], action: "review", score: 60 }),
    ];
    const r = evaluateRisk(rules, signals, "test");
    expect(r.score).toBe(100);
    expect(r.matched).toHaveLength(3);
    expect(r.matched.every((m) => m.score === 60)).toBe(true);
  });

  it("ignores disabled rules", () => {
    const rules = [riskRule({ enabled: false, conditions: [c("amount", "gt", 1)], action: "block", score: 100 })];
    expect(evaluateRisk(rules, signals, "test")).toEqual({ decision: "allow", score: 0, matched: [] });
  });

  it("applies merchant-scoped rules only to that merchant", () => {
    const scoped = riskRule({ merchantId: "mer_1", conditions: [c("amount", "gt", 1)], action: "block", score: 100 });
    const other = riskRule({ merchantId: "mer_2", conditions: [c("amount", "gt", 1)], action: "block", score: 100 });
    expect(evaluateRisk([other], signals, "test").decision).toBe("allow");
    expect(evaluateRisk([scoped], signals, "test").decision).toBe("block");
    expect(evaluateRisk([other, scoped], { ...signals, merchantId: "mer_2" }, "test").decision).toBe("block");
    expect(evaluateRisk([other, scoped], { ...signals, merchantId: "mer_2" }, "test").matched.map((m) => m.id)).toEqual([other.id]);
    expect(evaluateRisk([other, scoped], { ...signals, merchantId: "mer_3" }, "test").decision).toBe("allow");
  });

  it("ignores rules of the other mode", () => {
    const live = riskRule({ mode: "live", conditions: [c("amount", "gt", 1)], action: "block", score: 100 });
    expect(evaluateRisk([live], signals, "test").decision).toBe("allow");
    expect(evaluateRisk([live], signals, "live").decision).toBe("block");
  });

  it("skips rules with no conditions", () => {
    const empty = riskRule({ conditions: [], action: "block", score: 100 });
    expect(evaluateRisk([empty], signals, "test")).toEqual({ decision: "allow", score: 0, matched: [] });
  });

  it("requires every condition of a rule to match", () => {
    const rule = riskRule({ conditions: [c("country", "eq", "US"), c("amount", "gt", 1_000_000)], action: "block", score: 100 });
    expect(evaluateRisk([rule], signals, "test").decision).toBe("allow");
    expect(evaluateRisk([rule], { ...signals, amount: 2_000_000 }, "test").decision).toBe("block");
  });

  it("escalates allow to review when the accumulated score reaches 80", () => {
    const a = riskRule({ conditions: [c("amount", "gt", 1)], action: "allow", score: 50 });
    const b = riskRule({ conditions: [c("amount", "gt", 2)], action: "allow", score: 29 });
    const cRule = riskRule({ conditions: [c("amount", "gt", 3)], action: "allow", score: 1 });
    const under = evaluateRisk([a, b], signals, "test");
    expect(under.score).toBe(79);
    expect(under.decision).toBe("allow");
    const at = evaluateRisk([a, b, cRule], signals, "test");
    expect(at.score).toBe(80);
    expect(at.decision).toBe("review");
    // an explicit block is not downgraded by the score rule
    const block = riskRule({ conditions: [c("amount", "gt", 1)], action: "block", score: 0 });
    expect(evaluateRisk([block], signals, "test").decision).toBe("block");
  });

  it("sandbox scenario forces review/block in test mode only", () => {
    const rules = [riskRule({ conditions: [c("amount", "gt", 1)], action: "allow", score: 10 })];
    const block = evaluateRisk(rules, { ...signals, testScenario: "block" }, "test");
    expect(block.decision).toBe("block");
    expect(block.score).toBe(100);
    expect(block.matched.at(-1)).toEqual({ id: "sandbox", name: 'Sandbox scenario "block"', action: "block", score: 100 });

    const review = evaluateRisk(rules, { ...signals, testScenario: "review" }, "test");
    expect(review.decision).toBe("review");
    expect(review.score).toBe(60);
    expect(review.matched.at(-1)).toMatchObject({ id: "sandbox", action: "review", score: 60 });

    // a higher accumulated score is kept for review
    const high = [riskRule({ conditions: [c("amount", "gt", 1)], action: "allow", score: 75 })];
    expect(evaluateRisk(high, { ...signals, testScenario: "review" }, "test").score).toBe(75);

    // live mode ignores the hint entirely
    const liveRules = rules.map((r) => ({ ...r, mode: "live" as const }));
    const live = evaluateRisk(liveRules, { ...signals, testScenario: "block" }, "live");
    expect(live.decision).toBe("allow");
    expect(live.score).toBe(10);
    expect(live.matched.some((m) => m.id === "sandbox")).toBe(false);

    // other scenario names are not risk hints
    expect(evaluateRisk(rules, { ...signals, testScenario: "failover" }, "test").decision).toBe("allow");
    expect(evaluateRisk(rules, { ...signals, testScenario: null }, "test").decision).toBe("allow");
  });

  it("sandbox block overrides an explicit review (and vice versa the hint wins)", () => {
    const blockRule = riskRule({ conditions: [c("country", "eq", "US")], action: "block", score: 100 });
    // the hint is applied last and sets the decision verbatim
    const r = evaluateRisk([blockRule], { ...signals, testScenario: "review" }, "test");
    expect(r.decision).toBe("review");
    expect(r.score).toBe(100);
  });

  it("reports matched rules with id, name, action and score", () => {
    const rule = riskRule({ id: "rk_velocity", name: "Velocity", priority: 20, conditions: [c("velocity_1h", "gt", 1)], action: "review", score: 40 });
    const r = evaluateRisk([rule], signals, "test");
    expect(r.matched).toEqual([{ id: "rk_velocity", name: "Velocity", action: "review", score: 40 }]);
    expect(r.decision).toBe("review");
    expect(r.score).toBe(40);
  });

  it("does not mutate the input rule list", () => {
    const a = riskRule({ priority: 5, conditions: [c("amount", "gt", 1)] });
    const b = riskRule({ priority: 1, conditions: [c("amount", "gt", 1)] });
    const list = [a, b];
    evaluateRisk(list, signals, "test");
    expect(list[0]).toBe(a);
  });
});
