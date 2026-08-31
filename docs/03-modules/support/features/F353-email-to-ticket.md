# F353 — Email-to-ticket

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F353`
- Canonical name: **Email-to-ticket**
- Module: **Support / Customer Service**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `SUPPORT-CAP-003`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Email-to-ticket exists to make customer-service work reliable, permission-safe, auditable and operationally complete rather than a generic CRUD record. It MUST integrate with the surrounding ticket/customer/SLA/conversation lifecycle while keeping authoritative ownership clear.

## [SPEC-OUTCOMES] Business outcomes and success measures
Success means operators can use Email-to-ticket without hidden spreadsheet/manual repair; customer-visible state and internal control state remain consistent; retries/concurrency are safe; and service/SLA/audit evidence is reproducible.

## [SPEC-PERSONAS] Personas and jobs to be done
Primary personas: support agent, queue supervisor, service manager and administrator. Customer/portal, knowledge author, auditor and cross-module operators apply where relevant. Negative-permission cases are part of acceptance.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
Expose through the Support workspace, global search/command palette where safe, ticket 360/context panels, supervisor queues/dashboards and customer portal only when customer-authorized. Deep links MUST preserve scope without leaking IDs.

## [SPEC-BENCHMARK] Benchmark research evidence
Captured official benchmark evidence: `SUPPORT-P10-BM-011-A`, `SUPPORT-P10-BM-011-B`. Benchmarks define mature behavior, not vendor UI cloning.

## [SPEC-DECISION] Vercentlabs benchmark decisions
Disposition: REQUIRED enterprise behavior. Deterministic authorization, privacy, SLA/entitlement/state truth stays authoritative; AI may assist only within the approved boundary.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Red-team review for **Email-to-ticket** covers concurrency, retries, customer/private visibility, stale permissions, duplicate ingestion/actions, calendar/timezone behavior, merge/reopen/correction, cross-module failures, accessibility, mobile and audit recovery. No unresolved material placeholder remains.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
Parent capability `SUPPORT-CAP-003`. Materialized requirement IDs in `SUBREQUIREMENT_REGISTER.csv` include `F353-CAP-001` plus feature-specific functional, flow, data, validation, calculation, UX, security, automation, approval, notification, reporting, AI, integration, API, performance, observability, E2E and UAT contracts.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
Normative functional contracts are `F353-FR-001..003` and `F353-US-001`. They require an end-user workflow, server-side authorization, state/history effects and actionable failure recovery.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
`F353-FLOW-001..003` cover primary, alternate, denied, concurrent, retry, cancellation/correction/reopen/compensation and reconciliation paths as applicable.

## [SPEC-STATE-MACHINE] State machine and transition rules
State ownership is explicit. Commands validate current/expected state and version, preserve transition history and define terminal/reopen semantics. UI labels never substitute for server state rules.

## [SPEC-DATA] Data model, entities, relationships and fields
`F353-DATA-001..002` define stable IDs, organization/company scope, actor/channel/source/time metadata, lineage, retention, indexes and relationships. Sensitive communication content remains separately permissioned.

## [SPEC-VALIDATION] Validation rules
`F353-VAL-001..002` require schema, cross-record/scope, lifecycle, temporal, duplicate/threading and reference validation with stable actionable errors.

## [SPEC-BUSINESS-RULES] Business rules and invariants
`F353-BR-001..002` define deterministic service invariants, private/public separation, effective-dated policy where applicable and precedence of manual overrides/configuration.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
`F353-CALC-001` defines any SLA duration, workload, CSAT/performance or reporting formula with business calendar, timezone, exclusions, precision and reproducibility. Non-calculation features explicitly inherit no hidden derived truth.

## [SPEC-VIEWS] Required view archetypes
`F353-UX-001..002` define the appropriate work queue/list, ticket 360/timeline, configuration form, knowledge workspace, portal view, dashboard/report or exception queue. Critical service actions remain visible without horizontal-scroll-only dependency.

## [SPEC-LIST] List, table and work-queue behavior
Lists support stable server pagination/sort/filter, saved views, permission-safe counts, bulk selection semantics and large-volume virtualization where needed. Private/sensitive columns are omitted server-side for unauthorized users.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search is authorization-aware, indexed and scoped. Customer/public search and internal-agent search have separate visibility rules; private notes/attachments never become searchable merely because the parent ticket is visible.

## [SPEC-DETAIL] Detail / 360 workspace
Ticket/detail 360 shows identity, customer/contact, status/priority, owner/queue, SLA timers, conversation, private collaboration, related records, history and permitted next actions with source/evidence links.

## [SPEC-CREATE] Create and quick-create UX
Creation supports contextual defaults, duplicate/idempotency protection, clear required fields and post-create destination. Email/web ingestion uses source identities rather than timestamps as uniqueness.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Mutable versus immutable fields are explicit. Stale edits use optimistic concurrency; ticket number/source message identity/history/audit evidence are immutable or corrected through append-only/versioned mechanisms.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk actions preflight every selected ticket against permissions/state and report per-record outcomes; no partial silent success. High-risk merge/visibility/entitlement actions are not casually bulk-executed.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Actions are grouped by risk and state. Destructive/contractual actions require confirmation/reason/permission and return the resulting state/audit/reference IDs.

## [SPEC-RELATED] Related records and contextual navigation
Related CRM/customer, Sales order/product, Assets, Quality and entitlement records use public module queries/contracts with permission-safe navigation; Support does not copy or mutate private foreign tables.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
`F353-AUTO-001` requires deterministic, policy-driven, idempotent routing/SLA/escalation/notification/background behavior with retry/dead-letter/reconciliation support.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
`F353-APP-001` defines maker-checker/manager override for sensitive actions such as destructive merge, entitlement override, private-content exposure or policy exceptions where applicable.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
`F353-NOTIF-001` requires deduplicated, loop-safe, permission-safe outbound notifications with bounce/failure/retry evidence and no private-note leakage.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/templates/generated communications define content-type/size limits, storage authorization, malware/quarantine processing, download disposition, retention and visibility inheritance. Generated knowledge/portal content is versioned.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports/migrations validate tenant/customer/status/history/threading references and support preview/dry-run/error evidence. Exports apply the viewer permission model and PII/private-note redaction rules.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
`F353-REP-001` defines formula lineage, dimensions, filters, drilldown, permission-safe aggregation, freshness and reconciliation to tickets/SLA/history/assignment events.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
`F353-AI-001..002`: AI may classify, summarize, draft replies, retrieve knowledge, suggest routing/duplicates and flag sentiment/SLA risk, with provenance/confidence/human override. It MUST NOT authorize access, expose private content, decide entitlement/SLA truth, destructively merge or bypass state rules.

## [SPEC-SECURITY] Security, permissions and field controls
`F353-SEC-001..002` require tenant/company/team/queue/ticket/customer scope, IDOR protection, field/content controls, private-note/attachment isolation, portal isolation and negative tests.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Scope is organization-first, then company/branch/team/queue/customer/record as configured. Cross-company or shared-service access requires explicit policy and cannot be inferred from guessed IDs.

## [SPEC-AUDIT] Auditability and history
Record actor/channel/time/reason, before/after or event payload, request/correlation/idempotency IDs, assignment/SLA/merge/reopen/entitlement references and admin overrides. Audit data is tamper-resistant and permission-controlled.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Use row/version locks or optimistic version checks for assignment, status, SLA, merge/reopen and sensitive collaboration. Customer reply versus close/reassign is resolved deterministically without lost messages.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
`F353-INT-002`/API contracts use stable source/idempotency keys for email/webhook intake, notifications, escalations, merge/reopen, CSAT and cross-module effects. Retries return prior result or reconcile; they never duplicate business effects.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
`F353-INT-001..002` define source owner/state, public command/query, auth, payload, idempotency, transaction boundary, failure/retry, reversal/reconciliation and audit for cross-module/external handoffs.

## [SPEC-API] Commands, queries and API contracts
`F353-API-001` defines command/query schemas, errors, pagination/filter/sort, authorization, concurrency/idempotency and audit/outbox effects. Portal APIs use customer-scoped resource authorization, not internal staff permissions alone.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Agent mobile/tablet supports triage, assignment, reply, internal note, attachment, status and SLA context where safe. Customer mobile portal supports ticket create/reply/attachments/status/knowledge. Offline writes are restricted to explicitly reconcilable actions.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop prioritizes dense queues/timeline/context; tablet supports split-view or stacked triage; phone uses cards and progressive disclosure with primary safe actions always reachable. Tables have non-table alternatives.

## [SPEC-ACCESSIBILITY] Accessibility contract
WCAG 2.2 AA intent: semantic regions/headings, labelled controls, keyboard triage, logical focus, screen-reader status/SLA announcements, accessible errors, target size, contrast, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Pass 10 wireframe pack under `docs/11-visual-assets/wireframes/SUPPORT_PASS10_WORKSPACES.md` covers agent queue, ticket 360, SLA supervisor, knowledge, portal and mobile states.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
`F353-PERF-001..002` define ticket/search/queue latency budgets, server pagination, indexes, async thresholds and 0/1/100/10k/1m-record behavior where relevant.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
`F353-OBS-001..002` define structured logs/metrics/traces for ingestion, routing, SLA timers, escalation, notification, attachment scan, portal authorization and reconciliation without logging sensitive content.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover empty/stale/deleted references, duplicate emails/webhooks, simultaneous edits/assignment, customer reply during close/reassign, SLA pause/resume races, repeated jobs, merge chains, reopen windows, attachment-processing failures, permission changes, DST/timezones and recovery.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Verified current-code evidence `SUPPORT-P10-CE-011` at `database/tenant/migrations/050_support_module.sql`. This proves only the observed foundation; target requirements remain authoritative.

## [SPEC-GAPS] Exact gap analysis
Current foundations are mapped against the enterprise target. Any missing threading, SLA calendar, routing, private visibility, attachment security, merge/reopen, portal, entitlement, analytics, mobile or cross-module behavior remains an implementation gap rather than being silently removed.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Likely implementation areas: `database/tenant`, `services/api/src/modules/support`, orchestration/public contracts, `apps/web/src/modules/support`, Support API routes, SDK/types/permissions, worker handlers, email ingestion, portal surfaces and tests. No product code is written by Pass 10.

## [SPEC-TESTS] Automated test plan
Automated plan includes domain/state/SLA-calendar tests, database/RLS, authorization-negative/IDOR, API/threading/idempotency, private-note leakage, assignment/merge/reopen race tests, attachment fault injection, cross-module reconciliation, search/performance and migration tests.

## [SPEC-E2E] Browser and critical-journey E2E
`F353-E2E-001..002` cover happy, failure/retry/concurrency, permission/private-content and cross-module outcomes on relevant desktop/tablet/phone surfaces.

## [SPEC-UAT] Human UAT plan
`F353-UAT-001..002` define exact role, prerequisites, steps and visible/data/audit/downstream evidence including recovery/reconciliation where applicable.

## [SPEC-DOD] Objective Definition of Done
Email-to-ticket is done only when its approved requirements, server authorization, legal state transitions, retry/concurrency behavior, audit evidence, cross-module effects, responsive/accessibility behavior and automated/E2E/UAT evidence pass. A page/table/API alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder blocks specification readiness. Product implementation/readiness remains explicitly uncertified and may reveal implementation decisions that must be recorded without changing canonical identity.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F353-SEM-01` — **Ticket/case lifecycle and canonical identity**: Define creation, queue/assignment, response, pending/resolved/closed/reopened/merged states and canonical ticket identity.
- `F353-SEM-02` — **Customer/contact/message/note/attachment/SLA history**: Store threading identifiers, public/private content, attachments, SLA clocks, entitlement links and immutable history.
- `F353-SEM-03` — **Routing, priority, SLA, entitlement and merge/reopen rules**: Define business calendars, pause/resume, deterministic routing, escalation, warranty/entitlement and duplicate merge semantics.
- `F353-SEM-04` — **Agent/queue/portal visibility and private-note isolation**: Prevent IDOR and private-note leakage; enforce customer portal isolation, attachment permissions and privileged overrides.
- `F353-SEM-05` — **Agent triage/customer portal/knowledge workflow**: Cover queues, keyboard triage, replies/notes, KB/canned responses, portal, mobile, saved views, bulk actions and accessibility.
- `F353-SEM-06` — **Email/customer/order/product/asset/quality contracts**: Thread inbound email idempotently and link external/module context via public read/contracts without duplicating source truth.
- `F353-SEM-07` — **Duplicate inbound, assignment race, reply-vs-close and notification retry**: Handle message replay/loops, simultaneous edits, merge races, reopen/close conflicts, bounce/failure and exception queues.
- `F353-SEM-08` — **Threading/SLA/privacy/idempotency verification**: Require email replay, private-note leakage, portal IDOR, SLA calendar, race tests, E2E and UAT.

Cross-module context: **CRM;Sales;Assets;Quality**.
Shared-platform dependencies: `SP008;SP009;SP014;SP015;SP016;SP017;SP018;SP019;SP020;SP024;SP030;SP033;SP036`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F353-PFC-01`, `F353-PFC-02`, `F353-PFC-03`, `F353-PFC-04`, `F353-PFC-05`, `F353-PFC-06`, `F353-PFC-07`, `F353-PFC-08`, `F353-PFC-09`, `F353-PFC-10`
- State transition IDs: `F353-STM-01`, `F353-STM-02`, `F353-STM-03`, `F353-STM-04`, `F353-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->
