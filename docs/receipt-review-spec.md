# Receipt review — synthetic investor demo

## Location and scope

Finance → Receipt review in both `/admin/receipts` and `/dashboard/receipts`.
Merchant: upload a synthetic PDF, preview its analysis, submit and follow a case.
Operations: queue, filters/search, document preview, PSP comparison, reasons and append-only history.
Investor read-only: view cases and run transient sample/upload analyses; no case/decision writes.

Only Test Data is enabled. Live mode is rejected server-side. Real receipts, bank details,
customer records and Telegram attachments were not imported. Existing financial data is not modified.
Six fictional PDF fixtures refer to existing synthetic 2025 payments; no new payments or balances
are generated. All provider evidence is explicitly labelled as a demo fixture.

## Workflow

1. Merchant selects an owned test payment and acknowledges synthetic data, then uploads PDF.
2. Server validates authorization, MIME/signature, 5 MB size and 1–3 unencrypted pages.
3. Local Poppler renders every page; local Tesseract reads each image. No external OCR API.
4. Extract exact amount/currency, reference and UTC date. Compare embedded text with visible OCR.
5. Compare with an independent, immutable synthetic PSP fixture tied to the selected payment;
   also compare amount/currency with the selected NATIO payment. Date tolerance is zero days.
6. Detect same bytes or normalized extracted text reused against another payment.
7. Operator takes case, rechecks, requests information, rejects with a reason, or confirms a clean
   successful PSP match. Closed cases require explicit reopening with a reason.
8. Store each event with actor, time and evidence snapshot; concurrent decisions require a matching version.

The read-only Telegram review covered visible operator examples: transaction/order identifiers,
processing status, comments, closure and an explicit fake-receipt reason. No message was sent and no
real document or transaction identifier was copied. Telegram messaging integration is not included.

## Meaning of results

- **PSP matched:** required fields and visual extraction match a successful PSP record. This confirms
  the demo payment evidence, not the cryptographic authenticity of the PDF.
- **Suspected alteration:** a concrete discrepancy or reuse signal; an operator must assess it.
- **Manual review:** missing/ambiguous fields or uncertain OCR. Unknown layouts are not guessed.
- **Awaiting PSP:** no independent record or pending result. This is not proof of a fake receipt.

This is rule-based evidence verification, not a universal forgery detector. Digital signatures are
not validated. The initial parser supports labelled English fields and ISO dates; unsupported layouts
fall back to manual review. A real PSP lookup adapter, real-document retention policy and operational
validation are required before a separately authorized live release.

## Controls and persistence

- Session authentication, existing role permissions, CSRF, per-route analysis rate limits.
- Merchant ownership checked before parsing and on every case/file read.
- `payments.write` submits merchant cases; `reconciliation.manage` handles admin writes.
- Parser concurrency limited to one per process; bounded subprocess timeout/output and raster dimensions.
- Files stored in PostgreSQL, inaccessible as public static assets. Safe raster previews; PDF attachment only.
- Case events are append-only at database level. Duplicate submissions for the same payment are idempotent.
- A decision never credits funds, changes payment status, triggers a PSP action or sends Telegram messages.
- Seed command: `NATIO_SEED_SYNTHETIC_RECEIPTS=yes node dist/modules/receipts/seed.js` (idempotent).

## Validation

Unit checks cover PSP availability/status, altered fields, OCR disagreement, duplicates, exact minor
units and operator transitions. Release checks cover PDF rendering/OCR, authenticated UI/navigation,
demo analyses, role/ownership/CSRF denial, database event immutability and concurrent updates.
