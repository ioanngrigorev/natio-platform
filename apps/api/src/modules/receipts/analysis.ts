import { currencyExponent } from "../../lib/money.js";

export type Claim = { reference: string | null; amount: number | null; currency: string | null; date: string | null; ambiguous: boolean };
export type Evidence = { reference: string; amount: number; currency: string; date: string; status: "succeeded" | "pending" | "failed"; source: string };
export type Finding = { code: string; level: "pass" | "review" | "risk"; message: string };
export type Assessment = { outcome: "psp_matched" | "suspicious" | "needs_review" | "awaiting_psp"; claim: Claim; findings: Finding[]; evidence: Evidence | null; checked_at: string };

// Decimal strings only: never guess decimal/grouping separators or use floating point money.
export function minorUnits(value: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > exp) return null;
  const n = BigInt(whole) * 10n ** BigInt(exp) + BigInt(fraction.padEnd(exp, "0") || "0");
  return n > 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}

export function extractClaim(text: string): Claim {
  let ambiguous = false;
  const unique = (values: string[]) => {
    const set = [...new Set(values.map(v => v.trim().toUpperCase()))];
    if (set.length > 1) ambiguous = true;
    return set.length === 1 ? set[0] : null;
  };
  const reference = unique([...text.matchAll(/(?:PSP reference|Reference|UTR)\s*:\s*([A-Z0-9_-]+)/gi)].map(m => m[1]));
  const amounts = [...text.matchAll(/(?:Amount|Total)\s*:\s*(\d+(?:[.,]\d+)?)\s+([A-Z]{3})\b/gi)];
  const currency = unique(amounts.map(m => m[2]));
  const rawAmount = unique(amounts.map(m => m[1]));
  const dateValue = unique([...text.matchAll(/(?:Paid date|Payment date|Date)\s*:\s*(\d{4}-\d{2}-\d{2})/gi)].map(m => m[1]));
  const validDate = dateValue && !Number.isNaN(Date.parse(dateValue)) && new Date(dateValue).toISOString().slice(0, 10) === dateValue;
  return { reference, amount: rawAmount && currency ? minorUnits(rawAmount, currency) : null, currency, date: validDate ? dateValue : null, ambiguous };
}

export function assessReceipt(input: { text: string; ocr: string; expected: { amount: number; currency: string }; evidence: Evidence | null; reused?: boolean }): Assessment {
  const claim = extractClaim(input.text || input.ocr);
  const visible = extractClaim(input.ocr);
  const findings: Finding[] = [];
  const add = (code: string, level: Finding["level"], message: string) => findings.push({ code, level, message });
  const complete = (c: Claim) => !c.ambiguous && c.amount !== null && !!c.currency && !!c.reference && !!c.date;
  if (!complete(claim)) add("incomplete", "review", "Required fields are missing or ambiguous. Review the document manually.");
  if (!complete(visible)) add("ocr_incomplete", "review", "The visible PDF could not be read with enough certainty. Automatic confirmation is disabled.");
  const different = (["reference", "amount", "currency", "date"] as const).some(k => claim[k] !== null && visible[k] !== null && claim[k] !== visible[k]);
  if (different) add("visual_mismatch", "risk", "Visible document and embedded text disagree. Possible PDF alteration; inspect the preview.");
  else if (complete(visible) && complete(claim)) add("visual_match", "pass", "Visible document agrees with extracted fields. This does not certify document authenticity.");
  if (input.reused) add("reused", "risk", "This document or its extracted content was already submitted for a different payment.");
  if (claim.amount !== null && claim.amount !== input.expected.amount) add("payment_amount", "risk", "Receipt amount differs from the selected NATIO payment.");
  if (claim.currency && claim.currency !== input.expected.currency) add("payment_currency", "risk", "Receipt currency differs from the selected NATIO payment.");
  const e = input.evidence;
  if (!e) add("psp_unavailable", "review", "No independent PSP record is available. Missing confirmation is not proof of a fake receipt.");
  else {
    if (e.status === "pending") add("psp_pending", "review", "PSP payment is pending. Wait for a final provider result.");
    if (e.status === "failed") add("psp_failed", "risk", "PSP reports a failed payment; the receipt cannot confirm payment.");
    for (const [key, label] of [["reference", "reference"], ["amount", "amount"], ["currency", "currency"], ["date", "payment date"]] as const) {
      if (claim[key] === null) continue;
      if (claim[key] !== e[key]) add(`psp_${key}`, "risk", `Receipt ${label} differs from the independent PSP record.`);
      else add(`psp_${key}`, "pass", `PSP ${label} matches.`);
    }
  }
  const risk = findings.some(f => f.level === "risk");
  const review = findings.some(f => f.level === "review");
  const outcome = risk ? "suspicious" : !e || e.status === "pending" ? "awaiting_psp" : review ? "needs_review" : "psp_matched";
  return { outcome, claim, findings, evidence: e, checked_at: new Date().toISOString() };
}

export function receiptTransition(action: string, state: string, assessment: Assessment, note: string): { state: string; decision: string | null } {
  if (action === "reopen" && state === "closed" && note.trim().length >= 5) return { state: "in_review", decision: null };
  if (state === "closed") throw new Error("Reopen the closed case with a reason before making changes.");
  if (action === "take") return { state: "in_review", decision: null };
  if (action === "recheck") return { state: assessment.outcome === "awaiting_psp" ? "waiting_psp" : "in_review", decision: null };
  if (note.trim().length < 5) throw new Error("Enter a reason of at least 5 characters.");
  if (action === "request_info") return { state: "needs_info", decision: null };
  if (action === "reject") return { state: "closed", decision: "rejected" };
  if (action === "confirm" && assessment.outcome === "psp_matched") return { state: "closed", decision: "confirmed" };
  throw new Error("Confirmation requires a complete match with a successful PSP record and no unresolved findings.");
}
