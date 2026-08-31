# F155 — Manufacturing orders

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F155`
- Canonical name: **Manufacturing orders**
- Module: **Manufacturing**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `MFG-CAP-003`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Provide manufacturing-order lifecycle, demand/source lineage, quantity/date priority and authoritative production intent.

**Non-goal:** specification readiness does not certify current implementation, and Manufacturing does not take private-state ownership from Stock, Quality, Procurement, Sales, Assets or Accounting.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Production outcome: executable, reproducible production intent and shop-floor truth.
- Control outcome: no bypass of structure effectivity, material, quality, authorization or costing invariants.
- Reconciliation outcome: material, WIP, output, cost and downstream ledger facts can be explained end to end.
- Readiness outcome: specification is independently gated from implementation/product readiness.

## [SPEC-PERSONAS] Personas and jobs to be done
- Manufacturing engineer owns product/process definition and engineering changes.
- Production planner/scheduler owns MRP, shortages, capacity and release sequencing.
- Supervisor/operator/material controller executes shop-floor and material work.
- Quality, Stock, Procurement, Sales, Maintenance/Assets and Finance participate through explicit contracts.
- Negative case: unauthorized users cannot infer structures, quantities, costs/rates, employee time or restricted demand through lists, dashboards, exports or search.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
- Manufacturing dashboard, planning/MRP workspace, BOM/routing workspaces, work-order queues and shop-floor job cards.
- Product/BOM/routing/work-centre/work-order 360, global search/command palette and durable deep links.
- Contextual entry from Sales MTO, Stock shortages/movements, Procurement subcontracting, Quality holds, Assets maintenance and Accounting reconciliation where authorized.

## [SPEC-BENCHMARK] Benchmark research evidence
- `MFG-P5-BE-021` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `MFG-P5-BE-022` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: mature product-structure, planning, execution, quality, traceability, costing and reconciliation behavior.
- `DIFFERENTIATOR`: coherent Vercentlabs capability-oriented UX/contracts instead of copied vendor object names.
- `NOT_APPLICABLE`: vendor-specific licensing/object names and features outside the canonical product scope.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **effectivity/snapshots, multi-level explosion, states, permissions, material/capacity concurrency, shortage/hold, retry/reversal/reconciliation, traceability, costing, responsive shop-floor UX, audit, reporting and scale behavior expected for Manufacturing orders**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F155-CAP-001` — Manufacturing orders MUST provide manufacturing-order lifecycle, demand/source lineage, quantity/date priority and authoritative production intent.
- `F155-CAP-002` — Manufacturing orders MUST cover lifecycle, permissions, effectivity, concurrency, retry/reversal, audit, reporting, responsive UX and scale; the canonical title is a traceability anchor, not the whole capability.
- `F155-CAP-003` — Manufacturing orders MUST preserve Manufacturing ownership of production intent/execution while Stock, Quality, Procurement, Sales, Assets and Accounting effects use versioned public contracts rather than private-table mutation.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F155-FR-001` — The system MUST provide a server-backed Manufacturing orders workflow covering success, validation, permission, conflict, shortage/hold/downstream failure, retry/reversal and audit states.
- `F155-FR-002` — Every material Manufacturing orders action MUST preserve actor, effective/posting time, reason, source demand/order, structure/routing version, prior/new state or immutable event, and downstream lineage.
- `F155-FR-003` — Manufacturing orders MUST remain operational at enterprise BOM/order/transaction volumes using bounded queries, batching/background jobs and stable state transitions as appropriate.
- `F155-US-001` — As an authorized manufacturing engineer/planner/operator, I can perform Manufacturing orders with the exact structure, material, resource, time, quality and traceability context needed for the job.
- `F155-US-002` — As a production manager/controller, I can review exceptions, provenance, approvals, variances, history and reconciliation for Manufacturing orders within my permitted company/plant/work-centre scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F155-FLOW-001` — The governed lifecycle for Manufacturing orders MUST follow DRAFT -> PLANNED -> RELEASED -> IN_PROGRESS -> COMPLETED, with guarded CANCEL/HOLD/REOPEN or compensating reversal paths with explicit guards and no silent historical rewrite.
- `F155-FLOW-002` — Validation, permission, concurrent update, material shortage, quality hold and downstream failures for Manufacturing orders MUST be actionable and safely retryable without duplicate stock, WIP, cost, reservation or accounting effects.

Lifecycle reference: `DRAFT -> PLANNED -> RELEASED -> IN_PROGRESS -> COMPLETED, with guarded CANCEL/HOLD/REOPEN or compensating reversal paths`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Manufacturing domain service for **Manufacturing orders**.
- Lifecycle: `DRAFT -> PLANNED -> RELEASED -> IN_PROGRESS -> COMPLETED, with guarded CANCEL/HOLD/REOPEN or compensating reversal paths`.
- Transitions require current state/version, authorization, effective structure/resource/material eligibility and invariant checks.
- Posted production/stock/cost facts are corrected by reversal/compensation, never silent mutation.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F155-DATA-001` — The Manufacturing orders model MUST define organization/company/branch/plant, item, BOM/routing/order/operation/resource, warehouse/location, lot/batch/serial and source dimensions as applicable, with stable keys, constraints, indexes, retention and lineage.
- `F155-DATA-002` — Quantity, UOM, dates, rates, version/effectivity, resource, cost, quality and source values that determine historical Manufacturing orders interpretation MUST remain reproducible after master/configuration changes.

## [SPEC-VALIDATION] Validation rules
- `F155-VAL-001` — All Manufacturing orders commands MUST validate tenant/company scope, item/UOM/quantity/date precision, approved effectivity, lifecycle, resource/material eligibility, tracking/quality rules and cross-reference integrity server-side.
- `F155-VAL-002` — Manufacturing orders failures MUST expose stable domain error codes and corrective guidance without leaking unauthorized cost, supplier, customer, employee, cross-company or restricted engineering data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F155-BR-001` — The Manufacturing domain command responsible for Manufacturing orders is authoritative; UI, API, import, automation, scanner and AI paths MUST reuse the same deterministic invariant checks.
- `F155-BR-002` — Manufacturing orders MUST resolve approved/effective master data at the defined decision point and preserve the resolved version/rates/structure on released or posted production facts so later configuration changes cannot rewrite history.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F155-CALC-001` — All BOM explosion, MRP netting, capacity/time, material scaling, WIP/cost, variance, yield or efficiency calculations applicable to Manufacturing orders MUST use deterministic decimal/date rules, explicit units/rates/rounding and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F155-UX-001` — The Manufacturing orders workspace MUST expose identity, lifecycle, source/demand, structure/operation/resource context, material/quality/cost facts as permitted, exceptions, related records and history in one coherent Manufacturing shell.
- `F155-UX-002` — Desktop/tablet/phone views for Manufacturing orders MUST define loading, empty, validation, permission, shortage/hold, stale/conflict, offline/retry, destructive confirmation and success states.
- `F155-UX-003` — Shop-floor-heavy Manufacturing orders interactions MUST support keyboard and touch operation, scanner/manual alternatives, visible focus, non-color status cues and non-drag alternatives.

Use the appropriate archetype: engineering structure compare, MRP exception workbench, scheduling board/Gantt, shop-floor job card, material/WIP posting workbench, genealogy graph, quality hold/rework queue, cost/variance report or production dashboard.

## [SPEC-LIST] List, table and work-queue behavior
Lists/work queues define server pagination/sorting, column/density personalization, authorization-safe counts, row state/actions, bulk eligibility and virtualization/async thresholds.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search defines product/BOM/routing/order/work-centre/operation/lot/serial/source fields, stable filters/facets/sorts, saved views and authorization-safe counts.

## [SPEC-DETAIL] Detail / 360 workspace
The detail/360 keeps identity, lifecycle, source demand, resolved structure/routing revision, materials, operations/resources, quality, traceability, cost and downstream state together.

## [SPEC-CREATE] Create and quick-create UX
Create/quick-create applies governed defaults and effectivity/UOM checks; before release/posting, operators receive a deterministic preview of material, capacity, quality and downstream effects.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Engineering/planning master edits are version/effectivity aware. Released work-order snapshots and posted material/output/cost facts are immutable except through governed amendment, reversal or compensation.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk release/reschedule/issue/close actions validate every selected record under the same server rules, define all-or-nothing versus partial semantics, failure export/retry and audit.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary/destructive actions are role/state aware; approve/release/start/post/hold/release-hold/rework/cancel/reverse actions require explicit confirmation when they create irreversible or downstream effects.

## [SPEC-RELATED] Related records and contextual navigation
Related navigation links product, BOM/routing revision, work order/operation, material/stock movement, lot/serial, quality inspection/hold, subcontract PO, maintenance event, sales demand and accounting references without private cross-module writes.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F155-AUTO-001` — Automation MAY create proposals/work for Manufacturing orders only through idempotent Manufacturing/public commands; it MUST NOT directly mutate production, stock balance, quality disposition or accounting tables.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F155-APP-001` — Where policy requires approval for BOM/routing release, engineering change, overproduction, material/cost exception, quality release or high-impact Manufacturing orders action, approval MUST bind to the exact version/state/value being approved and prevent self-approval where configured.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F155-NOTIF-001` — Notifications for Manufacturing orders MUST be event-driven, deduplicated, preference/permission aware and deep-link to the exact shortage, hold, delay, variance or work item without exposing restricted data.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Work instructions, drawings, labels, travelers/job cards, inspection evidence and generated production documents use permission-safe versions/templates, durable references, generated-at metadata and reprint/history where material.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports require mapping, dry-run/preview, structure cycle/effectivity/UOM validation, duplicate/idempotency policy, background jobs and failure rows; exports respect engineering/cost/employee/plant permissions and as-of semantics.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F155-REP-001` — Reports/KPIs for Manufacturing orders MUST define grain, filters, freshness/as-of semantics, drilldown and reconciliation to authoritative production, Stock, Quality and Accounting records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F155-AI-001` — AI for Manufacturing orders is limited to assist/recommend/generate workflows with provenance, freshness, uncertainty, explanation and permission filtering; AI MUST NOT be authoritative for BOM effectivity, MRP math, stock/WIP quantity, quality hold/release, costing, posting legality or authorization.

## [SPEC-SECURITY] Security, permissions and field controls
- `F155-SEC-001` — Every Manufacturing orders query and mutation MUST enforce authentication, module entitlement, organization/company/branch/plant/work-centre scope, action permission and record visibility server-side.
- `F155-SEC-002` — Engineering structures, costs/rates, employee time, supplier/customer references and approvals in Manufacturing orders MUST be field/action restricted and protected against IDOR, aggregate leakage and unauthorized export.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Every Manufacturing query/mutation is organization/company scoped, with branch/plant/work-centre access as additional dimensions where configured. Cross-company structures, production, quantities, costs or employee-time data are never inferred by absence of UI filters.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time, request/correlation/idempotency key, effective structure/routing/rate version, demand/source, state/reason, approval/hold/reversal links, Stock/Quality/Accounting references and before/after mutable engineering configuration.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Release, material reservation/issue, production posting, capacity reschedule, quality release and cost finalization use transaction-scoped locking or compare-and-update at the authoritative aggregate/dimension grain. Lock order, stale edits, deadlock retry and recovery are explicit.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible material/output/quality/accounting effects require idempotency/source-effect uniqueness, replay/no-op semantics, durable outbox or equivalent delivery guarantees and reconciliation for uncertain downstream outcomes.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F155-INT-001` — Inbound cross-module requests affecting Manufacturing orders MUST call a versioned Manufacturing public command with authorization, idempotency/source reference, validation and explicit success/failure result.
- `F155-INT-002` — Outbound effects from Manufacturing orders MUST use public commands/events or orchestration with retry, reversal/compensation and reconciliation; Manufacturing MUST NOT mutate another module’s private tables.

## [SPEC-API] Commands, queries and API contracts
- `F155-API-001` — Manufacturing orders mutation APIs MUST define request schema, authorization, idempotency, expected state/version, stable errors, audit/outbox effects and compatibility semantics.
- `F155-API-002` — Manufacturing orders query APIs MUST define dimension grain, pagination/filter/sort, as-of/freshness semantics, authorization-safe aggregates and stable response contracts.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Shop-floor execution, material issue/return, lot/serial capture, job cards, inspections and downtime support tablet/phone/scanner flows with manual fallback, explicit offline read/write boundaries, reconnect conflict handling and device security.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop supports planning grids, engineering comparison and Gantt/boards; tablet supports production supervision/shop-floor work; phone transforms dense views into step/card flows without removing critical material/quality/exception actions.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantic labels/headings, full keyboard support, visible focus, status/error announcements, sufficient target size/contrast, non-color status cues, reduced motion and non-drag/manual alternatives to barcode/touch interactions.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/MANUFACTURING_PASS5_WORKSPACES.md` plus Manufacturing journey/state diagrams and cross-module contracts.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F155-PERF-001` — Manufacturing orders MUST define performance envelopes for 0/1/100/10k/1m BOM lines, requirements, operations or production transactions as applicable, with bounded synchronous work and explicit async thresholds.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F155-OBS-001` — Manufacturing orders MUST emit structured logs/metrics/traces for failures, retries, lock contention, MRP/job lag, shortages, hold blocks, drift/reconciliation and downstream delivery using correlation IDs.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Red-team cases include circular/deep BOMs, overlapping effectivity, stale revision at release, MRP double counting, reservation races, shortage during release, partial/over/under production, UOM rounding drift, duplicate backflush/post, serial reuse, batch split/merge, quality hold bypass, rework loops, co-product allocation, subcontract stock ownership, capacity/maintenance conflict, backdated/closed-period posting, valuation/GL delivery uncertainty and cross-company IDOR.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- Verified current-code evidence: `MFG-P5-CODE-011` → `services/api/src/modules/manufacturing/index.js`.
- Evidence describes present foundations only; absence or presence never auto-certifies the canonical feature.

## [SPEC-GAPS] Exact gap analysis
Implementation/product readiness remains explicitly unverified. Pass 5 requires later code-level proof for every approved requirement, especially BOM/routing effectivity, MRP pegging/netting, concurrency, Stock/Quality interlocks, WIP/cost integrity, scheduling/capacity, genealogy, reversals/backdating/period controls, mobile shop-floor execution and cross-module reconciliation.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implement by capability and journey, not one folder per F-ID. Priority: engineering structures/effectivity -> order/snapshot/state model -> MRP/material public contracts -> shop-floor/time/capacity -> quality/traceability/rework -> costing/reconciliation -> maintenance/reporting.

## [SPEC-TESTS] Automated test plan
Automated tests require domain/unit math, BOM graph/property tests, MRP/pegging/netting invariants, database/RLS and concurrency, API auth-negative/idempotency, Stock/Quality/Accounting integration, cost/WIP reconciliation, migration/backdating/period controls, performance/volume and observability diagnostics.

## [SPEC-E2E] Browser and critical-journey E2E
- `F155-E2E-001` — E2E MUST prove an authorized persona can complete the primary Manufacturing orders journey and observe correct structure/material/resource/state/history/downstream effects.
- `F155-E2E-002` — E2E MUST cover unauthorized access, stale/concurrent or replayed action and at least one relevant shortage, hold, capacity conflict, partial, reversal, rework or reconciliation path for Manufacturing orders.

## [SPEC-UAT] Human UAT plan
- `F155-UAT-001` — A real manufacturing engineer/planner/supervisor/operator MUST execute the primary Manufacturing orders job with realistic data on the appropriate desktop/tablet/shop-floor form factor, capturing visible and data evidence.
- `F155-UAT-002` — A production manager plus relevant Stock/Quality/Procurement/Sales/Maintenance/Finance persona MUST verify permissions, exceptions, reversal/reconciliation, audit and cross-module outcomes for Manufacturing orders.

## [SPEC-DOD] Objective Definition of Done
Objective completion requires approved requirements with implementation/test evidence; server authorization; valid state transitions; deterministic BOM/MRP/material/WIP/quality/cost calculations; idempotent/auditable cross-module effects; responsive/accessibility evidence; actionable recovery; reconciliation and executed UAT. A page, table, endpoint or existing artifact alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder remains for Pass 5 specification readiness. Implementation-time policies (finite/infinite scheduling, overproduction tolerance, backflush points, co-product allocation, subcontract ownership, labor/rate treatment, period/backdating rules) must be explicit configuration/decisions and cannot weaken deterministic manufacturing, inventory, quality or financial invariants.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F155-SEM-01` — **Document lifecycle, identity and numbering**: Define draft/review/approved/confirmed/posted/cancelled states as applicable, immutable identity, numbering and legal/business dates.
- `F155-SEM-02` — **Header, line, snapshot and reference model**: Freeze header/line relationships, party/item/address/term snapshots, attachments, source references and historical truth.
- `F155-SEM-03` — **Commercial/operational calculation and eligibility rules**: Define quantity, price, discount, tax/charge, currency/UOM, eligibility, effective-date and rounding behavior where applicable.
- `F155-SEM-04` — **Maker-checker, editability and sensitive-field controls**: Define who creates, changes, approves, posts, cancels, sees sensitive values and how SoD overrides are audited.
- `F155-SEM-05` — **Create/revise/compare/print/send workspace**: Cover creation, validation, versions/revisions, preview, print/PDF, send, status feedback, responsive use and accessibility.
- `F155-SEM-06` — **Upstream/downstream posting and fulfillment contracts**: Define public contracts, idempotency keys, downstream records, asynchronous effects and reconciliation.
- `F155-SEM-07` — **Amendment, cancellation, reversal, duplicate and retry semantics**: Handle stale edits, duplicate submit, partial downstream failure, correction, reversal/credit and safe replay.
- `F155-SEM-08` — **Document audit, reconciliation and evidence**: Require immutable history, numbering tests, calculation goldens, authorization-negative tests, integration E2E and UAT.

Cross-module context: **Stock / Inventory;Procurement;Quality;Assets;Accounting / Finance**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP019;SP022;SP024;SP030;SP033;SP034`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.
