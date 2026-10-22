import { describe, expect, it } from "vitest";
import { assessReceipt, extractClaim, minorUnits, receiptTransition, type Evidence } from "../../src/modules/receipts/analysis.js";
const text = "SYNTHETIC DEMO\nReference: DEMO123\nAmount: 28.12 EUR\nPaid date: 2025-01-01";
const evidence: Evidence = { reference: "DEMO123", amount: 2812, currency: "EUR", date: "2025-01-01", status: "succeeded", source: "independent fixture" };
const assess = (changes: Partial<Parameters<typeof assessReceipt>[0]> = {}) => assessReceipt({ text, ocr: text, expected: { amount: 2812, currency: "EUR" }, evidence, ...changes });
describe("receipt evidence", () => {
  it("requires a successful independent PSP record for a match", () => expect(assess().outcome).toBe("psp_matched"));
  it("does not label missing PSP evidence a fake", () => expect(assess({ evidence: null }).outcome).toBe("awaiting_psp"));
  it("waits for pending PSP payments", () => expect(assess({ evidence: { ...evidence, status: "pending" } }).outcome).toBe("awaiting_psp"));
  it("rejects a failed PSP payment as proof of payment", () => expect(assess({ evidence: { ...evidence, status: "failed" } }).outcome).toBe("suspicious"));
  it.each(["amount", "currency", "reference", "date"] as const)("flags altered %s", key => {
    const other = { ...evidence, [key]: key === "amount" ? 999 : "DIFFERENT" };
    expect(assess({ evidence: other }).outcome).toBe("suspicious");
  });
  it("detects conflicting visual and embedded text", () => {
    const a = assess({ ocr: text.replace("28.12", "280.12") });
    expect(a.findings.some(f => f.code === "visual_mismatch" && f.level === "risk")).toBe(true);
  });
  it("does not auto-confirm unreadable or ambiguous visible text", () => {
    expect(assess({ ocr: "blurry scan" }).outcome).toBe("needs_review");
    expect(assess({ text: text + "\nAmount: 80.00 EUR" }).outcome).toBe("needs_review");
  });
  it("flags reuse across payments", () => expect(assess({ reused: true }).outcome).toBe("suspicious"));
  it("compares with the selected NATIO payment too", () => expect(assess({ expected: { amount: 900, currency: "USD" } }).outcome).toBe("suspicious"));
  it("never guesses ambiguous decimal separators or invalid dates", () => {
    expect(extractClaim(text.replace("28.12", "28,12")).amount).toBe(null);
    expect(extractClaim(text.replace("2025-01-01", "2025-02-30")).date).toBe(null);
    expect(minorUnits("1.125", "KWD")).toBe(1125);
    expect(minorUnits("100", "JPY")).toBe(100);
    expect(minorUnits("100.01", "JPY")).toBe(null);
    expect(minorUnits("9007199254740992", "USD")).toBe(null);
  });
});
describe("operator decisions", () => {
  it("requires positive evidence to confirm", () => {
    expect(() => receiptTransition("confirm", "open", assess({ evidence: null }), "Reviewed payment")).toThrow();
    expect(receiptTransition("confirm", "open", assess(), "Verified against PSP")).toEqual({ state: "closed", decision: "confirmed" });
  });
  it("requires reasons for decisions and requests", () => {
    for (const action of ["confirm", "reject", "request_info"]) expect(() => receiptTransition(action, "open", assess(), "")).toThrow();
  });
  it("does not silently overwrite closed decisions", () => {
    expect(() => receiptTransition("reject", "closed", assess(), "Changed my mind")).toThrow();
    expect(receiptTransition("reopen", "closed", assess(), "New evidence received").state).toBe("in_review");
  });
});
