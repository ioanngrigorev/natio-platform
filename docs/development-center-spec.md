# Development Center and merchant plans

Status: initial release 84f6c22 deployed and production smoke tests passed, 23 October 2026. BPMN notation follow-up is undergoing release verification.

## Workflow

All authenticated admin and merchant roles can see shared roadmap summaries. Premium merchant users and all admin roles can submit their own private requests. Text or a 45-second voice recording becomes an AI-generated, editable specification only when a working server-side OpenAI key is configured. Requests include objective, roles, scope, acceptance tests, technical work, risks and open questions. Manual specifications remain available without AI. No customer/payment records are sent to the model.

An author reviews and saves the specification before choosing Ideas, Backlog, Rejected or Archive. Rejection and archive require a reason. The author can queue their approved request in To do or return it to the backlog. Operations/superadmin staff perform actual development transitions: In progress → Code review → Test → Done. Done requires recorded review/test/release evidence. No coding agent or production deployment is automatically launched by changing a task status.

Specifications support browser Print / Save PDF with a dedicated A4 layout and an editable BPMN 2.0 XML export. Two non-executable BPMN collaboration templates cover feature delivery and payment interactions. External participants are separate pools; internal roles are lanes. Message start events, end events, typed tasks, exclusive gateways and labelled default/conditional branches use standard notation. Solid sequence flows remain in a process; dashed message flows connect participants. All waypoints are orthogonal and are shared by the SVG preview and BPMN DI export. Payment exceptions stay away from the ledger, and failed QA returns to engineering. The XML is checked against the [OMG BPMN 2.0.2 schemas](https://www.omg.org/spec/BPMN/2.0.2). They are conceptual diagrams; they do not claim a payment integration is already deployed or substitute for complete exception handling.

## Prioritization

A fixed three-month horizon makes estimates comparable. Score (forecast USD per risk-adjusted engineering hour):

`max(0, 3*(monthly incremental revenue + monthly savings) - one-time cost) * confidence * (0.5 + 0.5*market evidence) / (effort hours * (1 + 0.15*(complexity-1)))`

Confidence and market evidence range from 0 to 1. Complexity ranges from 1 to 5. Effort must be positive. Estimates and evidence are editable; the server recomputes the score. A novel feature retains half the market weight. Zero confidence yields zero priority until refined. Revenue, savings and one-time costs must not double count the same benefit. Realized value is a separate staff-controlled field. This is a NATIO adaptation inspired by RICE, not a standard RICE score. Regulatory/incident work can be manually queued independently of its commercial score.

## Delivery views

- Kanban: To do, In progress, Review, Test, Done; maximum five actual In-progress items per test/live workspace; dependency cycles and starting unfinished dependencies are rejected.
- Scrum: sprint goal, 1–31-day date range, assignment, one active sprint per mode, completion counts and story points. Unfinished items must be explicitly returned/unassigned before sprint completion. Story points are not translated into AI minutes.
- PMBOK-inspired plan: schedule, assigned developer, analyst, QA, DevOps, dependencies and one-date milestones; Gantt timeline and on-time/late outcomes. These tools do not represent certification or implementation of every PMBOK practice.
- Metrics: actual WIP, last-30-day throughput, elapsed cycle time, oldest active work and separately measured AI/human work timers. Manual timers use server timestamps, one active timer per actor, and do not pretend to launch coding agents.

## Visibility and concurrency

Test/live isolation applies to records and notices. Private requirements are visible only to their author and internal admins. Staff may publish an explicit public summary plus the forecast, schedule and team to every role. Other merchants cannot see raw requirements, technical details, source page, private evidence or audit details. Delivery/financial-realization changes require a manager. All item mutations use optimistic versions and transactional locking. Significant actions are recorded as events; plan changes also enter the platform audit log.

## History and opportunities

The seed creates 33 implemented module retrospectives and four milestones across 2025, with explicitly fictional names, dates, deadline performance and lifecycle events. It creates no financial records and does not claim actual historical revenue. Existing functionality is checked against repository evidence. The current ledger is an immutable financial-movement journal; no unsupported double-entry accounting claim is made. Demo records are excluded from actual performance metrics. Outstanding AI activation and a real dispute feed remain backlog items.

Shared actual releases automatically create in-app notices. Staff can publish reviewed market/product opportunities with a source URL. A bell and Opportunities inbox show unread notices; requesting an integration creates a prefilled specification draft, not an active PSP. This release does not automatically research all market developments or scrape private Telegram channels.

## Plans and billing boundaries

Draft monthly prices: Light $99, Optimal $299, Premium $999. Superadmins can edit prices and assign access; merchant owners/admins can request changes. Approval changes entitlements, never charges a card. No recurring billing, invoicing, taxes or payment collection is enabled. Unassigned demo/legacy merchants retain Premium until explicitly changed. New self-registered merchants start on Light.

- Light: overview dashboards, read financial records, shared product roadmap.
- Optimal: Light plus advanced reports and AI design/workflow recommendations.
- Premium: Optimal plus development submission/management, API/webhook integrations and role-authorized operational actions.

Authorization is enforced on the API (including existing API keys); frontend navigation explains upgrades. Premium is not a substitute for role permissions. Read-only financial visibility remains separately governed by role permissions.

## Sources

- [Intercom RICE](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers)
- [Scrum Guide](https://scrumguides.org/scrum-guide.html)
- [Kanban Guide](https://kanbanguides.org/the-kanban-guide)
- [PMI PMBOK](https://www.pmi.org/standards/pmbok)

## Verification

Backend regression: 487 tests across 38 files passed. Additional targeted tests cover Light dashboard access, denied writes and denied API-key access after downgrade. Production frontend build passed. Browser, export and deployment verification is recorded in the release report.

## AI connectivity follow-up

The supplied project key is stored only in the protected server environment. A real Responses request reached OpenAI but returned credit_balance_exhausted / insufficient_quota. Credit exhaustion now has a distinct safe error, separate from transient rate limits. No successful AI generation is claimed until a live request completes.
