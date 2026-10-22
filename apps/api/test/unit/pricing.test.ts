import { describe, expect, it } from "vitest";
import {
  conflicts,
  feeFor,
  quotePricing,
  repriceSnapshot,
  selectPrice,
  validateTerms,
  type PriceContext,
  type PricePlan,
  type PriceTerms,
} from "../../src/modules/pricing/engine.js";
import { shouldRetry } from "../../src/modules/routing/cascade.js";
const terms = (side: "merchant" | "provider" = "merchant"): PriceTerms => ({
  name: "Synthetic tier tariff",
  side,
  currency: "EUR",
  merchantId: null,
  providerAccountId: null,
  paymentMethod: null,
  country: null,
  priority: 100,
  validFrom: "2025-01-01T00:00:00Z",
  validUntil: null,
  tiers: [
    { from: 0, to: 10000, rateBps: 250, fixed: 20, minimum: 30, maximum: 200 },
    {
      from: 10000,
      to: null,
      rateBps: 180,
      fixed: 10,
      minimum: 0,
      maximum: null,
    },
  ],
});
const plan = (
  side: "merchant" | "provider" = "merchant",
  patch: Partial<PriceTerms> = {},
): PricePlan => ({
  id: side,
  familyId: side,
  revision: 1,
  mode: "test",
  status: "active",
  terms: { ...terms(side), ...patch },
});
const ctx: PriceContext = {
  amount: 10000,
  currency: "EUR",
  mode: "test",
  merchantId: "mer_one",
  providerAccountId: "acc_one",
  paymentMethod: "card",
  at: new Date("2025-06-01T00:00:00Z"),
};
const fallback = { feePercent: "1.2345", feeFixedMinor: 10 };
describe("exact amount bracket pricing", () => {
  it("changes bracket exactly at its exclusive upper bound", () => {
    expect(feeFor(9999, terms().tiers).amount).toBe(200);
    expect(feeFor(10000, terms().tiers).amount).toBe(190);
  });
  it("rounds half up with integer arithmetic, then fixed/min/max", () => {
    expect(feeFor(100, terms().tiers).amount).toBe(30);
    expect(
      feeFor(42, [
        {
          from: 0,
          to: null,
          rateBps: 2500,
          fixed: 2,
          minimum: 0,
          maximum: null,
        },
      ]).amount,
    ).toBe(13);
  });
  it("preserves the largest safe integer", () => {
    expect(
      feeFor(Number.MAX_SAFE_INTEGER, [
        {
          from: 0,
          to: null,
          rateBps: 10000,
          fixed: 0,
          minimum: 0,
          maximum: null,
        },
      ]).amount,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    "rejects unsafe amount %s",
    (n) => expect(() => feeFor(n, terms().tiers)).toThrow(),
  );
  it("rejects gaps, overlaps, empty tiers and missing final coverage", () => {
    for (const tiers of [
      [],
      [{ ...terms().tiers[0]!, from: 1 }],
      [{ ...terms().tiers[0]!, to: 20000 }, terms().tiers[1]!],
      [terms().tiers[0]!],
    ])
      expect(() => validateTerms({ ...terms(), tiers })).toThrow();
  });
  it("rejects malformed dates, scope and min/max", () => {
    expect(() =>
      validateTerms({ ...terms(), validUntil: "2024-01-01T00:00:00Z" }),
    ).toThrow();
    expect(() =>
      validateTerms({ ...terms(), providerAccountId: "acc" }),
    ).toThrow();
    expect(() =>
      validateTerms({
        ...terms(),
        tiers: [{ ...terms().tiers[1]!, from: 0, minimum: 10, maximum: 5 }],
      }),
    ).toThrow();
  });
  it("accepts contiguous non-overlapping terms", () =>
    expect(() => validateTerms(terms())).not.toThrow());
  it("chooses specific merchant over global and rejects ties", () => {
    const specific = plan("merchant", { merchantId: "mer_one", priority: 999 });
    expect(selectPrice([plan(), specific], "merchant", ctx)).toBe(specific);
    expect(() => selectPrice([plan(), plan()], "merchant", ctx)).toThrow(
      /Ambiguous/,
    );
  });
  it("separates mode, currency and effective date", () => {
    expect(
      selectPrice([plan()], "merchant", { ...ctx, mode: "live" }),
    ).toBeNull();
    expect(
      selectPrice([plan()], "merchant", { ...ctx, currency: "JPY" }),
    ).toBeNull();
    expect(
      selectPrice(
        [plan("merchant", { validUntil: ctx.at.toISOString() })],
        "merchant",
        ctx,
      ),
    ).toBeNull();
  });
  it("detects overlapping scope/date/priority but permits more specific overrides", () => {
    expect(conflicts(terms(), terms())).toBe(true);
    expect(conflicts(terms(), { ...terms(), merchantId: "mer_one" })).toBe(
      false,
    );
    expect(
      conflicts(
        { ...terms(), validUntil: "2025-06-01T00:00:00Z" },
        { ...terms(), validFrom: "2025-06-01T00:00:00Z" },
      ),
    ).toBe(false);
  });
  it("calculates merchant and PSP independently and reports margin", () => {
    const q = quotePricing(
      [
        plan(),
        plan("provider", {
          tiers: [
            {
              from: 0,
              to: null,
              rateBps: 100,
              fixed: 5,
              minimum: 0,
              maximum: null,
            },
          ],
        }),
      ],
      ctx,
      fallback,
    );
    expect(q.merchant.amount).toBe(190);
    expect(q.provider.amount).toBe(105);
    expect(q.margin).toBe(85);
    expect(q.warnings).toEqual([]);
  });
  it("captures with frozen tiers even when the capture crosses a bracket", () => {
    const q = quotePricing([plan()], ctx, fallback);
    const capture = repriceSnapshot(q, 5000);
    expect(capture.merchant.amount).toBe(145);
    expect(capture.provider.amount).toBe(72);
    expect(capture.merchant.planId).toBe(q.merchant.planId);
    expect(q.amount).toBe(10000);
  });
  it("preserves four-decimal legacy account rates and explicitly labels fallback", () => {
    const q = quotePricing([], ctx, fallback);
    expect(q.provider.amount).toBe(133);
    expect(q.merchant.amount).toBe(133);
    expect(q.margin).toBe(0);
    expect(q.warnings).toContain("merchant_tariff_missing_legacy_pass_through");
    expect(repriceSnapshot(q, 5000).merchant.amount).toBe(72);
  });
  it.each(["JPY", "KWD"])(
    "uses minor units without hidden FX for %s",
    (currency) => {
      const q = quotePricing(
        [plan("merchant", { currency })],
        { ...ctx, currency },
        fallback,
      );
      expect(q.merchant.amount).toBe(190);
      expect(q.currency).toBe(currency);
    },
  );
  it("flags negative margin and excessive merchant fee", () => {
    const q = quotePricing(
      [
        plan("merchant", {
          tiers: [
            {
              from: 0,
              to: null,
              rateBps: 0,
              fixed: 5,
              minimum: 0,
              maximum: null,
            },
          ],
        }),
      ],
      { ...ctx, amount: 1 },
      fallback,
    );
    expect(q.warnings).toContain("negative_margin");
    expect(q.warnings).toContain("merchant_fee_exceeds_amount");
  });
});
describe("cascade safety regression", () => {
  const policy = {
    maxAttempts: 2,
    retryOnSoftDecline: true,
    retryOnTimeout: true,
    maxElapsedMs: 10000,
  };
  it.each([
    "insufficient_funds",
    "do_not_honor",
    "authentication_required",
    "stolen_card",
    "duplicate_transaction",
    "generic_decline",
  ])("does not cascade %s", (failureCode) =>
    expect(
      shouldRetry("soft_decline", policy, 1, 3, {
        failureCode,
        chargeState: "not_created",
        paymentMethod: "card",
      }).retry,
    ).toBe(false),
  );
  it("does not infer no-charge from HTTP or unavailable", () =>
    expect(shouldRetry("provider_unavailable", policy, 1, 3).retry).toBe(
      false,
    ));
  it("honours no-retry advice even after final no-charge proof", () =>
    expect(
      shouldRetry("timeout", policy, 1, 3, {
        timeoutResolvedSafe: true,
        advice: "do_not_retry",
      }).retry,
    ).toBe(false));
  it("does not move a consent-based payment to another PSP", () =>
    expect(
      shouldRetry("soft_decline", policy, 1, 3, {
        failureCode: "issuer_unavailable",
        chargeState: "not_created",
        paymentMethod: "bank_transfer",
      }).retry,
    ).toBe(false));
  it("stops at time budget", () =>
    expect(
      shouldRetry("technical_error", policy, 1, 3, {
        chargeState: "not_created",
        elapsedMs: 10000,
      }).reason,
    ).toBe("latency_budget_exhausted"));
});
