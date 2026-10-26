# NATIO delivery workspace: Jira capability plan

Reviewed 26 October 2026. This is an implementation plan, not a claim of Jira feature parity. NATIO keeps its own interface, payment permissions and Test/Live isolation. ICE values below are engineering estimates (Impact × Confidence × Ease, each 1–10).

## Reference behavior

- [Kanban backlog](https://support.atlassian.com/jira-software-cloud/docs/use-your-kanban-backlog/): create and refine work in backlog, then drag selected work onto the board.
- [Column configuration](https://support.atlassian.com/jira-software-cloud/docs/configure-columns/): workflow statuses map to columns, with work-in-progress constraints.
- [Scrum backlog](https://support.atlassian.com/jira-software-cloud/docs/use-your-scrum-backlog/): rank work, plan sprints and move work into a sprint.
- [Jira feature overview](https://www.atlassian.com/software/jira/features): planning, dependencies, views, automation, collaboration and reporting.

## Current implementation and release scope

Existing: versioned tasks, specifications, assignments, dependencies, sprint goals, story points, dates, Gantt, audit history, ICE, export, role permissions, agent runs and deployment evidence.

This change: Backlog → Analysis → To do → In progress → Test → Done; draggable cards and keyboard status control; create directly from the backlog column; actual-work default. Legacy review records move to Test with an audit event. Independent agent code review remains mandatory. Done still requires acceptance/release evidence. Existing reviewed backlog items may go directly to To do. Unprepared new requests remain drafts until objective and acceptance criteria are supplied.

## Planning release (in validation)

Stable NAT keys and epic/story/task/bug/subtask hierarchy; title-only backlog capture with readiness checks at To do; persistent manual card ordering with workspace serialization and version conflict detection; drag or button assignment between unassigned backlog and an open sprint, preserving status. ICE remains the default selectable order. Hierarchy selectors use the currently loaded authorized tasks. Full-text/JQL search and arbitrary custom hierarchy levels are not included.

## Flow and automation release (in validation)

Event-based cumulative flow for 30 UTC days, actual-only throughput, median lead time, p85 cycle time and aging work. A current-state observation records the legacy baseline without inventing historical timestamps. Agent-start and verification transitions now write explicit status events.

Versioned assignment rules support a status trigger, optional issue-type condition, developer/QA assignment, enable/disable, preview without writes, a 25-rule cap and an execution log. Rules run once per event in creation order, use a non-recursive pass and isolate failed actions. They do not launch agents, deploy, notify external recipients or bypass status checks. Broader trigger/action libraries, scheduled rules, sprint burndown/velocity, attachments and ecosystem parity remain separate work.

## Capability acceptance matrix

| Capability | Acceptance criteria | I/C/E | ICE |
|---|---|---|---|
| Persistent board ranking | Drag within a column persists order across reload; concurrent reorder cannot lose cards; ICE remains a separate selectable ordering | 9/9/8 | 648 |
| Backlog and sprint planning panel | Drag backlog into selected sprint, remove from sprint, explain inactive-sprint restrictions; never start work on assignment alone | 9/9/7 | 567 |
| Task keys, types and hierarchy | Stable NAT-123 keys; epic/story/task/bug/subtask; parent validation and descendant navigation | 9/8/7 | 504 |
| Comments, mentions and watchers | Permission-checked threaded activity, edit history, opt-in notifications; private task content never leaks | 8/9/7 | 504 |
| Saved filters and board views | Filter by assignee/type/priority/status/sprint/labels; saved private/shared filters obey access controls | 8/9/7 | 504 |
| Quick task capture | Create backlog task with title, add detail later; readiness checks apply when moving to To do, not while capturing ideas | 8/9/7 | 504 |
| Configurable workflows and columns | Admin can map multiple statuses to columns; validate transitions and migration of populated statuses | 9/8/6 | 432 |
| Sprint closure and reports | Explicit carry-over destination, velocity and burndown from actual event timestamps; demo excluded | 8/9/6 | 432 |
| Attachments | Authorized upload/download, limits, content validation, private storage and safe rendering | 8/8/6 | 384 |
| Releases and versions | Group tasks into versions; release checklist, linked verified commit and deployment; reversible planning edits | 8/8/6 | 384 |
| Automation rules | Trigger/condition/action with dry run, permissions, deduplication, quotas, execution audit and failure recovery | 9/8/5 | 360 |
| Dashboards and flow reports | Cumulative flow, lead/cycle time, aging and blocked work derived from events with explicit definitions | 8/8/5 | 320 |
| Bulk edits and import | CSV preview, field validation, dry run, atomic or explicitly reported partial results, export round trip | 7/8/5 | 280 |
| Multi-project portfolio | Separate project membership, cross-project authorized dependencies, capacity planning and shared views | 8/7/4 | 224 |
| Integration ecosystem | Scoped Git/provider connectors, webhooks, credential storage, retries and audit; authorize external writes explicitly | 8/7/4 | 224 |
| Advanced search language | Documented parser, safe parameterized queries, permission filtering and query validation | 7/7/4 | 196 |

Full Jira parity additionally requires a maintained product/version/edition matrix, administrative schemes, enterprise identity, app ecosystem compatibility, mobile/offline behavior and ongoing regression evaluation. No unsupported parity claim is made by shipping the board release.
