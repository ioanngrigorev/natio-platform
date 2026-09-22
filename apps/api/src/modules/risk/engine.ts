/**
 * Rule-based risk engine (pure evaluation). NATIO's risk layer is a first line of
 * defence for orchestration decisions; it does not replace a full AML/fraud platform.
 */
import type { RiskCondition, riskRules } from "../../db/schema/index.js";

export type RiskRuleRow = typeof riskRules.$inferSelect;
export type RiskDecision = "allow" | "review" | "block";

export interface RiskSignals {
  country?: string | null;
  amount: number;
  currency: string;
  paymentMethod: string;
  merchantId: string;
  ip?: string | null;
  deviceFingerprint?: string | null;
  customerEmail?: string | null;
  /** Number of payments from the same customer/IP in the last hour. */
  velocity1h?: number;
  velocity24h?: number;
  failedAttempts24h?: number;
  amount24h?: number;
  /** Sandbox hint: "review" | "block" force a decision in test mode. */
  testScenario?: string | null;
}

export interface RiskResult {
  decision: RiskDecision;
  score: number;
  matched: Array<{ id: string; name: string; action: RiskDecision; score: number }>;
}

function value(field: RiskCondition["field"], s: RiskSignals): string | number | null | undefined {
  switch (field) {
    case "country":
      return s.country?.toUpperCase() ?? null;
    case "amount":
      return s.amount;
    case "currency":
      return s.currency.toUpperCase();
    case "payment_method":
      return s.paymentMethod;
    case "merchant_id":
      return s.merchantId;
    case "ip":
      return s.ip ?? null;
    case "device_fingerprint":
      return s.deviceFingerprint ?? null;
    case "customer_email":
      return s.customerEmail?.toLowerCase() ?? null;
    case "velocity_1h":
      return s.velocity1h ?? 0;
    case "velocity_24h":
      return s.velocity24h ?? 0;
    case "failed_attempts_24h":
      return s.failedAttempts24h ?? 0;
    case "amount_24h":
      return s.amount24h ?? 0;
    default:
      return undefined;
  }
}

function norm(v: unknown): string | number {
  return typeof v === "number" ? v : String(v).toUpperCase();
}

export function matchesRiskCondition(c: RiskCondition, s: RiskSignals): boolean {
  const actual = value(c.field, s);
  if (actual === null || actual === undefined) return c.op === "neq" || c.op === "not_in";
  const a = norm(actual);
  const list = Array.isArray(c.value) ? c.value.map(norm) : [norm(c.value)];
  const v = list[0];
  switch (c.op) {
    case "eq":
      return a === v;
    case "neq":
      return a !== v;
    case "in":
      return list.includes(a);
    case "not_in":
      return !list.includes(a);
    case "gt":
      return Number(a) > Number(v);
    case "gte":
      return Number(a) >= Number(v);
    case "lt":
      return Number(a) < Number(v);
    case "lte":
      return Number(a) <= Number(v);
    default:
      return false;
  }
}

const RANK: Record<RiskDecision, number> = { allow: 0, review: 1, block: 2 };

export function evaluateRisk(rules: RiskRuleRow[], signals: RiskSignals, mode: "test" | "live"): RiskResult {
  const matched: RiskResult["matched"] = [];
  let decision: RiskDecision = "allow";
  let score = 0;
  const sorted = [...rules].filter((r) => r.enabled && r.mode === mode).sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (rule.merchantId && rule.merchantId !== signals.merchantId) continue;
    if (!rule.conditions.length) continue;
    if (rule.conditions.every((c) => matchesRiskCondition(c, signals))) {
      matched.push({ id: rule.id, name: rule.name, action: rule.action, score: rule.score });
      score += rule.score;
      if (RANK[rule.action] > RANK[decision]) decision = rule.action;
    }
  }
  score = Math.min(100, score);
  if (decision === "allow" && score >= 80) decision = "review";
  if (mode === "test" && (signals.testScenario === "review" || signals.testScenario === "block")) {
    decision = signals.testScenario;
    matched.push({ id: "sandbox", name: `Sandbox scenario "${signals.testScenario}"`, action: decision, score: decision === "block" ? 100 : 60 });
    score = decision === "block" ? 100 : Math.max(score, 60);
  }
  return { decision, score, matched };
}
