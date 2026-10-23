/**
 * Deterministic routing engine (pure functions, no I/O).
 *
 * 1. Rules are evaluated in priority order; the first enabled rule whose scope and conditions match wins.
 * 2. The rule's provider routes (or, without a rule, every eligible account) are filtered for eligibility
 *    (status, mode, method/currency/country support, limits, capabilities).
 * 3. Candidates are ordered by the rule's strategy: ordered (explicit list), weighted (deterministic
 *    weighted draw seeded by the payment id) or score (cost, approval rate, uptime, latency, priority).
 *
 * The scoring function is intentionally simple and transparent; it is the extension point for an
 * ML-based ranker later (same input: candidates + stats + context, same output: ordered candidates).
 */
import type { RoutingCandidate, RoutingPolicy, RuleCondition, providerAccounts, providerRoutes, providers, routingRules } from "../../db/schema/index.js";
import type { PricingSnapshot } from "../pricing/engine.js";
import { sha256Hex } from "../../lib/crypto.js";

export type RuleRow = typeof routingRules.$inferSelect;
export type RouteRow = typeof providerRoutes.$inferSelect;
export type AccountRow = typeof providerAccounts.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;

export interface RuleWithRoutes extends RuleRow {
  routes: RouteRow[];
}

export interface ProviderStats {
  /** Share of attempts that ended in success (0..1). */
  approvalRate: number;
  /** 1 - share of technical failures (0..1). */
  uptime: number;
  avgLatencyMs: number;
  sampleSize: number;
}

export interface Candidate {
  account: AccountRow;
  provider: ProviderRow;
  stats?: ProviderStats;
  pricing?: PricingSnapshot;
  pricingError?: string;
}

export interface RoutingContext {
  transactionType: "payment" | "payout";
  merchantId: string;
  projectId: string;
  mode: "test" | "live";
  amount: number;
  currency: string;
  paymentMethod: string;
  country?: string | null;
  customerCountry?: string | null;
  riskScore?: number | null;
  now?: Date;
  /** Seed for deterministic weighted routing (payment id). */
  seed?: string;
  /** Accounts already attempted for this payment, excluded from the route. */
  excludeAccountIds?: string[];
  policyOverride?: RoutingPolicy;
  /** Read-only simulation override; execution callers never set this. */
  strategyOverride?: "ordered" | "weighted" | "score";
  captureMethod?: "automatic" | "manual";
}

export interface ScoreWeights {
  cost: number;
  approval: number;
  uptime: number;
  latency: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { cost: 30, approval: 40, uptime: 20, latency: 10 };

export interface RoutingResult {
  rule: RuleRow | null;
  strategy: "ordered" | "weighted" | "score";
  ordered: Candidate[];
  candidates: RoutingCandidate[];
  reason: string;
  policy: RoutingPolicy;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------
function fieldValue(field: RuleCondition["field"], ctx: RoutingContext): string | number | null | undefined {
  const now = ctx.now ?? new Date();
  switch (field) {
    case "country":
      return ctx.country?.toUpperCase() ?? null;
    case "customer_country":
      return ctx.customerCountry?.toUpperCase() ?? null;
    case "currency":
      return ctx.currency.toUpperCase();
    case "merchant_id":
      return ctx.merchantId;
    case "project_id":
      return ctx.projectId;
    case "payment_method":
      return ctx.paymentMethod;
    case "amount":
      return ctx.amount;
    case "transaction_type":
      return ctx.transactionType;
    case "risk_score":
      return ctx.riskScore ?? null;
    case "hour_of_day":
      return now.getUTCHours();
    case "day_of_week":
      return now.getUTCDay();
    default:
      return undefined;
  }
}

function normalize(v: unknown): string | number {
  if (typeof v === "number") return v;
  return String(v).toUpperCase();
}

export function matchesCondition(cond: RuleCondition, ctx: RoutingContext): boolean {
  const actual = fieldValue(cond.field, ctx);
  if (actual === undefined || actual === null) return cond.op === "neq" || cond.op === "not_in";
  const a = normalize(actual);
  const list = Array.isArray(cond.value) ? cond.value.map(normalize) : [normalize(cond.value)];
  const v = list[0];
  switch (cond.op) {
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
    case "between": {
      const [lo, hi] = list;
      return Number(a) >= Number(lo) && Number(a) <= Number(hi);
    }
    default:
      return false;
  }
}

export function matchesRule(rule: RuleRow, ctx: RoutingContext): boolean {
  if (!rule.enabled) return false;
  if (rule.mode !== ctx.mode) return false;
  if (rule.transactionType !== ctx.transactionType) return false;
  if (rule.merchantId && rule.merchantId !== ctx.merchantId) return false;
  if (rule.projectId && rule.projectId !== ctx.projectId) return false;
  return (rule.conditions ?? []).every((c) => matchesCondition(c, ctx));
}

/** First matching rule by (merchant-specific before global, then priority ascending). */
export function selectRule(rules: RuleWithRoutes[], ctx: RoutingContext): RuleWithRoutes | null {
  const sorted = [...rules].sort((a, b) => {
    const scopeA = a.projectId ? 0 : a.merchantId ? 1 : 2;
    const scopeB = b.projectId ? 0 : b.merchantId ? 1 : 2;
    if (scopeA !== scopeB) return scopeA - scopeB;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return sorted.find((r) => matchesRule(r, ctx)) ?? null;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------
export function eligibility(c: Candidate, ctx: RoutingContext): string[] {
  const reasons: string[] = [];
  const { account, provider } = c;
  if (provider.status !== "active") reasons.push("provider_disabled");
  if (account.status !== "active") reasons.push("account_disabled");
  if (account.mode !== ctx.mode) reasons.push("mode_mismatch");
  if (account.merchantId && account.merchantId !== ctx.merchantId) reasons.push("account_belongs_to_other_merchant");
  if (ctx.transactionType === "payment" && !provider.capabilities?.payments) reasons.push("payments_not_supported");
  if (ctx.transactionType === "payout" && !provider.capabilities?.payouts) reasons.push("payouts_not_supported");
  if (ctx.transactionType === "payment" && provider.supportedMethods.length && !provider.supportedMethods.includes(ctx.paymentMethod)) {
    reasons.push("method_not_supported");
  }
  // A quick connection may opt into only one of the adapter's methods.
  // Enforce that choice during routing, not just in the setup interface.
  const accountMethods=account.config?.paymentMethods;
  if(ctx.transactionType==='payment' && accountMethods!==undefined &&
    (!Array.isArray(accountMethods)||!accountMethods.includes(ctx.paymentMethod))) reasons.push('account_method_not_supported');
  const currencies = account.currencies.length ? account.currencies : provider.supportedCurrencies;
  if (currencies.length && !currencies.includes(ctx.currency.toUpperCase())) reasons.push("currency_not_supported");
  if (provider.supportedCountries.length && (!ctx.country || !provider.supportedCountries.includes(ctx.country.toUpperCase()))) reasons.push(ctx.country ? "country_not_supported" : "country_required");
  if (ctx.captureMethod === "manual" && !provider.capabilities?.capture) reasons.push("manual_capture_not_supported");
  const limits = account.limits ?? {};
  if (limits.minAmount != null && ctx.amount < limits.minAmount) reasons.push("below_min_amount");
  if (limits.maxAmount != null && ctx.amount > limits.maxAmount) reasons.push("above_max_amount");
  if (ctx.excludeAccountIds?.includes(account.id)) reasons.push("already_attempted");
  return reasons;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
export function costBps(account: AccountRow, amount: number): number {
  const pct = Number(account.feePercent ?? 0) * 100; // percent → bps
  const fixed = amount > 0 ? (Number(account.feeFixedMinor ?? 0) / amount) * 10000 : 0;
  return pct + fixed;
}

export function scoreCandidate(c: Candidate, ctx: RoutingContext, weights: ScoreWeights = DEFAULT_WEIGHTS): { score: number; factors: Record<string, number> } {
  const stats = c.stats;
  const approval = stats && stats.sampleSize >= 5 ? stats.approvalRate : 0.9;
  const uptime = stats && stats.sampleSize >= 5 ? stats.uptime : 1;
  const latency = stats && stats.sampleSize >= 5 ? stats.avgLatencyMs : 300;
  const cost = c.pricing ? c.pricing.provider.amount / ctx.amount * 10000 : costBps(c.account, ctx.amount);

  const costPenalty = (Math.min(cost, 500) / 500) * weights.cost;
  const approvalScore = approval * weights.approval;
  const uptimeScore = uptime * weights.uptime;
  const latencyPenalty = (Math.min(latency, 3000) / 3000) * weights.latency;
  const priorityTiebreak = (c.account.priority ?? 100) / 10000;

  const score = round(approvalScore + uptimeScore - costPenalty - latencyPenalty - priorityTiebreak);
  return {
    score,
    factors: {
      cost_bps: round(cost),
      approval_rate: round(approval),
      uptime: round(uptime),
      avg_latency_ms: Math.round(latency),
      priority: c.account.priority,
      sample_size: stats?.sampleSize ?? 0,
      ...(c.pricing ? { merchant_fee: c.pricing.merchant.amount, provider_cost: c.pricing.provider.amount, margin: c.pricing.margin } : {}),
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Deterministic PRNG (mulberry32) seeded from a string.
function seededRandom(seed: string): () => number {
  let a = Number.parseInt(sha256Hex(seed).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedOrder<T>(items: T[], weightOf: (t: T) => number, seed: string): T[] {
  const rnd = seededRandom(seed);
  const pool = [...items];
  const out: T[] = [];
  while (pool.length) {
    const total = pool.reduce((s, i) => s + Math.max(weightOf(i), 0), 0);
    let r = rnd() * (total || 1);
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= Math.max(weightOf(pool[i]!), 0);
      if (r <= 0) {
        idx = i;
        break;
      }
      idx = i;
    }
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route building
// ---------------------------------------------------------------------------
export function buildRoute(rules: RuleWithRoutes[], allCandidates: Candidate[], ctx: RoutingContext, weights = DEFAULT_WEIGHTS): RoutingResult {
  const rule = selectRule(rules, ctx);
  const policy = ctx.policyOverride ?? rule?.policy ?? {};
  const profiles: Record<string, ScoreWeights> = { balanced: DEFAULT_WEIGHTS, conversion: { cost: 10, approval: 65, uptime: 20, latency: 5 }, cost: { cost: 65, approval: 15, uptime: 15, latency: 5 }, reliability: { cost: 5, approval: 25, uptime: 55, latency: 15 } };
  if (policy.profile) weights = profiles[policy.profile] ?? weights;
  const byId = new Map(allCandidates.map((c) => [c.account.id, c] as const));
  const evaluated: RoutingCandidate[] = [];

  const describe = (c: Candidate, reasons: string[], score: number, factors: Record<string, number>): RoutingCandidate => ({
    providerAccountId: c.account.id,
    providerId: c.provider.id,
    providerName: c.provider.name,
    accountName: c.account.name,
    score,
    eligible: reasons.length === 0,
    reasons,
    factors,
  });

  let pool: Candidate[];
  let strategy: RoutingResult["strategy"];
  let reason: string;
  const routeWeights = new Map<string, number>();

  if (rule && (rule.routes.length || rule.strategy !== "score")) {
    strategy = rule.strategy;
    reason = `rule "${rule.name}" matched`;
    const sortedRoutes = [...rule.routes].sort((a, b) => a.position - b.position);
    pool = [];
    for (const r of sortedRoutes) {
      const c = byId.get(r.providerAccountId);
      if (!c) continue;
      routeWeights.set(c.account.id, r.weight);
      pool.push(c);
    }
  } else {
    strategy = "score";
    reason = rule ? `rule "${rule.name}" scores all eligible accounts` : "no rule matched; default scoring used";
    pool = allCandidates;
  }

  const eligible: Candidate[] = [];
  for (const c of pool) {
    const reasons = eligibility(c, ctx);
    if (c.pricingError) reasons.push("pricing_configuration_error");
    if (c.pricing?.warnings.includes("merchant_fee_exceeds_amount")) reasons.push("merchant_fee_exceeds_amount");
    if (policy.blockNegativeMargin && c.pricing && c.pricing.margin < 0) reasons.push("negative_margin");
    const measured = c.stats && c.stats.sampleSize >= (policy.minSamples ?? 20);
    if (policy.requireHealthData && !measured) reasons.push("insufficient_health_data");
    if (measured && c.stats) {
      if (policy.minApprovalRate != null && c.stats.approvalRate < policy.minApprovalRate) reasons.push("approval_below_threshold");
      if (policy.minUptime != null && c.stats.uptime < policy.minUptime) reasons.push("uptime_below_threshold");
      if (policy.maxLatencyMs != null && c.stats.avgLatencyMs > policy.maxLatencyMs) reasons.push("latency_above_threshold");
    }
    const { score, factors } = scoreCandidate(c, ctx, weights);
    evaluated.push(describe(c, reasons, score, factors));
    if (reasons.length === 0) eligible.push(c);
  }

  if (ctx.strategyOverride) { strategy = ctx.strategyOverride; reason += `; preview ${strategy} ranking`; }
  let ordered: Candidate[];
  if (strategy === "ordered") ordered = eligible;
  else if (strategy === "weighted") ordered = weightedOrder(eligible, (c) => routeWeights.get(c.account.id) ?? 100, ctx.seed ?? ctx.merchantId);
  else {
    ordered = [...eligible].sort((a, b) => {
      const sa = scoreCandidate(a, ctx, weights).score;
      const sb = scoreCandidate(b, ctx, weights).score;
      if (sb !== sa) return sb - sa;
      return a.account.priority - b.account.priority;
    });
  }

  return { rule, strategy, ordered, candidates: evaluated, reason, policy };
}
