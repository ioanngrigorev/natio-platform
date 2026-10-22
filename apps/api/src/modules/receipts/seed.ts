import { closeDb } from "../../db/client.js";
import { RECEIPT_SAMPLES, samplePdf } from "./demo.js";
import { parseReceiptPdf } from "./pdf.js";
import { receiptPayment, submitReceipt } from "./service.js";

// Explicit, idempotent command. Adds receipt cases ONLY, never financial records or users.
if (process.env.NATIO_SEED_SYNTHETIC_RECEIPTS !== "yes") throw new Error("Set NATIO_SEED_SYNTHETIC_RECEIPTS=yes to seed synthetic receipt cases.");
try {
  for (const sample of RECEIPT_SAMPLES) {
    await receiptPayment({ merchantId: "mer_d25_001" }, sample.payment_id);
    const pdf = (await samplePdf(sample.slug))!;
    const result = await submitReceipt({ merchantId: "mer_d25_001" }, sample.payment_id, pdf, await parseReceiptPdf(pdf), "system:synthetic-demo");
    console.log(sample.slug, result.id, result.duplicate ? "already present" : "created");
  }
} finally { await closeDb(); }
