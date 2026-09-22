import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import {
  assertTransition,
  canTransition,
  PAYMENT_TRANSITIONS,
  PAYOUT_TRANSITIONS,
  REFUND_TRANSITIONS,
  TERMINAL_PAYMENT_STATUSES,
  type PaymentStatus,
  type PayoutStatus,
  type RefundStatus,
} from "../../src/modules/payments/state-machine.js";

const PAYMENT_STATUSES = Object.keys(PAYMENT_TRANSITIONS) as PaymentStatus[];
const REFUND_STATUSES = Object.keys(REFUND_TRANSITIONS) as RefundStatus[];
const PAYOUT_STATUSES = Object.keys(PAYOUT_TRANSITIONS) as PayoutStatus[];

/** Every (from, to) pair that is NOT declared in the table must be rejected. */
function disallowedPairs<S extends string>(table: Record<S, S[]>, all: S[]): Array<[S, S]> {
  const out: Array<[S, S]> = [];
  for (const from of all) for (const to of all) if (!table[from].includes(to)) out.push([from, to]);
  return out;
}

describe("payment state machine", () => {
  it("allows every declared transition", () => {
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_TRANSITIONS[from]) {
        expect(canTransition(PAYMENT_TRANSITIONS, from, to), `${from} -> ${to}`).toBe(true);
        expect(() => assertTransition("payment", PAYMENT_TRANSITIONS, from, to)).not.toThrow();
      }
    }
  });

  it("covers the expected lifecycle edges", () => {
    expect(canTransition(PAYMENT_TRANSITIONS, "created", "processing")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "created", "pending")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "created", "failed")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "created", "cancelled")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "pending", "processing")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "processing", "authorized")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "processing", "successful")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "processing", "failed")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "processing", "pending")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "authorized", "successful")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "authorized", "cancelled")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "captured", "successful")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "successful", "partially_refunded")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "successful", "refunded")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "partially_refunded", "partially_refunded")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "partially_refunded", "refunded")).toBe(true);
  });

  it("rejects transitions that are not declared", () => {
    const pairs = disallowedPairs(PAYMENT_TRANSITIONS, PAYMENT_STATUSES);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [from, to] of pairs) {
      expect(canTransition(PAYMENT_TRANSITIONS, from, to), `${from} -> ${to}`).toBe(false);
    }
    // A few important ones, spelled out.
    expect(canTransition(PAYMENT_TRANSITIONS, "created", "successful")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "created", "authorized")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "successful", "processing")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "successful", "failed")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "successful", "cancelled")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "authorized", "refunded")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "pending", "successful")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "failed", "processing")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "refunded", "successful")).toBe(false);
  });

  it("never allows a self transition except partially_refunded", () => {
    for (const s of PAYMENT_STATUSES) {
      expect(canTransition(PAYMENT_TRANSITIONS, s, s)).toBe(s === "partially_refunded");
    }
  });

  it("terminal states have no outgoing transitions", () => {
    for (const s of ["failed", "cancelled", "refunded"] as const) {
      expect(PAYMENT_TRANSITIONS[s]).toEqual([]);
      for (const to of PAYMENT_STATUSES) expect(canTransition(PAYMENT_TRANSITIONS, s, to)).toBe(false);
    }
    expect(TERMINAL_PAYMENT_STATUSES.sort()).toEqual(["cancelled", "failed", "refunded"]);
    for (const s of TERMINAL_PAYMENT_STATUSES) expect(PAYMENT_TRANSITIONS[s]).toHaveLength(0);
  });

  it("returns false for unknown states", () => {
    expect(canTransition(PAYMENT_TRANSITIONS as Record<string, string[]>, "bogus", "processing")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS as Record<string, string[]>, "created", "bogus")).toBe(false);
  });
});

describe("refund state machine", () => {
  it("allows every declared transition", () => {
    for (const from of REFUND_STATUSES) {
      for (const to of REFUND_TRANSITIONS[from]) expect(canTransition(REFUND_TRANSITIONS, from, to), `${from} -> ${to}`).toBe(true);
    }
    expect(canTransition(REFUND_TRANSITIONS, "created", "processing")).toBe(true);
    expect(canTransition(REFUND_TRANSITIONS, "created", "failed")).toBe(true);
    expect(canTransition(REFUND_TRANSITIONS, "processing", "successful")).toBe(true);
    expect(canTransition(REFUND_TRANSITIONS, "processing", "failed")).toBe(true);
  });

  it("rejects undeclared transitions", () => {
    for (const [from, to] of disallowedPairs(REFUND_TRANSITIONS, REFUND_STATUSES)) {
      expect(canTransition(REFUND_TRANSITIONS, from, to), `${from} -> ${to}`).toBe(false);
    }
    expect(canTransition(REFUND_TRANSITIONS, "created", "successful")).toBe(false);
    expect(canTransition(REFUND_TRANSITIONS, "successful", "failed")).toBe(false);
    expect(canTransition(REFUND_TRANSITIONS, "failed", "processing")).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    expect(REFUND_TRANSITIONS.successful).toEqual([]);
    expect(REFUND_TRANSITIONS.failed).toEqual([]);
  });
});

describe("payout state machine", () => {
  it("allows every declared transition", () => {
    for (const from of PAYOUT_STATUSES) {
      for (const to of PAYOUT_TRANSITIONS[from]) expect(canTransition(PAYOUT_TRANSITIONS, from, to), `${from} -> ${to}`).toBe(true);
    }
    expect(canTransition(PAYOUT_TRANSITIONS, "created", "pending")).toBe(true);
    expect(canTransition(PAYOUT_TRANSITIONS, "created", "processing")).toBe(true);
    expect(canTransition(PAYOUT_TRANSITIONS, "created", "failed")).toBe(true);
    expect(canTransition(PAYOUT_TRANSITIONS, "created", "cancelled")).toBe(true);
    expect(canTransition(PAYOUT_TRANSITIONS, "pending", "processing")).toBe(true);
    expect(canTransition(PAYOUT_TRANSITIONS, "pending", "cancelled")).toBe(true);
    expect(canTransition(PAYOUT_TRANSITIONS, "processing", "successful")).toBe(true);
    expect(canTransition(PAYOUT_TRANSITIONS, "processing", "failed")).toBe(true);
  });

  it("rejects undeclared transitions", () => {
    for (const [from, to] of disallowedPairs(PAYOUT_TRANSITIONS, PAYOUT_STATUSES)) {
      expect(canTransition(PAYOUT_TRANSITIONS, from, to), `${from} -> ${to}`).toBe(false);
    }
    expect(canTransition(PAYOUT_TRANSITIONS, "created", "successful")).toBe(false);
    expect(canTransition(PAYOUT_TRANSITIONS, "processing", "cancelled")).toBe(false);
    expect(canTransition(PAYOUT_TRANSITIONS, "successful", "failed")).toBe(false);
    expect(canTransition(PAYOUT_TRANSITIONS, "cancelled", "processing")).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    expect(PAYOUT_TRANSITIONS.successful).toEqual([]);
    expect(PAYOUT_TRANSITIONS.failed).toEqual([]);
    expect(PAYOUT_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe("assertTransition", () => {
  it("throws an ApiError with code invalid_state_transition", () => {
    let caught: unknown;
    try {
      assertTransition("payment", PAYMENT_TRANSITIONS, "successful", "processing");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const e = caught as ApiError;
    expect(e.code).toBe("invalid_state_transition");
    expect(e.status).toBe(409);
    expect(e.type).toBe("state_error");
    expect(e.message).toContain("payment");
    expect(e.message).toContain("successful");
    expect(e.message).toContain("processing");
    expect(e.toJSON()).toEqual({ error: { type: "state_error", code: "invalid_state_transition", message: e.message } });
  });

  it("throws for refunds and payouts too", () => {
    expect(() => assertTransition("refund", REFUND_TRANSITIONS, "successful", "failed")).toThrowError(ApiError);
    expect(() => assertTransition("payout", PAYOUT_TRANSITIONS, "failed", "processing")).toThrowError(/payout cannot move from failed to processing/);
  });

  it("does not throw for allowed transitions", () => {
    expect(() => assertTransition("payment", PAYMENT_TRANSITIONS, "processing", "successful")).not.toThrow();
    expect(() => assertTransition("refund", REFUND_TRANSITIONS, "processing", "successful")).not.toThrow();
    expect(() => assertTransition("payout", PAYOUT_TRANSITIONS, "processing", "successful")).not.toThrow();
  });
});
