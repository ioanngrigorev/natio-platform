# NATIO web app — conventions for contributors (and coding agents)

Stack: Next.js 14 App Router, React 18, TypeScript (strict), Tailwind 3, Recharts 2. No other UI libraries.

## Non-negotiable product rules
- Every button/action must call a real API endpoint (see `apps/api/src/http/routes/*.ts`). No decorative controls.
- Every table/metric must come from the API. No hardcoded demo numbers. Empty states are fine.
- Money is in minor units from the API: always render with `formatMoney(minor, currency)` from `@/lib/format`.
- Dates: `formatDateTime` (tables), `formatDateTimeFull` (timelines/audit), `formatRelative`.
- Legal wording (public UI): "payment orchestration", "technology infrastructure", "provider connectivity", "routing", "payment operations". Never call NATIO a bank, acquirer, payment institution or EMI. No invented partners, logos, volumes, uptime numbers or country counts.
- NATIO is not a custodian: settlement/balance screens must say funds are held and settled by licensed providers.

## Data access
- Server Components (default for pages): `const api = serverApi();` from `@/lib/session` then `await api.get<T>("/dashboard/...")` / `api.post`. It forwards cookies and the selected mode (`X-Natio-Mode`, from the `natio_mode` cookie). Pages that read data must `export const dynamic = "force-dynamic"` is already set on the layout; no caching.
- Client Components (`"use client"`): `const session = useSession();` from `@/components/session-provider`, then `await session.api<T>(path, { body })` (POST by default when a body is given; pass `method: "PATCH" | "DELETE"` otherwise). It injects CSRF + mode. Use `session.toast(msg, "ok"|"bad")` for feedback and `router.refresh()` (next/navigation) after mutations so server components re-fetch. `session.can("permission")` gates merchant actions (permissions list in `apps/api/src/modules/auth/permissions.ts`). For admin, `session.user.role` is one of superadmin/operations/support/readonly.
- Errors: wrap calls in try/catch and show `errorMessage(err)` (from session-provider) in an `<Alert tone="bad">` or toast. 404 from the API in a detail page → `notFound()` (see `app/dashboard/(app)/payments/[id]/page.tsx`).
- Query-string filters: use `<FilterBar filters=[...] />` from `@/components/dashboard/filters` (client) and read `searchParams` in the page; pass them through `qs()` from `@/lib/api`. Pagination with `<Pagination hasMore nextCursor baseHref params />`.
- Multipart upload (reconciliation CSV): `session.api(path, { formData })`.

## UI kit (`@/components/ui`)
`PageHeader`, `Card` (title/description/actions, `padded={false}` for tables), `Grid`, `Kpi`, `StatusBadge`, `Tag`, `Button` (variants primary/secondary/danger/ghost, `loading`), `LinkButton`, `Table` (+ `.data-table` classes; numeric cells `className="num"`), `EmptyState`, `Mono`, `DescriptionList`, `Alert`, `Pagination`, `CodeBlock`, `Field` (+ `.input`, `.label`, `.help` classes). Modals: simple fixed overlay pattern as in `components/dashboard/create-test-payment.tsx`. Charts: `VolumeChart`, `SuccessRateChart`, `BreakdownChart`, `Sparkbar` from `@/components/charts` (client components; categorical colors fixed: `CATEGORICAL`).

## Look & feel
Minimal, institutional, data-first: white cards on `bg-ink-50`, 13px body text, 11px uppercase labels, mono for ids/codes, muted status badges (ok/warn/bad/info/muted tones — no neon, no gradients, no illustrations). Reference pages: `app/dashboard/(app)/page.tsx`, `app/dashboard/(app)/payments/page.tsx`, `app/dashboard/(app)/payments/[id]/page.tsx`. Keep to that density and tone. Marketing pages use `.prose-natio` for long-form text and larger type for headlines, still restrained (see tailwind.config.ts palette: ink, brand, ok/warn/bad/info).

## Types
Response types live in `@/lib/types` (Payment, Transaction, Payout, Settlement, Balance, ReconBatch, WebhookEndpoint, WebhookDelivery, ApiKey, Provider, ProviderAccount, RoutingRule, RiskRule, AnalyticsOverview, Breakdowns, ProviderComparisonRow, AuditEntry, TeamMember, Paginated<T>). Extend there when needed; keep field names snake_case as the API returns them (admin routing/risk rules are camelCase — see the types).

## Checks before finishing
`cd apps/web && npx tsc --noEmit` must pass. Pages must render without runtime errors against the running API (http://localhost:4000, dev web on http://localhost:3000). Demo logins: merchant owner@demo-merchant.local / Natio-demo-2026 (dashboard), admin@natio.local / Natio-demo-2026 (admin). Screenshot helper: `node /home/claude/shot.mjs "<path>" out.png` with env `LOGIN=/dashboard/login EMAIL=... PASS=...` (or `LOGIN=/admin/login`).
