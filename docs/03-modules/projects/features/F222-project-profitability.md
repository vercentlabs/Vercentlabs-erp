# F222 — Project profitability

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F222`
- Canonical name: **Project profitability**
- Module: **Projects**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `PRJ-CAP-005`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Provide live profitability from reconciled revenue and cost sources with as-of semantics, margin formulas, commitments/forecast context and drilldown.

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
- `PRJ-P6-BE-059` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `PRJ-P6-BE-060` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: mature work planning, resource, actual cost/revenue, billing, collaboration and reporting controls.
- `DIFFERENTIATOR`: one integrated project-to-cash control plane without copying vendor-specific object names.
- `NOT_APPLICABLE`: vendor licensing/object names and functionality outside canonical scope.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered hierarchy/dependency cycles, baselines, calendars, resource overallocation, approvals, locks/reopen, commitments/actuals, billing duplication, FX/tax handoff, project close/reopen, audit, responsive/mobile UX, collaboration visibility, reconciliation and scale behavior expected for **Project profitability**. No material expectation is silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F222-CAP-001` — Project profitability MUST provide live profitability from reconciled revenue and cost sources with as-of semantics, margin formulas, commitments/forecast context and drilldown.
- `F222-CAP-002` — Project profitability MUST cover lifecycle, permissions, approvals, schedule/baseline semantics, concurrency, retry/reversal, audit, reporting, responsive UX and scale; the canonical title is a traceability anchor, not the whole capability.
- `F222-CAP-003` — Project profitability MUST preserve Projects ownership of project delivery state while Sales, Procurement, Stock, HR/Payroll and Accounting effects use public contracts rather than private-table mutation.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F222-FR-001` — The system MUST provide a server-backed Project profitability workflow covering success, validation, permission, dependency/capacity, billing/period, conflict, downstream failure, retry/reversal and audit states.
- `F222-FR-002` — Every material Project profitability action MUST preserve actor, effective/posting time, reason, source project/WBS/task/baseline/contract, prior/new state or immutable event, and downstream lineage.
- `F222-FR-003` — Project profitability MUST remain usable at enterprise project/task/time/financial volumes using bounded queries, pagination/virtualization, async jobs and stable transitions where appropriate.
- `F222-US-001` — As an authorized project manager/controller/team member, I can perform Project profitability with the exact work, schedule, resource, customer and financial context needed for my role.
- `F222-US-002` — As a PMO/resource/finance approver, I can review exceptions, provenance, approvals, variances, history and reconciliation for Project profitability within permitted company/project/team scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F222-FLOW-001` — The governed lifecycle for Project profitability MUST follow ACTIVE/VALID -> controlled update/closure; historical delivery and financial facts remain reproducible with explicit guards and no silent historical rewrite.
- `F222-FLOW-002` — Validation, permission, dependency/capacity, concurrent update, billing eligibility, period lock and downstream failures for Project profitability MUST be actionable and safely retryable without duplicate cost, time, stock, procurement or invoice effects.

Lifecycle reference: `ACTIVE/VALID -> controlled update/closure; historical delivery and financial facts remain reproducible`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Projects domain service for **Project profitability**.
- Lifecycle: `ACTIVE/VALID -> controlled update/closure; historical delivery and financial facts remain reproducible`.
- Transitions require current state/version, authorization, applicable dependency/resource/billing/period guards.
- Approved/posted facts are corrected through controlled revision/reversal, not silent rewrite.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F222-DATA-001` — The Project profitability model MUST define organization/company/branch, project/customer/order, WBS/task/milestone/resource, currency/rate/budget/billing and source-document dimensions as applicable, with stable keys, constraints, indexes, retention and lineage.
- `F222-DATA-002` — Dates, durations, effort, quantity/UOM, currency/FX, cost/bill rates, baseline/version, approval and source values that determine historical Project profitability interpretation MUST remain reproducible after master/configuration changes.

## [SPEC-VALIDATION] Validation rules
- `F222-VAL-001` — All Project profitability commands MUST validate tenant/company/project scope, lifecycle, date/range/precision, hierarchy/dependency integrity, resource/financial eligibility and cross-reference integrity server-side.
- `F222-VAL-002` — Project profitability failures MUST expose stable domain error codes and corrective guidance without leaking unauthorized customer, employee, cost/rate, margin, document or cross-project data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F222-BR-001` — The Projects domain command responsible for Project profitability is authoritative for project delivery rules; UI, API, import, automation and AI paths MUST reuse the same deterministic invariant checks.
- `F222-BR-002` — Project profitability MUST preserve approved baselines, source links and snapshotted rates/eligibility inputs needed to reproduce historical schedule, cost, revenue and billing outcomes after configuration changes.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F222-CALC-001` — All scheduling, allocation, roll-up, progress, budget/cost/revenue, billing, FX, margin, ETC/EAC/VAC or variance calculations applicable to Project profitability MUST use deterministic decimal/date/calendar rules, explicit rounding and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F222-UX-001` — The Project profitability workspace MUST expose identity, lifecycle, WBS/task/resource/customer context, schedule, financial facts as permitted, exceptions, related records and history in one coherent Projects shell.
- `F222-UX-002` — Desktop/tablet/phone views for Project profitability MUST define loading, empty, validation, permission, dependency/overallocation, stale/conflict, offline/retry, destructive confirmation and success states.
- `F222-UX-003` — Planning-heavy Project profitability interactions MUST support keyboard/touch operation, non-drag alternatives, visible focus, non-color status cues, screen-reader semantics and dense-view alternatives.

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
- `F222-AUTO-001` — Automation MAY create proposals/work for Project profitability only through idempotent Projects/public commands; it MUST NOT directly mutate source ledgers, stock balances, payroll, customer invoices or accounting entries.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F222-APP-001` — Where policy requires approval for budgets, time/expenses, billing, project closure/reopen, high-risk changes or Project profitability, approval MUST bind to the exact version/state/value and prohibit self-approval where configured.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F222-NOTIF-001` — Notifications for Project profitability MUST be event-driven, deduplicated, preference/permission aware and deep-link to the exact task, approval, risk, overrun or billing item without exposing restricted data.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/generated documents define file type/size/security scanning, version/retention, project/task linkage, preview/download permissions, generated invoice/report provenance and audit.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Import/export defines mapping, preview/dry-run, hierarchy/source resolution, duplicates, row-level errors, background-job thresholds, resumability, permission-safe exports and audit; migrations preserve stable source IDs.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F222-REP-001` — Reports/KPIs for Project profitability MUST define grain, filters, baseline/as-of/freshness semantics, drilldown and reconciliation to authoritative project, Sales, Procurement, Stock, HR and Accounting records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F222-AI-001` — AI for Project profitability is limited to assist/recommend/generate workflows with provenance, freshness, uncertainty, explanation and permission filtering; AI MUST NOT be authoritative for authorization, schedule legality, approval, billable eligibility, project accounting, invoice or source-ledger truth.

## [SPEC-SECURITY] Security, permissions and field controls
- `F222-SEC-001` — Every Project profitability query and mutation MUST enforce authentication, module entitlement, organization/company/project/team/record scope, action permission and server-side field visibility.
- `F222-SEC-002` — Customer contracts, employee allocations/time, costs/rates/margin, approvals and restricted documents/comments in Project profitability MUST be field/action restricted and protected against IDOR, aggregate leakage and unauthorized export.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Scope is organization -> company -> project -> team/role/record, with explicit customer/internal visibility and finance/document field controls. Cross-company aggregation requires elevated permission and never leaks unauthorized detail through totals.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time/reason, before/after or immutable event, correlation/idempotency IDs, approval/baseline/reversal/invoice links and retention for project, schedule, resource, time/expense, budget, billing, risk and collaboration changes.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Use optimistic versions/expected state for collaborative edits and approvals; hierarchy/dependency, allocation, budget, billing and close/reopen mutations define atomicity, stale-write errors, retry policy and visible conflict recovery.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible billing/procurement/stock/accounting effects require source-scoped idempotency keys. Replay returns prior outcome or safe no-op; retries cannot duplicate invoices, material cost, procurement links, time approvals or financial effects.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F222-INT-001` — Inbound cross-module requests affecting Project profitability MUST call a versioned Projects public command with authorization, idempotency/source reference, validation and explicit success/failure result.
- `F222-INT-002` — Outbound effects from Project profitability MUST use public commands/events/orchestration with retry, reversal/compensation and reconciliation; Projects MUST NOT mutate another module’s private tables.

## [SPEC-API] Commands, queries and API contracts
- `F222-API-001` — Project profitability mutation APIs MUST define request schema, authorization, idempotency, expected state/version, stable errors, audit/outbox effects and compatibility semantics.
- `F222-API-002` — Project profitability query APIs MUST define project/WBS/resource/financial grain, pagination/filter/sort, as-of/baseline semantics, authorization-safe aggregates and stable responses.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Mobile prioritizes assigned work, task updates, time/expense capture, approvals, issues/risks and project status. Offline write boundaries are explicit; queued mutations show pending/retry/conflict and never pretend downstream billing/accounting succeeded.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop supports dense WBS/Gantt/financial workbenches; tablet reflows to split-pane/cards; phone uses guided cards and summarized finance. Critical actions remain available without horizontal-table dependency.

## [SPEC-ACCESSIBILITY] Accessibility contract
WCAG 2.2 AA intent: semantic headings/tables/trees, keyboard operation, focus management, accessible drag alternatives, screen-reader labels/status announcements, target sizing, contrast, reduced motion and inline/error summaries.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/PROJECTS_PASS6_WORKSPACES.md` for desktop/tablet/phone project 360, WBS/Gantt, task board, resource plan, timesheet, financial cockpit and risk/report states.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F222-PERF-001` — Project profitability MUST define performance envelopes for 0/1/100/10k/1m project tasks, time entries, cost lines or reporting facts as applicable, with bounded synchronous work and explicit async thresholds.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F222-OBS-001` — Project profitability MUST emit structured logs/metrics/traces for failures, retries, lock contention, schedule recalculation/job lag, approval/billing drift and reconciliation using correlation IDs.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover zero/huge projects, deep WBS, dependency cycles, DST/holiday calendars, split allocations, overlapping time, negative/zero billing, partial invoices, FX changes, deleted users/customers, permission changes, late actuals, locked periods, stale baselines, duplicate retries, archived projects and downstream outages.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- `PRJ-P6-CODE-030` — verified current-code evidence: `services/api/src/modules/projects/index.js`.
- Evidence is a foundation/implementation observation only; it does not certify the target requirement set.

## [SPEC-GAPS] Exact gap analysis
Current code has meaningful project foundations, but enterprise completeness remains unverified for several capabilities including templates, deep WBS/dependency scheduling, rich Gantt/Kanban/calendar, capacity planning, materials, issues/risks/documents/collaboration, billing variants, reconciliation depth, mobile/offline and broad negative/security/E2E coverage. Exact implementation gaps are target requirements minus verified evidence.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Later implementation should sequence shared project data/security -> WBS/scheduling/resources -> time/expense/material/procurement -> budgets/cost/revenue -> billing/invoices/profitability -> risks/collaboration -> dashboards/reports/mobile -> cross-module certification. This pass writes no product source.

## [SPEC-TESTS] Automated test plan
Automated plan includes unit/domain hierarchy and billing rules; DB constraints/RLS; authorization-negative/IDOR; schedule/resource/budget property tests; API contracts; idempotency/concurrency; cross-module reconciliation; migrations/import; performance and failure-injection tests.

## [SPEC-E2E] Browser and critical-journey E2E
- `F222-E2E-001` — E2E MUST prove an authorized persona can complete the primary Project profitability journey and observe correct schedule/resource/state/history and downstream effects.
- `F222-E2E-002` — E2E MUST cover unauthorized access, stale/concurrent/replayed action and at least one relevant dependency, allocation conflict, rejection, partial billing, reversal, close/reopen or reconciliation path for Project profitability.

## [SPEC-UAT] Human UAT plan
- `F222-UAT-001` — A real project manager/controller/team member MUST execute the primary Project profitability job with realistic data on appropriate desktop/tablet/mobile form factors, capturing visible and data evidence.
- `F222-UAT-002` — A PMO/resource manager plus relevant Sales/Procurement/Stock/HR/Finance persona MUST verify permissions, exceptions, reversal/reconciliation, audit and cross-module outcomes for Project profitability.

## [SPEC-DOD] Objective Definition of Done
**Project profitability is done only when** all approved requirements are implemented through normal authorized commands, required responsive/accessibility states exist, audit/retry/reversal/reconciliation behavior is proven, automated/E2E/UAT evidence passes and parent capability/journey gates pass. A table/API/page alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder blocks `SPECIFICATION_READY`. Implementation-time product choices (for example exact visual density or optional scheduling heuristics) must stay within the approved invariants and be recorded through change control.
