import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import { normalizeProviderStatus, parseProviderCsv, reconcile, type ProviderReportRow, type ReconcileInput } from "../../src/modules/reconciliation/service.js";

type NatioTx = ReconcileInput["natio"][number];

function natio(over: Partial<NatioTx> & { id: string }): NatioTx {
  return {
    entityId: over.entityId ?? `pay_${over.id}`,
    paymentId: over.paymentId === undefined ? `pay_${over.id}` : over.paymentId,
    providerReference: over.providerReference === undefined ? `mp_${over.id}` : over.providerReference,
    amount: 1000,
    currency: "USD",
    status: "successful",
    type: "payment",
    ...over,
  };
}

function provider(over: Partial<ProviderReportRow> & { provider_reference: string }): ProviderReportRow {
  return { amount: 1000, currency: "USD", status: "settled", ...over };
}

describe("reconcile", () => {
  it("MATCHED when reference, amount, currency and status agree", () => {
    const out = reconcile({ natio: [natio({ id: "1" })], provider: [provider({ provider_reference: "mp_1" })] });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ status: "MATCHED", transactionId: "1", paymentId: "pay_1", providerReference: "mp_1", natioAmount: 1000, providerAmount: 1000, currency: "USD", natioStatus: "successful", providerStatus: "settled" });
    expect(out.totals).toEqual({ total: 1, MATCHED: 1, MISSING_PROVIDER: 0, MISSING_NATIO: 0, AMOUNT_MISMATCH: 0, STATUS_MISMATCH: 0 });
  });

  it("matches failed transactions with failed provider rows", () => {
    const out = reconcile({ natio: [natio({ id: "f", status: "failed" })], provider: [provider({ provider_reference: "mp_f", status: "declined" })] });
    expect(out.items[0]!.status).toBe("MATCHED");
    const cancelled = reconcile({ natio: [natio({ id: "c", status: "cancelled" })], provider: [provider({ provider_reference: "mp_c", status: "voided" })] });
    expect(cancelled.items[0]!.status).toBe("MATCHED");
  });

  it("MISSING_PROVIDER only for successful NATIO transactions", () => {
    const out = reconcile({
      natio: [natio({ id: "ok" }), natio({ id: "failed", status: "failed" }), natio({ id: "pending", status: "pending" }), natio({ id: "cancelled", status: "cancelled" })],
      provider: [],
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ status: "MISSING_PROVIDER", transactionId: "ok", paymentId: "pay_ok", providerReference: "mp_ok", natioAmount: 1000, currency: "USD", natioStatus: "successful" });
    expect(out.items[0]!.notes).toMatch(/provider did not report/);
    expect(out.totals.MISSING_PROVIDER).toBe(1);
    expect(out.totals.total).toBe(1);
  });

  it("MISSING_NATIO when the provider reports an unknown transaction", () => {
    const out = reconcile({ natio: [], provider: [provider({ provider_reference: "mp_ghost", amount: 4200, currency: "EUR", status: "captured" })] });
    expect(out.items).toEqual([{ status: "MISSING_NATIO", providerReference: "mp_ghost", providerAmount: 4200, currency: "EUR", providerStatus: "captured", notes: "Provider reports a transaction NATIO does not have" }]);
    expect(out.totals.MISSING_NATIO).toBe(1);
  });

  it("AMOUNT_MISMATCH on a different amount", () => {
    const out = reconcile({ natio: [natio({ id: "1", amount: 1000 })], provider: [provider({ provider_reference: "mp_1", amount: 1200 })] });
    expect(out.items[0]).toMatchObject({ status: "AMOUNT_MISMATCH", transactionId: "1", natioAmount: 1000, providerAmount: 1200, currency: "USD" });
    expect(out.items[0]!.notes).toBeUndefined();
    expect(out.totals.AMOUNT_MISMATCH).toBe(1);
  });

  it("AMOUNT_MISMATCH on a different currency (with a note)", () => {
    const out = reconcile({ natio: [natio({ id: "1", currency: "USD" })], provider: [provider({ provider_reference: "mp_1", currency: "EUR" })] });
    expect(out.items[0]).toMatchObject({ status: "AMOUNT_MISMATCH", currency: "USD", notes: "currency USD vs EUR" });
  });

  it("compares absolute amounts (refunds and payouts are negative in NATIO)", () => {
    const out = reconcile({ natio: [natio({ id: "rf", type: "refund", amount: -2500, entityId: "rf_1", providerReference: "mrf_1" })], provider: [provider({ provider_reference: "mrf_1", amount: 2500, status: "settled" })] });
    expect(out.items[0]).toMatchObject({ status: "MATCHED", natioAmount: 2500, providerAmount: 2500 });
    const neg = reconcile({ natio: [natio({ id: "po", type: "payout", amount: -900, providerReference: "mpo_1" })], provider: [provider({ provider_reference: "mpo_1", amount: -900, status: "completed" })] });
    expect(neg.items[0]!.status).toBe("MATCHED");
  });

  it("STATUS_MISMATCH takes precedence over amount differences", () => {
    const out = reconcile({ natio: [natio({ id: "1", status: "successful", amount: 1000 })], provider: [provider({ provider_reference: "mp_1", status: "declined", amount: 999 })] });
    expect(out.items[0]).toMatchObject({ status: "STATUS_MISMATCH", transactionId: "1", natioStatus: "successful", providerStatus: "declined", natioAmount: 1000, providerAmount: 999 });
    expect(out.totals.STATUS_MISMATCH).toBe(1);
    expect(out.totals.AMOUNT_MISMATCH).toBe(0);
    const pending = reconcile({ natio: [natio({ id: "2", status: "pending" })], provider: [provider({ provider_reference: "mp_2", status: "settled" })] });
    expect(pending.items[0]!.status).toBe("STATUS_MISMATCH");
  });

  it("matches by provider reference first, then by NATIO reference (entity id or payment id)", () => {
    const out = reconcile({
      natio: [natio({ id: "a", providerReference: null }), natio({ id: "b", providerReference: null, entityId: "rf_b", paymentId: "pay_b" })],
      provider: [provider({ provider_reference: "unknown_a", natio_reference: "pay_a" }), provider({ provider_reference: "unknown_b", natio_reference: "rf_b" })],
    });
    expect(out.items.map((i) => i.status)).toEqual(["MATCHED", "MATCHED"]);
    expect(out.items[0]!.transactionId).toBe("a");
    expect(out.items[1]!.transactionId).toBe("b");
    // matching via the payment id of a refund row
    const viaPayment = reconcile({ natio: [natio({ id: "c", providerReference: null, entityId: "rf_c", paymentId: "pay_c" })], provider: [provider({ provider_reference: "x", natio_reference: "pay_c" })] });
    expect(viaPayment.items[0]).toMatchObject({ status: "MATCHED", transactionId: "c" });
  });

  it("provider reference wins over a conflicting natio reference", () => {
    const out = reconcile({
      natio: [natio({ id: "1" }), natio({ id: "2" })],
      provider: [provider({ provider_reference: "mp_1", natio_reference: "pay_2" })],
    });
    expect(out.items.find((i) => i.status === "MATCHED")!.transactionId).toBe("1");
    expect(out.items.find((i) => i.status === "MISSING_PROVIDER")!.transactionId).toBe("2");
  });

  it("a natio transaction reported twice by the provider is not also reported as missing", () => {
    const out = reconcile({ natio: [natio({ id: "1" })], provider: [provider({ provider_reference: "mp_1" }), provider({ provider_reference: "mp_1" })] });
    expect(out.items.filter((i) => i.status === "MATCHED")).toHaveLength(2);
    expect(out.totals.MISSING_PROVIDER).toBe(0);
  });

  it("totals add up across a mixed batch", () => {
    const out = reconcile({
      natio: [
        natio({ id: "m" }),
        natio({ id: "amt" }),
        natio({ id: "st" }),
        natio({ id: "missing" }),
        natio({ id: "failed_missing", status: "failed" }),
      ],
      provider: [
        provider({ provider_reference: "mp_m" }),
        provider({ provider_reference: "mp_amt", amount: 1 }),
        provider({ provider_reference: "mp_st", status: "pending" }),
        provider({ provider_reference: "mp_ghost" }),
      ],
    });
    expect(out.totals).toEqual({ total: 5, MATCHED: 1, MISSING_PROVIDER: 1, MISSING_NATIO: 1, AMOUNT_MISMATCH: 1, STATUS_MISMATCH: 1 });
    expect(out.items).toHaveLength(5);
    expect(Object.values(out.totals).slice(1).reduce((s, n) => s + n, 0)).toBe(out.totals.total);
  });

  it("handles empty input", () => {
    expect(reconcile({ natio: [], provider: [] })).toEqual({ items: [], totals: { total: 0, MATCHED: 0, MISSING_PROVIDER: 0, MISSING_NATIO: 0, AMOUNT_MISMATCH: 0, STATUS_MISMATCH: 0 } });
  });
});

describe("parseProviderCsv", () => {
  it("parses the canonical header and normalises currency/status", () => {
    const csv = "provider_reference,natio_reference,type,amount,currency,status\nmp_1,pay_1,payment,1000,usd,SETTLED\nmp_2,,refund,250,eur,Failed\n";
    const rows = parseProviderCsv(csv);
    expect(rows).toEqual([
      { provider_reference: "mp_1", natio_reference: "pay_1", type: "payment", amount: 1000, currency: "USD", status: "settled" },
      { provider_reference: "mp_2", natio_reference: "", type: "refund", amount: 250, currency: "EUR", status: "failed" },
    ]);
  });

  it("accepts header aliases, case and whitespace", () => {
    const csv = " Transaction_ID , Merchant_Reference , AMOUNT , Currency , Status \n tx-9 , pay_9 , 500 , gbp , Captured \n";
    expect(parseProviderCsv(csv)).toEqual([{ provider_reference: "tx-9", natio_reference: "pay_9", amount: 500, currency: "GBP", status: "captured" }]);
    const csv2 = "id,payment_id,amount,currency,status\nabc,pay_x,10,usd,paid\n";
    expect(parseProviderCsv(csv2)[0]).toMatchObject({ provider_reference: "abc", natio_reference: "pay_x", amount: 10 });
    const csv3 = "reference,amount,currency,status\nr1,10,usd,paid\n";
    expect(parseProviderCsv(csv3)[0]!.provider_reference).toBe("r1");
  });

  it("treats decimal amounts as major units and integers as minor units", () => {
    const csv = "provider_reference,amount,currency,status\na,12.34,USD,settled\nb,1234,USD,settled\nc,\"1,234.50\",USD,settled\nd,$7.1,USD,settled\ne,0.005,USD,settled\n";
    const rows = parseProviderCsv(csv);
    expect(rows.map((r) => r.amount)).toEqual([1234, 1234, 123450, 710, 1]);
  });

  it("skips rows missing required columns and strips a BOM", () => {
    const csv = "﻿provider_reference,amount,currency,status\nok,100,USD,settled\n,100,USD,settled\nnoamount,,USD,settled\nnocur,100,,settled\nnostatus,100,USD,\n";
    const rows = parseProviderCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider_reference).toBe("ok");
  });

  it("skips rows whose amount is not numeric (never yields NaN amounts)", () => {
    const csv = "provider_reference,amount,currency,status\nok,100,USD,settled\nbad,n/a,USD,settled\nempty,,USD,settled\n";
    const rows = parseProviderCsv(csv);
    expect(rows.map((r) => r.provider_reference)).toEqual(["ok"]);
    expect(rows.every((r) => Number.isFinite(r.amount))).toBe(true);
  });

  it("ignores unknown columns", () => {
    const csv = "provider_reference,amount,currency,status,memo\nx,1,USD,settled,hello\n";
    expect(parseProviderCsv(csv)).toEqual([{ provider_reference: "x", amount: 1, currency: "USD", status: "settled" }]);
  });

  it("throws invalid_csv when no usable rows exist", () => {
    let err: unknown;
    try {
      parseProviderCsv("foo,bar\n1,2\n");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("invalid_csv");
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toMatch(/no usable rows/);
    expect(() => parseProviderCsv("")).toThrow(ApiError);
    expect(() => parseProviderCsv("provider_reference,amount,currency,status\n")).toThrow(/no usable rows/);
  });

  it("throws invalid_csv when the CSV cannot be parsed at all", () => {
    let err: unknown;
    try {
      parseProviderCsv('provider_reference,amount,currency,status\n"unterminated,1,USD,settled\n');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("invalid_csv");
    expect((err as ApiError).message).toMatch(/could not be parsed/);
  });
});

describe("normalizeProviderStatus", () => {
  it("maps successful synonyms", () => {
    for (const s of ["successful", "success", "captured", "settled", "approved", "completed", "paid", "refunded", "SETTLED", "Paid"]) {
      expect(normalizeProviderStatus(s), s).toBe("successful");
    }
  });

  it("maps failed synonyms", () => {
    for (const s of ["failed", "declined", "error", "rejected", "cancelled", "canceled", "voided", "DECLINED"]) expect(normalizeProviderStatus(s), s).toBe("failed");
  });

  it("maps pending synonyms", () => {
    for (const s of ["pending", "processing", "authorized", "Processing"]) expect(normalizeProviderStatus(s), s).toBe("pending");
  });

  it("returns other for anything else", () => {
    expect(normalizeProviderStatus("")).toBe("other");
    expect(normalizeProviderStatus("chargeback")).toBe("other");
    expect(normalizeProviderStatus("authorised")).toBe("other");
  });
});
