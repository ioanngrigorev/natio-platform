import { readFile } from "node:fs/promises";
import type { Evidence } from "./analysis.js";

// Independent, explicit synthetic PSP fixtures. Never use the submitted PDF to construct PSP evidence.
// A production PSP adapter must replace this lookup before live verification can be enabled.
export const RECEIPT_SAMPLES = [
  { slug: "matched", title: "Matching payment", payment_id: "pay_d25_001_00001", amount: 2812, reference: "7398462518001", status: "succeeded" },
  { slug: "amount-mismatch", title: "Altered amount", payment_id: "pay_d25_001_00003", amount: 5550, reference: "7398462518003", status: "succeeded" },
  { slug: "currency-mismatch", title: "Wrong currency", payment_id: "pay_d25_001_00004", amount: 6918, reference: "7398462518004", status: "succeeded" },
  { slug: "pending", title: "PSP still processing", payment_id: "pay_d25_001_00005", amount: 8287, reference: "7398462518005", status: "pending" },
  { slug: "unavailable", title: "No PSP confirmation", payment_id: "pay_d25_001_00006", amount: 9656, reference: "7398462518006", status: "unavailable" },
  { slug: "reference-mismatch", title: "Wrong PSP reference", payment_id: "pay_d25_001_00007", amount: 11025, reference: "7398462518007", status: "succeeded" },
] as const;
export function demoEvidence(paymentId: string): Evidence | null {
  const sample = RECEIPT_SAMPLES.find(s => s.payment_id === paymentId);
  if (!sample || sample.status === "unavailable") return null;
  return { reference: sample.reference, amount: sample.amount, currency: "EUR", date: "2025-01-01", status: sample.status, source: "Asterin Demo PSP · independent synthetic fixture" };
}
export async function samplePdf(slug: string): Promise<Buffer | null> {
  if (!RECEIPT_SAMPLES.some(s => s.slug === slug)) return null;
  return readFile(new URL(`./fixtures/${slug}.pdf`, import.meta.url));
}
