/** Amount bracket pricing. Every calculation uses integer minor units and half-up rounding. */
export interface PriceTier {
  from: number;
  to: number | null;
  rateBps: number;
  fixed: number;
  minimum: number;
  maximum: number | null;
}
export interface PriceTerms {
  name: string;
  side: "merchant" | "provider";
  currency: string;
  merchantId: string | null;
  providerAccountId: string | null;
  paymentMethod: string | null;
  country: string | null;
  priority: number;
  validFrom: string;
  validUntil: string | null;
  tiers: PriceTier[];
}
export interface PricePlan {
  id: string;
  familyId: string;
  revision: number;
  mode: "test" | "live";
  status: string;
  terms: PriceTerms;
}
export interface PriceContext {
  amount: number;
  currency: string;
  mode: "test" | "live";
  merchantId: string;
  providerAccountId: string;
  paymentMethod: string;
  country?: string | null;
  at: Date;
}
export interface FeeQuote {
  amount: number;
  source: "plan" | "account_fallback" | "legacy_pass_through";
  planId: string | null;
  revision: number | null;
  name: string;
  tier: PriceTier;
  tiers: PriceTier[];
}
export interface PricingSnapshot {
  schema: 1;
  amount: number;
  currency: string;
  quotedAt: string;
  merchant: FeeQuote;
  provider: FeeQuote;
  margin: number;
  merchantNet: number;
  warnings: string[];
}
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function validateTerms(t: PriceTerms): void {
  if (!t.name.trim() || t.name.length > 120 || !/^[A-Z]{3}$/.test(t.currency))
    throw new Error("Name and ISO currency are required");
  if (t.side === "merchant" && t.providerAccountId)
    throw new Error("Merchant tariffs cannot target a PSP account");
  if (t.side === "provider" && t.merchantId)
    throw new Error("PSP tariffs cannot target a merchant");
  if (
    !Number.isFinite(Date.parse(t.validFrom)) ||
    (t.validUntil &&
      (!Number.isFinite(Date.parse(t.validUntil)) ||
        Date.parse(t.validUntil) <= Date.parse(t.validFrom)))
  )
    throw new Error("Invalid effective date interval");
  if (!t.tiers.length || t.tiers.length > 20)
    throw new Error("Use 1–20 amount brackets");
  let next = 0;
  for (const [i, v] of t.tiers.entries()) {
    if (
      !safe(v.from) ||
      v.from !== next ||
      !safe(v.fixed) ||
      !safe(v.minimum) ||
      !safe(v.rateBps) ||
      v.rateBps > 10000 ||
      (v.maximum !== null && (!safe(v.maximum) || v.maximum < v.minimum))
    )
      throw new Error(
        "Invalid bracket: use contiguous bounds, non-negative minor units and 0–10000 bps",
      );
    if (v.to === null) {
      if (i !== t.tiers.length - 1)
        throw new Error("Only the final bracket may be unbounded");
    } else if (!safe(v.to) || v.to <= v.from || i === t.tiers.length - 1)
      throw new Error(
        "Brackets use inclusive lower / exclusive upper bounds; the final bracket must be unbounded",
      );
    next = v.to ?? 0;
  }
}
export function feeFor(
  amount: number,
  tiers: PriceTier[],
): { amount: number; tier: PriceTier } {
  if (!safe(amount) || amount === 0)
    throw new Error("Amount must be a positive safe integer in minor units");
  const tier = tiers.find(
    (t) => amount >= t.from && (t.to === null || amount < t.to),
  );
  if (!tier) throw new Error("No price bracket covers this amount");
  let fee =
    (BigInt(amount) * BigInt(tier.rateBps) + 5000n) / 10000n +
    BigInt(tier.fixed);
  if (fee < BigInt(tier.minimum)) fee = BigInt(tier.minimum);
  if (tier.maximum !== null && fee > BigInt(tier.maximum))
    fee = BigInt(tier.maximum);
  if (fee > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Fee exceeds safe money range");
  return { amount: Number(fee), tier };
}
function rank(t: PriceTerms): number {
  return (
    (t.merchantId || t.providerAccountId ? 4 : 0) +
    (t.paymentMethod ? 2 : 0) +
    (t.country ? 1 : 0)
  );
}
export function selectPrice(
  plans: PricePlan[],
  side: PriceTerms["side"],
  ctx: PriceContext,
): PricePlan | null {
  const t = ctx.at.getTime();
  const eligible = plans.filter(
    (p) =>
      p.status === "active" &&
      p.mode === ctx.mode &&
      p.terms.side === side &&
      p.terms.currency === ctx.currency &&
      (!p.terms.merchantId || p.terms.merchantId === ctx.merchantId) &&
      (!p.terms.providerAccountId ||
        p.terms.providerAccountId === ctx.providerAccountId) &&
      (!p.terms.paymentMethod || p.terms.paymentMethod === ctx.paymentMethod) &&
      (!p.terms.country || p.terms.country === ctx.country) &&
      t >= Date.parse(p.terms.validFrom) &&
      (!p.terms.validUntil || t < Date.parse(p.terms.validUntil)),
  );
  eligible.sort(
    (a, b) =>
      rank(b.terms) - rank(a.terms) || a.terms.priority - b.terms.priority,
  );
  if (
    eligible[0] &&
    eligible[1] &&
    rank(eligible[0].terms) === rank(eligible[1].terms) &&
    eligible[0].terms.priority === eligible[1].terms.priority
  )
    throw new Error(
      "Ambiguous active pricing plans; resolve overlapping scope and priority",
    );
  return eligible[0] ?? null;
}
export function conflicts(a: PriceTerms, b: PriceTerms): boolean {
  const overlap = (x: string | null, y: string | null) => !x || !y || x === y;
  return (
    a.side === b.side &&
    a.currency === b.currency &&
    a.priority === b.priority &&
    rank(a) === rank(b) &&
    overlap(a.merchantId, b.merchantId) &&
    overlap(a.providerAccountId, b.providerAccountId) &&
    overlap(a.paymentMethod, b.paymentMethod) &&
    overlap(a.country, b.country) &&
    Date.parse(a.validFrom) <
      (b.validUntil ? Date.parse(b.validUntil) : Infinity) &&
    Date.parse(b.validFrom) <
      (a.validUntil ? Date.parse(a.validUntil) : Infinity)
  );
}
export function quotePricing(
  plans: PricePlan[],
  ctx: PriceContext,
  fallback: { feePercent: string; feeFixedMinor: number },
): PricingSnapshot {
  if (!/^\d+(?:\.\d{1,4})?$/.test(fallback.feePercent) || !safe(fallback.feeFixedMinor)) throw new Error("Invalid account fee configuration");
  const providerPlan = selectPrice(plans, "provider", ctx),
    merchantPlan = selectPrice(plans, "merchant", ctx);
  const fromPlan = (p: PricePlan): FeeQuote => ({
    ...feeFor(ctx.amount, p.terms.tiers),
    source: "plan",
    planId: p.id,
    revision: p.revision,
    name: p.terms.name,
    tiers: p.terms.tiers,
  });
  // Legacy account percent supports four decimal places; calculate its exact numerator separately.
  const [whole, fraction = ""] = fallback.feePercent.split(".");
  const percentScaled =
    BigInt(whole || "0") * 10000n + BigInt(fraction.padEnd(4, "0").slice(0, 4));
  const legacy =
    (BigInt(ctx.amount) * percentScaled + 500000n) / 1000000n +
    BigInt(fallback.feeFixedMinor);
  if (legacy < 0 || legacy > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Invalid legacy account fee");
  const fallbackTier: PriceTier = {
    from: 0,
    to: null,
    rateBps: Number(fallback.feePercent) * 100,
    fixed: fallback.feeFixedMinor,
    minimum: 0,
    maximum: null,
  };
  const provider: FeeQuote = providerPlan
    ? fromPlan(providerPlan)
    : {
        amount: Number(legacy),
        source: "account_fallback",
        planId: null,
        revision: null,
        name: "Provider account fee",
        tier: fallbackTier,
        tiers: [fallbackTier],
      };
  const merchant: FeeQuote = merchantPlan
    ? fromPlan(merchantPlan)
    : {
        ...provider,
        source: "legacy_pass_through",
        name: "Legacy pass-through (merchant tariff absent)",
      };
  return {
    schema: 1,
    amount: ctx.amount,
    currency: ctx.currency,
    quotedAt: ctx.at.toISOString(),
    merchant,
    provider,
    margin: merchant.amount - provider.amount,
    merchantNet: ctx.amount - merchant.amount,
    warnings: [
      ...(!merchantPlan ? ["merchant_tariff_missing_legacy_pass_through"] : []),
      ...(!providerPlan ? ["provider_account_fee_fallback"] : []),
      ...(merchant.amount < provider.amount ? ["negative_margin"] : []),
      ...(merchant.amount > ctx.amount ? ["merchant_fee_exceeds_amount"] : []),
    ],
  };
}
/** Captures use the same frozen terms, including the original precision of account fallback fees. */
export function repriceSnapshot(
  snapshot: PricingSnapshot,
  amount: number,
): PricingSnapshot {
  const calc = (q: FeeQuote): FeeQuote => {
    if (q.source === "plan") return { ...q, ...feeFor(amount, q.tiers) };
    const t = q.tier,
      scaledBps = BigInt(Math.round(t.rateBps * 100));
    const fee =
      (BigInt(amount) * scaledBps + 500000n) / 1000000n + BigInt(t.fixed);
    if (fee > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Fee exceeds safe money range");
    return { ...q, amount: Number(fee) };
  };
  if (!safe(amount) || !amount || amount > snapshot.amount)
    throw new Error("Invalid capture amount");
  const provider = calc(snapshot.provider);
  const merchant =
    snapshot.merchant.source === "legacy_pass_through"
      ? { ...snapshot.merchant, amount: provider.amount }
      : calc(snapshot.merchant);
  return {
    ...snapshot,
    amount,
    merchant,
    provider,
    margin: merchant.amount - provider.amount,
    merchantNet: amount - merchant.amount,
  };
}
