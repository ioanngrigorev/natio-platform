import { describe, expect, it } from "vitest";
import { fromDecimalString, mapCancellationReason, toDecimalString } from "../../src/providers/yookassa/yookassa-adapter.js";

/**
 * The adapter's network paths need a live shop to exercise. These two pieces do
 * not, and they are the ones where a quiet bug costs money rather than throwing:
 * an amount converted wrongly charges the wrong sum, and a decline classified
 * wrongly either burns a retry that could never succeed or abandons a payment
 * that a second provider would have taken.
 */

describe("amount conversion", () => {
  it("round-trips every amount it is given", () => {
    const amounts = [0, 1, 9, 10, 99, 100, 101, 999, 1000, 149900, 100000000, 2_000_000_00];
    for (const minor of amounts) {
      const s = toDecimalString(minor, "RUB");
      expect(fromDecimalString(s, "RUB")).toBe(minor);
    }
  });

  it("formats the cases that off-by-one errors live in", () => {
    expect(toDecimalString(0, "RUB")).toBe("0.00");
    expect(toDecimalString(1, "RUB")).toBe("0.01");
    expect(toDecimalString(9, "RUB")).toBe("0.09");
    expect(toDecimalString(10, "RUB")).toBe("0.10");
    expect(toDecimalString(99, "RUB")).toBe("0.99");
    expect(toDecimalString(100, "RUB")).toBe("1.00");
    expect(toDecimalString(149900, "RUB")).toBe("1499.00");
    expect(toDecimalString(-500, "RUB")).toBe("-5.00");
  });

  it("does not go through a float", () => {
    // 0.1 + 0.2 arithmetic would show up here. 8_099_999_999 kopecks is a
    // value a double can still hold but sloppy division would disturb.
    expect(toDecimalString(8_099_999_999, "RUB")).toBe("80999999.99");
    expect(fromDecimalString("80999999.99", "RUB")).toBe(8_099_999_999);
  });

  it("accepts a provider amount written with fewer decimals", () => {
    expect(fromDecimalString("1499", "RUB")).toBe(149900);
    expect(fromDecimalString("1499.5", "RUB")).toBe(149950);
  });

  it("refuses an amount with more precision than the currency has", () => {
    // Truncating would silently change the sum, so this must throw.
    expect(() => fromDecimalString("10.005", "RUB")).toThrow(/precision/i);
  });

  it("refuses junk rather than coercing it to zero", () => {
    for (const bad of ["", "abc", "1,00", "1.2.3", "NaN", "1e3", " "]) {
      expect(() => fromDecimalString(bad, "RUB")).toThrow();
    }
  });

  it("refuses a non-integer minor amount", () => {
    expect(() => toDecimalString(10.5, "RUB")).toThrow(/integer/i);
  });
});

describe("decline classification", () => {
  const HARD = ["card_expired", "invalid_card_number", "invalid_csc", "fraud_suspected", "3d_secure_failed", "payment_method_restricted", "country_forbidden", "expired_on_confirmation"];
  const SOFT = ["insufficient_funds", "issuer_unavailable", "call_issuer", "general_decline", "payment_method_limit_exceeded", "internal_timeout"];

  it("maps reasons that will fail identically anywhere to non-retryable codes", () => {
    const nonRetryable = new Set([
      "expired_card",
      "invalid_card",
      "fraud_suspected",
      "authentication_failed",
      "restricted_card",
      "invalid_account",
      "cancelled_by_customer",
      "payment_expired",
    ]);
    for (const reason of HARD) {
      expect(nonRetryable.has(mapCancellationReason(reason))).toBe(true);
    }
  });

  it("maps reasons that another provider might accept to retryable codes", () => {
    const retryable = new Set(["insufficient_funds", "issuer_unavailable", "do_not_honor", "generic_decline", "limit_exceeded", "try_again_later"]);
    for (const reason of SOFT) {
      expect(retryable.has(mapCancellationReason(reason))).toBe(true);
    }
  });

  it("falls back to a retryable generic decline for a reason it has never seen", () => {
    // ЮKassa can add reasons. Defaulting to "hard" would abandon payments that
    // a second provider would have taken; "soft" costs at most one attempt.
    expect(mapCancellationReason("some_reason_invented_next_year")).toBe("generic_decline");
    expect(mapCancellationReason(undefined)).toBe("generic_decline");
  });

  it("treats a revoked permission as our configuration problem, not the customer's card", () => {
    expect(mapCancellationReason("permission_revoked")).toBe("provider_configuration_error");
  });
});
