# F230 — Project reports

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F230`
- Canonical name: **Project reports**
- Module: **Projects**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `PRJ-CAP-007`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Provide reconciled project reports for portfolio/status, schedule, resource, timesheet, expense, procurement, budget, cost, revenue, billing, profitability, variance, risks/issues and audit.

**Non-goal:** specification readiness does not certify current implementation, and Projects does not take private-state ownership from Sales, Procurement, Stock, HR/Payroll or Accounting.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Delivery outcome: project work, schedule, resources and progress remain coherent and explainable.
- Control outcome: approvals, billing eligibility and close/reopen rules cannot be bypassed.
- Financial outcome: project costs/revenue/profitability reconcile to authoritative sources.
- Readiness outcome: specification is independently gated from implementation/product readiness.

## [SPEC-PERSONAS] Personas and jobs to be done
- Project manager owns plan, delivery and exceptions.
- Team member executes tasks and submits time/expenses.
- Resource manager/PMO owns capacity and portfolio controls.
- Project controller/billing/finance validates budgets, actuals, invoices and profitability.
- Negative case: unauthorized users cannot infer customer contracts, employee allocation/time, rates, margin or restricted documents/comments.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
- Projects dashboard, portfolio/project list, project 360, WBS/Gantt/Kanban/calendar, resource/capacity, time/expense, budget/cost/billing/profitability, risks/issues and reports.
- Global search/command palette and durable deep links.
- Contextual entry from Sales order/customer, Procurement, Stock material movements, HR resources/time and Accounting invoice/reconciliation where authorized.

## [SPEC-BENCHMARK] Benchmark research evidence
- `PRJ-P6-BE-075` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `PRJ-P6-BE-076` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: mature work planning, resource, actual cost/revenue, billing, collaboration and reporting controls.
- `DIFFERENTIATOR`: one integrated project-to-cash control plane without copying vendor-specific object names.
- `NOT_APPLICABLE`: vendor licensing/object names and functionality outside canonical scope.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered hierarchy/dependency cycles, baselines, calendars, resource overallocation, approvals, locks/reopen, commitments/actuals, billing duplication, FX/tax handoff, project close/reopen, audit, responsive/mobile UX, collaboration visibility, reconciliation and scale behavior expected for **Project reports**. No material expectation is silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F230-CAP-001` — Project reports MUST provide reconciled project reports for portfolio/status, schedule, resource, timesheet, expense, procurement, budget, cost, revenue, billing, profitability, variance, risks/issues and audit.
- `F230-CAP-002` — Project reports MUST cover lifecycle, permissions, approvals, schedule/baseline semantics, concurrency, retry/reversal, audit, reporting, responsive UX and scale; the canonical title is a traceability anchor, not the whole capability.
- `F230-CAP-003` — Project reports MUST preserve Projects ownership of project delivery state while Sales, Procurement, Stock, HR/Payroll and Accounting effects use public contracts rather than private-table mutation.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F230-FR-001` — The system MUST provide a server-backed Project reports workflow covering success, validation, permission, dependency/capacity, billing/period, conflict, downstream failure, retry/reversal and audit states.
- `F230-FR-002` — Every material Project reports action MUST preserve actor, effective/posting time, reason, source project/WBS/task/baseline/contract, prior/new state or immutable event, and downstream lineage.
- `F230-FR-003` — Project reports MUST remain usable at enterprise project/task/time/financial volumes using bounded queries, pagination/virtualization, async jobs and stable transitions where appropriate.
- `F230-US-001` — As an authorized project manager/controller/team member, I can perform Project reports with the exact work, schedule, resource, customer and financial context needed for my role.
- `F230-US-002` — As a PMO/resource/finance approver, I can review exceptions, provenance, approvals, variances, history and reconciliation for Project reports within permitted company/project/team scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F230-FLOW-001` — The governed lifecycle for Project reports MUST follow ACTIVE/VALID -> controlled update/closure; historical delivery and financial facts remain reproducible with explicit guards and no silent historical rewrite.
- `F230-FLOW-002` — Validation, permission, dependency/capacity, concurrent update, billing eligibility, period lock and downstream failures for Project reports MUST be actionable and safely retryable without duplicate cost, time, stock, procurement or invoice effects.

Lifecycle reference: `ACTIVE/VALID -> controlled update/closure; historical delivery and financial facts remain reproducible`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Projects domain service for **Project reports**.
- Lifecycle: `ACTIVE/VALID -> controlled update/closure; historical delivery and financial facts remain reproducible`.
- Transitions require current state/version, authorization, applicable dependency/resource/billing/period guards.
- Approved/posted facts are corrected through controlled revision/reversal, not silent rewrite.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F230-DATA-001` — The Project reports model MUST define organization/company/branch, project/customer/order, WBS/task/milestone/resource, currency/rate/budget/billing and source-document dimensions as applicable, with stable keys, constraints, indexes, retention and lineage.
- `F230-DATA-002` — Dates, durations, effort, quantity/UOM, currency/FX, cost/bill rates, baseline/version, approval and source values that determine historical Project reports interpretation MUST remain reproducible after master/configuration changes.

## [SPEC-VALIDATION] Validation rules
- `F230-VAL-001` — All Project reports commands MUST validate tenant/company/project scope, lifecycle, date/range/precision, hierarchy/dependency integrity, resource/financial eligibility and cross-reference integrity server-side.
- `F230-VAL-002` — Project reports failures MUST expose stable domain error codes and corrective guidance without leaking unauthorized customer, employee, cost/rate, margin, document or cross-project data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F230-BR-001` — The Projects domain command responsible for Project reports is authoritative for project delivery rules; UI, API, import, automation and AI paths MUST reuse the same deterministic invariant checks.
- `F230-BR-002` — Project reports MUST preserve approved baselines, source links and snapshotted rates/eligibility inputs needed to reproduce historical schedule, cost, revenue and billing outcomes after configuration changes.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F230-CALC-001` — All scheduling, allocation, roll-up, progress, budget/cost/revenue, billing, FX, margin, ETC/EAC/VAC or variance calculations applicable to Project reports MUST use deterministic decimal/date/calendar rules, explicit rounding and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F230-UX-001` — The Project reports workspace MUST expose identity, lifecycle, WBS/task/resource/customer context, schedule, financial facts as permitted, exceptions, related records and history in one coherent Projects shell.
- `F230-UX-002` — Desktop/tablet/phone views for Project reports MUST define loading, empty, validation, permission, dependency/overallocation, stale/conflict, offline/retry, destructive confirmation and success states.
- `F230-UX-003` — Planning-heavy Project reports interactions MUST support keyboard/touch operation, non-drag alternatives, visible focus, non-color status cues, screen-reader semantics and dense-view alternatives.

Use the appropriate archetype: portfolio/list, project 360, WBS tree, Gantt, Kanban, calendar, resource heatmap, weekly timesheet, budget/cost ledger, billing queue, profitability dashboard, risk/issue register or report.

## [SPEC-LIST] List, table and work-queue behavior
Lists/work queues define server pagination/sorting, personalized columns/density, permission-safe counts, bulk eligibility, row actions and virtualization/async thresholds.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search defines project/customer/WBS/task/resource/milestone/status/date/budget/billing/risk fields, stable filters/facets/sorts, saved views and authorization-safe counts.

## [SPEC-DETAIL] Detail / 360 workspace
The 360 keeps identity, customer/commercial source, lifecycle, plan/progress, team, time/expenses/material/procurement, budget/cost/revenue/billing, risks/issues/documents/comments and audit history together with permission-based sections.

## [SPEC-CREATE] Create and quick-create UX
Create/quick-create defines required/default fields, template or source-record selection, duplicate/numbering rules, validation summary and post-create navigation; quick create cannot bypass full server invariants.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Editing distinguishes mutable plans from approved/posted historical facts. Baseline, approved time/expense, invoiced eligibility, source IDs and audit facts require governed revision/reopen/reversal rather than silent inline edit.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk actions show eligibility before mutation, operate through per-record authorization/domain commands, support partial-result reporting and never bypass approvals or lifecycle rules.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary/contextual/destructive actions are permission/state aware; complete/close/reopen, approve/reject, invoice, delete/archive and schedule-changing actions require confirmation/reason/evidence as policy dictates.

## [SPEC-RELATED] Related records and contextual navigation
Related navigation uses public IDs/contracts to customer/order, procurement documents, Stock movements, HR resources, accounting invoices/ledger and project children without private cross-module writes.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F230-AUTO-001` — Automation MAY create proposals/work for Project reports only through idempotent Projects/public commands; it MUST NOT directly mutate source ledgers, stock balances, payroll, customer invoices or accounting entries.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F230-APP-001` — Where policy requires approval for budgets, time/expenses, billing, project closure/reopen, high-risk changes or Project reports, approval MUST bind to the exact version/state/value and prohibit self-approval where configured.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F230-NOTIF-001` — Notifications for Project reports MUST be event-driven, deduplicated, preference/permission aware and deep-link to the exact task, approval, risk, overrun or billing item without exposing restricted data.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/generated documents define file type/size/security scanning, version/retention, project/task linkage, preview/download permissions, generated invoice/report provenance and audit.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Import/export defines mapping, preview/dry-run, hierarchy/source resolution, duplicates, row-level errors, background-job thresholds, resumability, permission-safe exports and audit; migrations preserve stable source IDs.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F230-REP-001` — Reports/KPIs for Project reports MUST define grain, filters, baseline/as-of/freshness semantics, drilldown and reconciliation to authoritative project, Sales, Procurement, Stock, HR and Accounting records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F230-AI-001` — AI for Project reports is limited to assist/recommend/generate workflows with provenance, freshness, uncertainty, explanation and permission filtering; AI MUST NOT be authoritative for authorization, schedule legality, approval, billable eligibility, project accounting, invoice or source-ledger truth.

## [SPEC-SECURITY] Security, permissions and field controls
- `F230-SEC-001` — Every Project reports query and mutation MUST enforce authentication, module entitlement, organization/company/project/team/record scope, action permission and server-side field visibility.
- `F230-SEC-002` — Customer contracts, employee allocations/time, costs/rates/margin, approvals and restricted documents/comments in Project reports MUST be field/action restricted and protected against IDOR, aggregate leakage and unauthorized export.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Scope is organization -> company -> project -> team/role/record, with explicit customer/internal visibility and finance/document field controls. Cross-company aggregation requires elevated permission and never leaks unauthorized detail through totals.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time/reason, before/after or immutable event, correlation/idempotency IDs, approval/baseline/reversal/invoice links and retention for project, schedule, resource, time/expense, budget, billing, risk and collaboration changes.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Use optimistic versions/expected state for collaborative edits and approvals; hierarchy/dependency, allocation, budget, billing and close/reopen mutations define atomicity, stale-write errors, retry policy and visible conflict recovery.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible billing/procurement/stock/accounting effects require source-scoped idempotency keys. Replay returns prior outcome or safe no-op; retries cannot duplicate invoices, material cost, procurement links, time approvals or financial effects.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F230-INT-001` — Inbound cross-module requests affecting Project reports MUST call a versioned Projects public command with authorization, idempotency/source reference, validation and explicit success/failure result.
- `F230-INT-002` — Outbound effects from Project reports MUST use public commands/events/orchestration with retry, reversal/compensation and reconciliation; Projects MUST NOT mutate another module’s private tables.

## [SPEC-API] Commands, queries and API contracts
- `F230-API-001` — Project reports mutation APIs MUST define request schema, authorization, idempotency, expected state/version, stable errors, audit/outbox effects and compatibility semantics.
- `F230-API-002` — Project reports query APIs MUST define project/WBS/resource/financial grain, pagination/filter/sort, as-of/baseline semantics, authorization-safe aggregates and stable responses.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Mobile prioritizes assigned work, task updates, time/expense capture, approvals, issues/risks and project status. Offline write boundaries are explicit; queued mutations show pending/retry/conflict and never pretend downstream billing/accounting succeeded.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop supports dense WBS/Gantt/financial workbenches; tablet reflows to split-pane/cards; phone uses guided cards and summarized finance. Critical actions remain available without horizontal-table dependency.

## [SPEC-ACCESSIBILITY] Accessibility contract
WCAG 2.2 AA intent: semantic headings/tables/trees, keyboard operation, focus management, accessible drag alternatives, screen-reader labels/status announcements, target sizing, contrast, reduced motion and inline/error summaries.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/PROJECTS_PASS6_WORKSPACES.md` for desktop/tablet/phone project 360, WBS/Gantt, task board, resource plan, timesheet, financial cockpit and risk/report states.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F230-PERF-001` — Project reports MUST define performance envelopes for 0/1/100/10k/1m project tasks, time entries, cost lines or reporting facts as applicable, with bounded synchronous work and explicit async thresholds.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F230-OBS-001` — Project reports MUST emit structured logs/metrics/traces for failures, retries, lock contention, schedule recalculation/job lag, approval/billing drift and reconciliation using correlation IDs.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover zero/huge projects, deep WBS, dependency cycles, DST/holiday calendars, split allocations, overlapping time, negative/zero billing, partial invoices, FX changes, deleted users/customers, permission changes, late actuals, locked periods, stale baselines, duplicate retries, archived projects and downstream outages.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- `PRJ-P6-CODE-038` — verified current-code evidence: `apps/web/src/app/api/projects/dashboard/route.ts`.
- Evidence is a foundation/implementation observation only; it does not certify the target requirement set.

## [SPEC-GAPS] Exact gap analysis
Current code has meaningful project foundations, but enterprise completeness remains unverified for several capabilities including templates, deep WBS/dependency scheduling, rich Gantt/Kanban/calendar, capacity planning, materials, issues/risks/documents/collaboration, billing variants, reconciliation depth, mobile/offline and broad negative/security/E2E coverage. Exact implementation gaps are target requirements minus verified evidence.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Later implementation should sequence shared project data/security -> WBS/scheduling/resources -> time/expense/material/procurement -> budgets/cost/revenue -> billing/invoices/profitability -> risks/collaboration -> dashboards/reports/mobile -> cross-module certification. This pass writes no product source.

## [SPEC-TESTS] Automated test plan
Automated plan includes unit/domain hierarchy and billing rules; DB constraints/RLS; authorization-negative/IDOR; schedule/resource/budget property tests; API contracts; idempotency/concurrency; cross-module reconciliation; migrations/import; performance and failure-injection tests.

## [SPEC-E2E] Browser and critical-journey E2E
- `F230-E2E-001` — E2E MUST prove an authorized persona can complete the primary Project reports journey and observe correct schedule/resource/state/history and downstream effects.
- `F230-E2E-002` — E2E MUST cover unauthorized access, stale/concurrent/replayed action and at least one relevant dependency, allocation conflict, rejection, partial billing, reversal, close/reopen or reconciliation path for Project reports.

## [SPEC-UAT] Human UAT plan
- `F230-UAT-001` — A real project manager/controller/team member MUST execute the primary Project reports job with realistic data on appropriate desktop/tablet/mobile form factors, capturing visible and data evidence.
- `F230-UAT-002` — A PMO/resource manager plus relevant Sales/Procurement/Stock/HR/Finance persona MUST verify permissions, exceptions, reversal/reconciliation, audit and cross-module outcomes for Project reports.

## [SPEC-DOD] Objective Definition of Done
**Project reports is done only when** all approved requirements are implemented through normal authorized commands, required responsive/accessibility states exist, audit/retry/reversal/reconciliation behavior is proven, automated/E2E/UAT evidence passes and parent capability/journey gates pass. A table/API/page alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder blocks `SPECIFICATION_READY`. Implementation-time product choices (for example exact visual density or optional scheduling heuristics) must stay within the approved invariants and be recorded through change control.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F230-SEM-01` — **Metric/report purpose, audience and decision contract**: Define the exact business questions, owners, refresh expectations, scope and prohibited interpretations.
- `F230-SEM-02` — **Metric definitions, dimensions, lineage and snapshot model**: Freeze numerator/denominator, dimensions, filters, source tables/read models, effective dates and historical snapshots.
- `F230-SEM-03` — **Aggregation, period, currency/UOM and reconciliation rules**: Define inclusion/exclusion, period boundaries, currency/UOM conversion, rounding, null handling and reconciliation to source truth.
- `F230-SEM-04` — **Row/field/metric authorization and aggregation safety**: Prevent inference/leakage through counts, exports or drilldowns; enforce company/team/record and sensitive-metric scope.
- `F230-SEM-05` — **Dashboard/report/filter/drilldown/export experience**: Cover saved views, filters, sorting, drilldowns, chart/table parity, accessible alternatives, export and responsive layouts.
- `F230-SEM-06` — **Read-model refresh and authoritative-source contract**: Define event/batch refresh, freshness indicator, stale/error behavior and no mutation of operational truth from reports.
- `F230-SEM-07` — **Late data, stale snapshot, partial refresh and reconciliation exception**: Handle source delay, rebuild, duplicate events, broken dimensions, restatement and visible confidence/freshness.
- `F230-SEM-08` — **Metric golden, authorization and reconciliation verification**: Require known-dataset goldens, permission-safe aggregates, refresh/rebuild tests, source reconciliation, E2E and UAT.

Cross-module context: **Sales;Procurement;Stock / Inventory;HR & Payroll;Accounting / Finance;Assets**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP017;SP019;SP024;SP030;SP031;SP033;SP034`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F230-PFC-01`, `F230-PFC-02`, `F230-PFC-03`, `F230-PFC-04`, `F230-PFC-05`, `F230-PFC-06`, `F230-PFC-07`, `F230-PFC-08`, `F230-PFC-09`, `F230-PFC-10`
- State transition IDs: `F230-STM-01`, `F230-STM-02`, `F230-STM-03`, `F230-STM-04`, `F230-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F230-1`; `PFD-BM-F230-2`
- The Pass D mappings are the implementation-planning benchmark authority for **Project reports**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
