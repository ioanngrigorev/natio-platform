> Current follow-up scope and superseded requirements: [23 October release acceptance matrix](release-2026-10-23.md). Earlier verification notes below are historical snapshots.

# NATIO investor demo

Updated: 22 October 2026. Historical dataset: 1 January–31 December 2025 (UTC).

## Agreed scope

- Admin area: Light (white/violet), Dark (violet), and Mint (dark green, #00da9c / #81fdda). Retain NATIO identity. No Big Idea or Softler logos.
- 100 fictional merchants, 100 merchant owner users, 10,000 fictional payment providers.
- Exactly 10,000 ledger transactions per merchant/user, 1,000,000 total, with varied amounts, fees and statuses.
- Test mode only. Existing investor administrator remains read-only. No payment credentials or real outbound webhook jobs.
- Payment methods, currencies and geography based on the supplied All metods.xlsx. Provider/company and payment-method labels are invented. The cleaned catalog has 203 combinations, 116 method labels, 43 currencies and 54 countries.
- Transaction presentation follows the supplied processing-admin reference: merchant, channel, external reference, gateway reference, type, amount, received, fee, status, method, geography and dates.
- Populate payments, payouts, provider accounts, routing, risk, settlements, reconciliation, webhook history and operational events.
- Balances are calculated by currency from successful ledger entries and settlement records. Do not combine currencies without an explicit conversion model.
- BI: aggregated charts over the complete dataset, date/merchant/currency/method filters, trends and breakdowns, Excel reports.
- Demo overview defaults to calendar year 2025. Lists use bounded pagination; million-row data is aggregated on the server.

## Published dataset and stop instruction

The user stopped further data loading on 22 October 2026. The retained dataset has 670,000 transactions, 603,000 payments and 67,000 payouts: 67 merchants have 10,000 transactions each; 33 merchants have no imported history. There are 100 merchants, 100 merchant users and 10,000 payment providers. The original one-million target is superseded by the stop instruction. No import process remains active. All ledger dates are in 2025 and all rows are in test mode. Enrichment of risk/routing details stopped with the import, so some historical details are absent.

## Additional UI requirements

- Light / Dark / Mint controls in the admin header, with preference stored for subsequent visits. Instant switching without a server round trip.
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

## BI report center and Mint release

- Third theme, Mint, uses the reference site's green/mint palette with the NATIO identity. Header switching is immediate and survives reload/navigation via a theme cookie.
- Animated area, bar, line and outcome charts; monthly/daily detail, replay and animation on/off. Initial motion respects the operating system's reduced-motion preference.
- Eight report templates: executive summary, transaction ledger, daily activity, merchants, provider accounts, methods, geography and currency balances.
- Shared date, currency, merchant, payment method, country, status, operation and provider-account filters. Calendar-year and quarter shortcuts.
- Paginated report preview (25 rows), sorting, exact totals, links to merchant/account profiles. Excel and CSV export every matching row, independent of preview pagination. All-currency reports group by currency; no implicit FX conversion.
- Download progress, cancellation and failure feedback. Frozen/filterable Excel headers and numeric monetary cells. CSV formula neutralization for text values.
- Named report views saved per admin and data mode in the current browser. Print/PDF uses the browser's current page print dialog.
- All 116 payment-method display labels are fictional NATIO labels, including catalog, JSON responses, provider accounts, charts and exports. Original immutable history remains untouched; server-side aliases also resolve filters. Real/live integrations are unchanged.
- No database migration, import restart or additional synthetic rows.

Validation: API and web production builds pass. Nine new unit tests cover aliases, filter binding, currency separation, preview/export boundaries, CSV escaping, spreadsheet numeric types and stream failure cleanup. Production checks cover all eight templates, disjoint pagination, alias/status/type filtering, a 10,000-row Excel/CSV round-trip and summary reconciliation (EUR 500,448.75 for merchant 001). Coverage remains 670,000 transactions, 100 merchants, 100 users and 10,000 providers.

## Payment timeline refinement · 23 October 2026

- Daily mode shows exact daily values with monotone interpolation. Optional MA 7 overlays a dashed trailing seven-calendar-day average without hiding actual values. The first six days use available history. Days with no operations contribute zero. Source amounts and exports are unchanged.
- Daily, Monday-based weekly and monthly intervals. Partial edge buckets include only selected dates, shown in tooltips.
- Lower timeline preview with draggable/keyboard handles and 7/30/90/180-day and All shortcuts anchored to the report end. Zoom affects only the payment-volume chart; report filters and exports remain unchanged.
- The amount above the chart is the exact total of original daily values within the visible range. Tooltips expose both original amounts and the displayed average.
- Quiet grid, thinner curve, subtle gradient and theme-aware tooltip/navigator; reduced-motion handling retained.
- Unit checks cover zero-filled dates, rolling-window boundaries, calendar-year/week boundaries, leap days, partial buckets, exact minor units, empty data and historical zoom presets.

Hosting check: natio.me, api.natio.me and app.natio.me resolve to 95.179.244.175; the machine identifies itself as Vultr VC2. Web, API, worker, PostgreSQL and Redis run there. The remaining Sprintbox host serves unrelated projects and is outside the NATIO-only scope.

## Admin performance and usability · 23 October 2026

- Demo shortcuts (1/7/30/90 days) end on the most recent transaction day within 2025. Live shortcuts still follow the current clock. The full-year shortcut remains available and the exact UTC dates are visible above the KPIs.
- Overview order: reporting period, period-specific financial KPIs, volume/outcome charts, Needs attention queues, workspace-wide totals, provider details and currency volumes, recent events. Operational KPI links retain the selected period.
- Navigation groups: Overview/BI, Operations, Customers, Finance, Payment setup, Platform. Receipt review remains under Finance.
- BI prioritizes dates/currency/merchant; additional filters are expandable and automatically open when active. Summary and ledger exports remain available.
- Provider period controls moved above the list. Search and pagination preserve the chosen period; changing the period resets pagination. Slow provider comparisons stream separately from the usable provider list.
- Empty charts explain the selected range and offer a reset. Filter fields synchronize on browser Back/Forward.
- Merchant metrics now use batched aggregates instead of per-merchant repeated scans. BI breakdowns use PostgreSQL GROUPING SETS and a narrow projection.
- Only authenticated admin overview, BI and provider-comparison snapshots are cached, for 15 seconds, in a bounded 64-entry process-local cache. Concurrent identical requests share work. Keys include data mode and every filter. Errors are not cached; successful admin mutations clear snapshots. Session/RBAC checks still run on each request. Transaction lists, report previews and exports bypass this cache.
- Admin session lookup is deduplicated only within a React server-render request, never across users.

Validation before release: all 448 tests across 33 files pass on an isolated PostgreSQL 17 test cluster. Financial comparisons against the unchanged production database match the prior implementation for default BI, merchant/date/currency/status filters, empty results and both merchant modes. Server-side BI calculation: 3370 → 2600 ms; merchant list: 4791 → 1352 ms. These are individual measurements, not load-test percentiles. Production response timings will be recorded separately after rollout.

References: [PostgreSQL grouping sets](https://www.postgresql.org/docs/16/queries-table-expressions.html#QUERIES-GROUPING-SETS), [React request-scoped cache](https://react.dev/reference/react/cache), [Recharts timeline navigator](https://recharts.github.io/en-US/api/Brush/).


## Chart detail update · 23 October 2026

- Actual values are the primary line; MA 7 is optional and off by default. Long reports open at the last 90 days, with exact visible dates and sum displayed; All restores the complete report.
- Auto scale fits visible minimum/maximum with padding, preserves zeros/outliers and explicitly labels a non-zero baseline. From zero remains available. High/Low refer to the selected aggregation interval within the visible range.
- Right-hand value scale, compact interval toolbar, 7/30/90/180-day presets, zoom in/out and bounded earlier/later panning. Volume and outcome charts remain side by side from 1024px; narrower screens stack them. Navigator and all three themes retained.
- Visual reference: [Bybit chart navigation and display controls](https://www.bybit.com/en/help-center/article/Bybit-Trading-Chart-FAQ). No trading candles or price data are fabricated from payment totals.
- Regression: ten volume-series tests cover accounting, scale edge cases and bounded navigation; local browser checks verify actual/MA overlays, range totals, zoom and themes.
- Production measurements (sequential requests from the same client; full HTML response; not load-test percentiles): repeated Overview 6.811 → 1.718 seconds; BI 5.143 → 1.809 seconds; Providers 6.788 → 1.927 seconds. First BI response after cache expiry was 4.328 seconds and Providers 6.395 seconds. Merchant list 4.996 → 2.702 seconds on first measured page request. Network distance and the single-vCPU database remain relevant for cold analytics.

- Status badges now use consistent semantic colors across all admin themes: success green, pending/processing orange, failure red, action/info blue, disabled/cancelled grey. Transaction-outcome sectors use the same meaning. Text labels remain visible.
- Native select controls retain keyboard behavior with a custom chevron inset 0.8rem from the right edge and 2.5rem text padding.

## Admin workspace — 23 October 2026

- Knowledge base: 16 searchable Russian articles, workflow diagrams, source section links and assistant handoff. Static search remains usable when the AI provider is unavailable.
- Global assistant: persistent panel across admin sections, page context, text input, bounded voice recording/transcription, optional browser speech output. Server calls OpenAI Responses with `store:false` and strict structured outputs; no automatic financial row or credential transmission. Invalid/timeout/auth upstream responses are explicit errors, never fabricated success. Production voice/text still requires a valid server key; the previously selected key failed validation with 401 and was not installed.
- Assistant visual answers: chart cards computed through authenticated BI, metrics, date/currency/mode labels and Excel/CSV downloads. Charts use actual server results, not model-generated numbers. Editable proposals can be saved as private, mode-separated dashboards.
- Connection Lab: private sandbox drafts with parameter review and explicit confirmation. Three fictional connector templates; seven executable checks for health, outage, retry decisions and unknown timeout safety. Persistent run history and measured durations. Does not create payments, contact live PSPs or activate routing.
- Risk intelligence: date/currency/merchant/PSP filters, internal threshold controls, payment failure trend, PSP concentration, large-payment observations, KYB warnings, daily activity spikes, evidence queue and Excel workbook. Concentration denominator uses all successful payment volume; provider list shows top 100. Dispute/fraud feed is unavailable and clearly labelled. Separate Test-only same-cohort chargeback exposure calculator; no network-program compliance is claimed. Industry playbooks use declared profile metadata and never infer industry from names.
- KYB/account UX: verification, account access and live processing eligibility have distinct columns. Current eligibility is rechecked at payment creation, payout creation, capture and manual approval. Refund/cancellation paths remain available under their existing permissions.
- Routing demo: read-only users can edit a local preview and choose any ranking profile. A policy handoff opens Routing Studio with the selected profile and score simulation. Saving published rules still requires `routing.manage`; the draft conditions/chain are explicitly not included in this policy preview.
- Microphone permissions: allowed for same-origin admin pages only, still requiring the browser user's grant; camera/geolocation/payment permissions remain disabled.

Research references reviewed 23 October 2026:
- https://docs.adyen.com/risk-management/dispute-and-fraud-monitoring
- https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf
- https://developer.paypal.com/braintree/articles/risk-and-security/card-brand-monitoring-programs/mastercard-programs/excessive-chargeback-program
- https://www.adyen.com/de_DE/legal/list-restricted-prohibited/
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://developers.openai.com/api/docs/guides/speech-to-text

Financial definitions: failure rate uses failed / (successful + failed) payment operations. Refund amount is separate. The what-if dispute ratio uses disputed / settled within the explicitly entered same cohort; it is not VAMP or ECP. Actual network monitoring requires PSP/scheme data, reporting periods and applicable exclusions.

### Market, support and report visualizations — 23 October 2026
- Report tabs now have contextual visualizations before the ledger: volume/financial position, outcome distribution and operation counts. A separate backend aggregate covers all matching rows; top-12 and daily-731 limits are explicit, currencies are selectable and never added together. Pagination does not change the chart scope.
- Market intelligence: 17 supported FX base/quote choices, 90-day history, indicative converter, source date and stale/error states. Frankfurter daily reference rates do not change stored ledger amounts or PSP pricing.
- News stream: public Telegram previews from Gambling Radar and monoup; five-minute server cache, one-minute visible-page refresh, category/search/source filters, short headlines with original post links. Gaming Voice and Product HUB require private-channel authorization; their archive contents are not imported.
- Support: account-scoped tickets, support-role inbox, replies and open/in-progress/resolved states; persistent link in the top bar and hand-off from AI panel. @natiohelpbot links a private chat using a hashed one-time 10-minute token. Signed webhook, duplicate update protection, private-account boundaries and bounded retry outbox. Telegram sends only after configuration; no service-level response time is promised.
- Elegant line icons and separators distinguish Operations, Customers, Finance, Payment setup, Platform and Support in all themes.
- Primary integration references: https://frankfurter.dev/ (daily reference rates); https://core.telegram.org/bots/api (webhook secret, updates and messages); https://core.telegram.org/bots/features#deep-linking (account linking).

### Workspace release verification — 23 October 2026
- API regression: 476 tests across 37 files passed; an additional targeted run passed 8 market/support tests after cache and disconnect changes.
- Browser: knowledge search and article flow, a Lab run (7/7 checks), actual FX/news feeds, contextual report charts, and support request/reply/resolution verified against the local production build. No browser errors observed.
- AI UI and guarded server integration are implemented; live AI and voice responses remain unavailable until a valid OpenAI key is provisioned (existing credential returns 401). No placeholder AI answer is presented as a live result.
- Telegram support uses @natiohelpbot with per-user one-time account linking. Private Telegram news channels remain marked Access required; public previews are refreshed every five minutes.
