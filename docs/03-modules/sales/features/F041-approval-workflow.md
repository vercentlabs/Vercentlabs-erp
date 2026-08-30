# F041 — Approval workflow

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F041`
- Canonical name: **Approval workflow**
- Module: **Sales**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `SALES-CAP-002`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Route commercial exceptions through maker-checker approval with thresholds, segregation of duties, delegation and immutable decisions.

**Primary operator outcome:** authorized users can route commercial exceptions through maker-checker approval with thresholds, segregation of duties, delegation and immutable decisions.

**Non-goal:** this specification does not certify current implementation or transfer another module's private-state ownership into Sales.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Business: Route commercial exceptions through maker-checker approval with thresholds, segregation of duties, delegation and immutable decisions.
- Control: deterministic, permission-safe business effects with visible failure/recovery.
- Data: historical commitments remain reproducible after configuration/master changes.
- Readiness: specification may be ready while product readiness remains separately gated.

## [SPEC-PERSONAS] Personas and jobs to be done
- Sales representative / sales operations: execute high-frequency commercial work.
- Sales manager / approver: govern exceptions and performance.
- Finance, warehouse, procurement or CRM personas participate only through explicit cross-module journeys.
- Negative case: users without cost/margin/credit/approval permission cannot infer restricted values through any surface.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
- Sales module navigation and role-specific work queue.
- Authorization-safe global search / command palette.
- Customer/document 360 and durable deep links.
- Contextual creation from upstream records where permitted.

## [SPEC-BENCHMARK] Benchmark research evidence
- `SALES-P2-BE-021` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `SALES-P2-BE-022` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: generally expected enterprise behavior needed for commercial integrity/control.
- `DIFFERENTIATOR`: preserve one coherent Vercentlabs modular experience instead of cloning vendor-specific UI/object models.
- `NOT_APPLICABLE`: vendor-specific licensing, proprietary object names and unrelated suite behavior are excluded.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **multi-stage rules, discount/margin/credit thresholds, segregation of duties, delegation, escalation, resubmission and stale approvals**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F041-CAP-001` — The Approval workflow capability MUST let authorized Sales users route commercial exceptions through maker-checker approval with thresholds, segregation of duties, delegation and immutable decisions.
- `F041-CAP-002` — The capability MUST explicitly cover multi-stage rules, discount/margin/credit thresholds, segregation of duties, delegation, escalation, resubmission and stale approvals; the short canonical feature title is a traceability anchor, not complete scope.
- `F041-CAP-003` — Approval workflow MUST preserve Sales ownership boundaries and use public contracts/orchestration for CRM, Stock, Procurement or Accounting effects.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F041-FR-001` — The system MUST provide a complete server-backed workflow to route commercial exceptions through maker-checker approval with thresholds, segregation of duties, delegation and immutable decisions, including success, empty, failure, permission and stale/conflict states.
- `F041-FR-002` — Every material Approval workflow mutation MUST preserve actor, timestamp, prior/new state or immutable version, reason where required and durable lineage.
- `F041-FR-003` — Approval workflow MUST remain usable at enterprise list/document volumes through stable pagination/sorting, background jobs or virtualization where appropriate.
- `F041-US-001` — As an authorized Sales operator, I can route commercial exceptions through maker-checker approval with thresholds, segregation of duties, delegation and immutable decisions without bypassing domain rules or losing customer/document context.
- `F041-US-002` — As a manager/control user, I can review exceptions, approvals, history and performance for Approval workflow within my permitted scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F041-FLOW-001` — The governed lifecycle MUST follow NOT_REQUIRED or PENDING -> APPROVED/REJECTED/CANCELLED/EXPIRED with explicit guards, failure states and cancellation/reversal semantics.
- `F041-FLOW-002` — Validation, permission, concurrency and downstream failures MUST be actionable and safely retryable without duplicate commercial, stock or financial effects.

Lifecycle reference: `NOT_REQUIRED or PENDING -> APPROVED/REJECTED/CANCELLED/EXPIRED`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Sales domain service for **Approval workflow**.
- Lifecycle: `NOT_REQUIRED or PENDING -> APPROVED/REJECTED/CANCELLED/EXPIRED`.
- Transitions require current version/state, authorization and business guards.
- Material historical facts are corrected by revision, reversal or compensation—not history rewrite.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F041-DATA-001` — The authoritative Approval workflow model MUST define stable tenant/company-scoped keys, relationships, fields, constraints, lineage, retention and indexes.
- `F041-DATA-002` — Commercial values that affect commitment, fulfillment or accounting MUST retain source IDs and immutable snapshots where later changes could alter interpretation.

## [SPEC-VALIDATION] Validation rules
- `F041-VAL-001` — All Approval workflow commands MUST validate required fields, references, tenant/company scope, lifecycle legality, currency/UOM/date rules and downstream preconditions server-side.
- `F041-VAL-002` — Failures MUST return stable domain codes and corrective guidance without leaking restricted customer, cost, credit, margin or cross-company data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F041-BR-001` — The owning Sales domain service is authoritative for Approval workflow; UI, API, import, bulk, automation and AI paths MUST reuse the same rules.
- `F041-BR-002` — Later configuration/master edits MUST NOT rewrite accepted, confirmed, fulfilled, invoiced or otherwise material historical Approval workflow evidence.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F041-CALC-001` — All authoritative monetary, quantity, tax, credit, margin, status or eligibility calculations applicable to Approval workflow MUST use deterministic decimal/rule logic with explicit rounding, currency/UOM/date boundaries and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F041-UX-001` — The Approval workflow workspace MUST expose identity/status, customer/document context, key totals/facts, next action, exceptions, related records and downstream state in one coherent Sales shell.
- `F041-UX-002` — Desktop/tablet/phone views MUST define loading, empty, validation, permission, stale/conflict, partial-downstream-failure, destructive confirmation and success feedback.
- `F041-UX-003` — Dense tables/document editors MUST support keyboard operation, visible focus, semantic labels, non-drag alternatives, touch-safe actions and usable small-screen transformation.

Use the view archetype appropriate to the job: document editor/360, dense list/work queue, exception queue, status timeline or analytics dashboard.

## [SPEC-LIST] List, table and work-queue behavior
Lists/work queues define stable server pagination/sorting, column/density behavior, authorization-safe counts, row states/actions, bulk eligibility and virtualization/async thresholds.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search defines identifiers/fields/operators/facets, stable sort, saved/shared views where useful and authorization-safe result/count semantics.

## [SPEC-DETAIL] Detail / 360 workspace
The detail/360 keeps identity, lifecycle, customer/document context, totals/key facts, next action, exceptions, related records, history and downstream request/reference status together.

## [SPEC-CREATE] Create and quick-create UX
Create/quick-create applies governed defaults, validates references/duplicates, previews deterministic calculations where applicable and navigates to a durable created record.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Editability depends on lifecycle/version. Accepted/confirmed/fulfilled/invoiced facts become immutable; controlled revisions/amendments use optimistic concurrency and explicit reasons.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk operations filter ineligible records, preserve permissions, support all-results semantics, move large jobs async, report partial failure and remain idempotent.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Actions are state/permission/scope aware. High-impact actions require confirmation/reason/approval as configured and have keyboard/mobile equivalents.

## [SPEC-RELATED] Related records and contextual navigation
Related CRM, customer, quotation, order, Stock, invoice, return and Accounting links expose only authorized summaries and never perform direct private-table mutation.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F041-AUTO-001` — Automation may act on Approval workflow only through normal domain commands with trigger provenance, recursion control, retry/idempotency policy, audit and visible outcomes.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F041-APP-001` — Configured high-impact Approval workflow exceptions MUST use explicit approval/override rules, segregation of duties, reason capture and stale-approval invalidation; ordinary low-risk work must not be universally blocked.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F041-NOTIF-001` — Material Approval workflow assignments, approvals, expiry, failures or customer-facing milestones MUST be preference-aware, deduplicated, localized where needed and deep-linked to authorized records.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Generated/attached documents bind to an immutable business version where relevant, obey record/field permissions, use safe file handling/retention and support accessible print/PDF output.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports use mapping, preview/dry-run, validation, duplicate handling, row results, resumability and domain commands; exports preserve authorization and use injection-safe formats.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F041-REP-001` — Reports/KPIs for Approval workflow MUST define grain, filters, period/timezone, currency basis, freshness, permission-safe aggregation, drilldown and reconciliation.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F041-AI-001` — Classification AI_AUTOMATE_WITH_APPROVAL applies. AI may operate only on authorized evidence and MUST NOT directly write database state or override deterministic pricing, tax, credit, stock, approval, invoice or accounting truth.

## [SPEC-SECURITY] Security, permissions and field controls
- `F041-SEC-001` — Every Approval workflow query/command MUST enforce server-side organization, company/branch where applicable, action permission and record/customer scope before data is returned or mutated.
- `F041-SEC-002` — Credit, cost, margin, contacts, pricing exceptions and approval evidence MUST support stricter field/action restrictions and negative tests across search, export, reports, errors and AI.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Reads/writes are organization-isolated and apply company/branch/team/owner/record scope where relevant. Cross-company access is explicit and permissioned.

## [SPEC-AUDIT] Auditability and history
Audit captures actor/channel/time, before-after or immutable version, reason/approval, request/correlation ID and downstream request/event references for material **Approval workflow** actions.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Optimistic concurrency protects mutable commercial records. Confirmation/reservation/financial races use transactional constraints and retry rules; stale UI gets actionable conflict recovery.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible/cross-module effects use business idempotency keys plus database uniqueness. Exact replay returns prior result/no-op; conflicting replay is rejected; reconciliation detects stranded/duplicate effects.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F041-INT-001` — Every Approval workflow cross-module handoff MUST call the destination module public contract/orchestration, never mutate another module private tables.
- `F041-INT-002` — Cross-module Approval workflow handoffs MUST define trigger, source/destination owner, transaction boundary, idempotency, retry/failure, audit/outbox, result, reversal/compensation and reconciliation.

## [SPEC-API] Commands, queries and API contracts
- `F041-API-001` — Mutating Approval workflow APIs MUST use explicit command intent, validated schemas, authorization, stable errors, optimistic concurrency where needed, idempotency for externally visible effects and audit/outbox correlation.
- `F041-API-002` — Read APIs for Approval workflow MUST provide authorization-safe pagination/filter/sort, stable schemas, count semantics and field redaction appropriate to customer, price, credit, cost and margin sensitivity.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Mobile adapts critical reads/actions to compact cards/document sections, preserves authorization and only permits offline mutation where queue/conflict/idempotency rules are safe.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop favors dense work; tablet reflows secondary panels; phone uses stacked summaries/cards/action sheets. Intentional table/board scrolling never hides critical actions/data.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantics, labels/instructions, visible focus, keyboard use, announced validation/status, contrast/target sizing, reduced motion and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Pass-level visual contract: `docs/11-visual-assets/wireframes/SALES_PASS2_WORKSPACES.md`; complex workspaces require desktop/tablet/phone and normal/empty/error/permission/stale/conflict/failure states before implementation.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F041-PERF-001` — Approval workflow MUST define representative 0/1/100/10k+ record behavior, latency/query budgets, async thresholds and protection against unbounded queries.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F041-OBS-001` — Structured logs/metrics/traces for Approval workflow MUST carry safe correlation/business-state/downstream-request data without logging secrets or unnecessary PII.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover empty/min/max/negative values where relevant, decimal/currency/UOM boundaries, duplicate submit, stale/archived references, concurrent actors, permission changes, downstream partial failure, retry, timezone/DST and reversal/reconciliation.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- `SALES-P2-CODE-011` — `services/api/src/modules/sales/quotation-governance.js` — current repository artifact inspected for Approval workflow.

This is current-code evidence only and does **not** certify the feature as implemented/product-ready.

## [SPEC-GAPS] Exact gap analysis
Current code is reconciled as a foundation only. Product completion still needs requirement-by-requirement implementation evidence, DB/API/security verification, cross-module journey execution, responsive/accessibility/visual verification and human UAT.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implementation later follows capability boundaries: invariants/migrations → domain/public API → orchestration → web/mobile UX → unit/API/security/integration/E2E → UAT. Current seed path: `services/api/src/modules/sales/quotation-governance.js`. This pass writes no product source.

## [SPEC-TESTS] Automated test plan
Map approved requirements to domain/unit, DB/RLS/constraint, API/contract, authorization-negative, calculation/property, concurrency/idempotency, integration/reconciliation, migration and representative-volume tests.

## [SPEC-E2E] Browser and critical-journey E2E
- `F041-E2E-001` — Browser/API E2E MUST prove the primary authorized workflow to route commercial exceptions through maker-checker approval with thresholds, segregation of duties, delegation and immutable decisions and verify resulting state, history and downstream references.
- `F041-E2E-002` — E2E MUST cover unauthorized access, invalid/stale data, concurrency/idempotent replay and at least one relevant downstream failure/retry or reversal path for Approval workflow.

## [SPEC-UAT] Human UAT plan
- `F041-UAT-001` — A real Sales operator UAT MUST execute the primary Approval workflow job with realistic data on desktop and an appropriate responsive path, capturing visible/business evidence.
- `F041-UAT-002` — A manager/finance/operations UAT MUST verify permissions, exception/approval behavior, audit/history and applicable cross-module reconciliation for Approval workflow.

## [SPEC-DOD] Objective Definition of Done
`FEATURE_READY` later requires all approved requirements implemented/evidenced, deterministic controls and server authorization proven, audit/concurrency/idempotency/reversal verified, applicable journeys green, responsive/accessibility/visual gates passed and signed UAT. `SPECIFICATION_READY` alone is never feature completion.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
Approved Sales Pass 2 module decisions are recorded as `SALES-P2-DEC-001` through `SALES-P2-DEC-006`. No material scope placeholder remains for specification readiness; implementation/product risks remain open until evidence exists.
