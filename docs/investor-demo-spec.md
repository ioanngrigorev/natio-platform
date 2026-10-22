# NATIO investor demo

Updated: 22 October 2026. Historical dataset: 1 January–31 December 2025 (UTC).

## Agreed scope

- Admin area only: white surfaces, violet #1d17f3 and its tints. Retain NATIO identity. No Big Idea or Softler logos.
- 100 fictional merchants, 100 merchant owner users, 10,000 fictional payment providers.
- Exactly 10,000 ledger transactions per merchant/user, 1,000,000 total, with varied amounts, fees and statuses.
- Test mode only. Existing investor administrator remains read-only. No payment credentials or real outbound webhook jobs.
- Payment methods, currencies and geography based on the supplied All metods.xlsx. Provider/company names are invented. The cleaned catalog has 203 combinations, 116 method labels, 43 currencies and 54 countries.
- Transaction presentation follows the supplied processing-admin reference: merchant, channel, external reference, gateway reference, type, amount, received, fee, status, method, geography and dates.
- Populate payments, payouts, provider accounts, routing, risk, settlements, reconciliation, webhook history and operational events.
- Balances are calculated by currency from successful ledger entries and settlement records. Do not combine currencies without an explicit conversion model.
- BI: aggregated charts over the complete dataset, date/merchant/currency/method filters, trends and breakdowns, Excel reports.
- Demo overview defaults to calendar year 2025. Lists use bounded pagination; million-row data is aggregated on the server.

## Published dataset and stop instruction

The user stopped further data loading on 22 October 2026. The retained dataset has 670,000 transactions, 603,000 payments and 67,000 payouts: 67 merchants have 10,000 transactions each; 33 merchants have no imported history. There are 100 merchants, 100 merchant users and 10,000 payment providers. The original one-million target is superseded by the stop instruction. No import process remains active. All ledger dates are in 2025 and all rows are in test mode. Enrichment of risk/routing details stopped with the import, so some historical details are absent.

## Additional UI requirements

- Light / Dark controls in the admin header, with preference stored for subsequent visits. Instant switching without a server round trip.
- Provider, provider-account and user detail pages; links from overview, provider cards, operations lists and merchant profiles.
- Account details show financial totals separately by currency and link to filtered payments, transactions, settlements and reconciliation.
- Navigation shows a loading state. Filter dropdowns fetch only merchant names/IDs, avoiding unnecessary financial aggregation.

## Progress

- [x] Restored public admin login/API proxy; investor access verified.
- [x] Inspected Big Idea colors and Softler reference format.
- [x] Extracted method/currency/geography catalog without commercial identities.
- [x] Complete scoped white/violet admin theme and responsive layout; Light / Dark toggle added.
- [x] Retain partial dataset at the user-requested stop; do not load further rows.
- [x] Add balances and BI charts, filters and Excel export.
- [x] Verify retained counts, 2025 date range, test mode, pagination and read-only access.
- [x] Deploy BI and demo on production; verify UI refinement release after deployment.

## Validation log

Before import: production contained zero merchants and zero transactions. Import uses an explicit demo namespace, transaction batches and a backup. Synthetic history is identified as demo data. Actual import audit records retain their true import timestamp.

Local validation: API and web TypeScript/build checks; 257 unit tests pass, including a streamed Excel workbook round-trip that verifies numeric amounts and frozen headers. Export rendering failure from assigning WorksheetWriter.views was fixed by setting views during worksheet creation.

Production verification: provider, account and user profiles return 200; provider-account transaction filter verified; Light and Dark clicked successfully. Excel summary and 10,000-row ledger download return 200; workbook opens, numeric amounts and 2025 dates verified, EUR summary matches ledger rows. Provider/account/user pages measured approximately 1–1.6 seconds after switching merchant dropdowns to compact options.
