# F181 — Production quality inspections

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F181`
- Canonical name: **Production quality inspections**
- Module: **Manufacturing**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `MFG-CAP-006`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Provide production-triggered quality inspections with sampling/specification/result/nonconformance linkage at operation/output stages.

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
- `MFG-P5-BE-073` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `MFG-P5-BE-074` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: mature product-structure, planning, execution, quality, traceability, costing and reconciliation behavior.
- `DIFFERENTIATOR`: coherent Vercentlabs capability-oriented UX/contracts instead of copied vendor object names.
- `NOT_APPLICABLE`: vendor-specific licensing/object names and features outside the canonical product scope.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **effectivity/snapshots, multi-level explosion, states, permissions, material/capacity concurrency, shortage/hold, retry/reversal/reconciliation, traceability, costing, responsive shop-floor UX, audit, reporting and scale behavior expected for Production quality inspections**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F181-CAP-001` — Production quality inspections MUST provide production-triggered quality inspections with sampling/specification/result/nonconformance linkage at operation/output stages.
- `F181-CAP-002` — Production quality inspections MUST cover lifecycle, permissions, effectivity, concurrency, retry/reversal, audit, reporting, responsive UX and scale; the canonical title is a traceability anchor, not the whole capability.
- `F181-CAP-003` — Production quality inspections MUST preserve Manufacturing ownership of production intent/execution while Stock, Quality, Procurement, Sales, Assets and Accounting effects use versioned public contracts rather than private-table mutation.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F181-FR-001` — The system MUST provide a server-backed Production quality inspections workflow covering success, validation, permission, conflict, shortage/hold/downstream failure, retry/reversal and audit states.
- `F181-FR-002` — Every material Production quality inspections action MUST preserve actor, effective/posting time, reason, source demand/order, structure/routing version, prior/new state or immutable event, and downstream lineage.
- `F181-FR-003` — Production quality inspections MUST remain operational at enterprise BOM/order/transaction volumes using bounded queries, batching/background jobs and stable state transitions as appropriate.
- `F181-US-001` — As an authorized manufacturing engineer/planner/operator, I can perform Production quality inspections with the exact structure, material, resource, time, quality and traceability context needed for the job.
- `F181-US-002` — As a production manager/controller, I can review exceptions, provenance, approvals, variances, history and reconciliation for Production quality inspections within my permitted company/plant/work-centre scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F181-FLOW-001` — The governed lifecycle for Production quality inspections MUST follow PENDING/OPEN -> INSPECTED -> PASS/FAIL/HOLD -> RELEASED/REWORK/SCRAP/OTHER DISPOSITION with approval and audit with explicit guards and no silent historical rewrite.
- `F181-FLOW-002` — Validation, permission, concurrent update, material shortage, quality hold and downstream failures for Production quality inspections MUST be actionable and safely retryable without duplicate stock, WIP, cost, reservation or accounting effects.

Lifecycle reference: `PENDING/OPEN -> INSPECTED -> PASS/FAIL/HOLD -> RELEASED/REWORK/SCRAP/OTHER DISPOSITION with approval and audit`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Manufacturing domain service for **Production quality inspections**.
- Lifecycle: `PENDING/OPEN -> INSPECTED -> PASS/FAIL/HOLD -> RELEASED/REWORK/SCRAP/OTHER DISPOSITION with approval and audit`.
- Transitions require current state/version, authorization, effective structure/resource/material eligibility and invariant checks.
- Posted production/stock/cost facts are corrected by reversal/compensation, never silent mutation.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F181-DATA-001` — The Production quality inspections model MUST define organization/company/branch/plant, item, BOM/routing/order/operation/resource, warehouse/location, lot/batch/serial and source dimensions as applicable, with stable keys, constraints, indexes, retention and lineage.
- `F181-DATA-002` — Quantity, UOM, dates, rates, version/effectivity, resource, cost, quality and source values that determine historical Production quality inspections interpretation MUST remain reproducible after master/configuration changes.

## [SPEC-VALIDATION] Validation rules
- `F181-VAL-001` — All Production quality inspections commands MUST validate tenant/company scope, item/UOM/quantity/date precision, approved effectivity, lifecycle, resource/material eligibility, tracking/quality rules and cross-reference integrity server-side.
- `F181-VAL-002` — Production quality inspections failures MUST expose stable domain error codes and corrective guidance without leaking unauthorized cost, supplier, customer, employee, cross-company or restricted engineering data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F181-BR-001` — The Manufacturing domain command responsible for Production quality inspections is authoritative; UI, API, import, automation, scanner and AI paths MUST reuse the same deterministic invariant checks.
- `F181-BR-002` — Production quality inspections MUST resolve approved/effective master data at the defined decision point and preserve the resolved version/rates/structure on released or posted production facts so later configuration changes cannot rewrite history.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F181-CALC-001` — All BOM explosion, MRP netting, capacity/time, material scaling, WIP/cost, variance, yield or efficiency calculations applicable to Production quality inspections MUST use deterministic decimal/date rules, explicit units/rates/rounding and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F181-UX-001` — The Production quality inspections workspace MUST expose identity, lifecycle, source/demand, structure/operation/resource context, material/quality/cost facts as permitted, exceptions, related records and history in one coherent Manufacturing shell.
- `F181-UX-002` — Desktop/tablet/phone views for Production quality inspections MUST define loading, empty, validation, permission, shortage/hold, stale/conflict, offline/retry, destructive confirmation and success states.
- `F181-UX-003` — Shop-floor-heavy Production quality inspections interactions MUST support keyboard and touch operation, scanner/manual alternatives, visible focus, non-color status cues and non-drag alternatives.

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
- `F181-AUTO-001` — Automation MAY create proposals/work for Production quality inspections only through idempotent Manufacturing/public commands; it MUST NOT directly mutate production, stock balance, quality disposition or accounting tables.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F181-APP-001` — Where policy requires approval for BOM/routing release, engineering change, overproduction, material/cost exception, quality release or high-impact Production quality inspections action, approval MUST bind to the exact version/state/value being approved and prevent self-approval where configured.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F181-NOTIF-001` — Notifications for Production quality inspections MUST be event-driven, deduplicated, preference/permission aware and deep-link to the exact shortage, hold, delay, variance or work item without exposing restricted data.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Work instructions, drawings, labels, travelers/job cards, inspection evidence and generated production documents use permission-safe versions/templates, durable references, generated-at metadata and reprint/history where material.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports require mapping, dry-run/preview, structure cycle/effectivity/UOM validation, duplicate/idempotency policy, background jobs and failure rows; exports respect engineering/cost/employee/plant permissions and as-of semantics.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F181-REP-001` — Reports/KPIs for Production quality inspections MUST define grain, filters, freshness/as-of semantics, drilldown and reconciliation to authoritative production, Stock, Quality and Accounting records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F181-AI-001` — AI for Production quality inspections is limited to assist/recommend/generate workflows with provenance, freshness, uncertainty, explanation and permission filtering; AI MUST NOT be authoritative for BOM effectivity, MRP math, stock/WIP quantity, quality hold/release, costing, posting legality or authorization.

## [SPEC-SECURITY] Security, permissions and field controls
- `F181-SEC-001` — Every Production quality inspections query and mutation MUST enforce authentication, module entitlement, organization/company/branch/plant/work-centre scope, action permission and record visibility server-side.
- `F181-SEC-002` — Engineering structures, costs/rates, employee time, supplier/customer references and approvals in Production quality inspections MUST be field/action restricted and protected against IDOR, aggregate leakage and unauthorized export.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Every Manufacturing query/mutation is organization/company scoped, with branch/plant/work-centre access as additional dimensions where configured. Cross-company structures, production, quantities, costs or employee-time data are never inferred by absence of UI filters.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time, request/correlation/idempotency key, effective structure/routing/rate version, demand/source, state/reason, approval/hold/reversal links, Stock/Quality/Accounting references and before/after mutable engineering configuration.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Release, material reservation/issue, production posting, capacity reschedule, quality release and cost finalization use transaction-scoped locking or compare-and-update at the authoritative aggregate/dimension grain. Lock order, stale edits, deadlock retry and recovery are explicit.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible material/output/quality/accounting effects require idempotency/source-effect uniqueness, replay/no-op semantics, durable outbox or equivalent delivery guarantees and reconciliation for uncertain downstream outcomes.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F181-INT-001` — Inbound cross-module requests affecting Production quality inspections MUST call a versioned Manufacturing public command with authorization, idempotency/source reference, validation and explicit success/failure result.
- `F181-INT-002` — Outbound effects from Production quality inspections MUST use public commands/events or orchestration with retry, reversal/compensation and reconciliation; Manufacturing MUST NOT mutate another module’s private tables.

## [SPEC-API] Commands, queries and API contracts
- `F181-API-001` — Production quality inspections mutation APIs MUST define request schema, authorization, idempotency, expected state/version, stable errors, audit/outbox effects and compatibility semantics.
- `F181-API-002` — Production quality inspections query APIs MUST define dimension grain, pagination/filter/sort, as-of/freshness semantics, authorization-safe aggregates and stable response contracts.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Shop-floor execution, material issue/return, lot/serial capture, job cards, inspections and downtime support tablet/phone/scanner flows with manual fallback, explicit offline read/write boundaries, reconnect conflict handling and device security.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop supports planning grids, engineering comparison and Gantt/boards; tablet supports production supervision/shop-floor work; phone transforms dense views into step/card flows without removing critical material/quality/exception actions.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantic labels/headings, full keyboard support, visible focus, status/error announcements, sufficient target size/contrast, non-color status cues, reduced motion and non-drag/manual alternatives to barcode/touch interactions.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/MANUFACTURING_PASS5_WORKSPACES.md` plus Manufacturing journey/state diagrams and cross-module contracts.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F181-PERF-001` — Production quality inspections MUST define performance envelopes for 0/1/100/10k/1m BOM lines, requirements, operations or production transactions as applicable, with bounded synchronous work and explicit async thresholds.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F181-OBS-001` — Production quality inspections MUST emit structured logs/metrics/traces for failures, retries, lock contention, MRP/job lag, shortages, hold blocks, drift/reconciliation and downstream delivery using correlation IDs.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Red-team cases include circular/deep BOMs, overlapping effectivity, stale revision at release, MRP double counting, reservation races, shortage during release, partial/over/under production, UOM rounding drift, duplicate backflush/post, serial reuse, batch split/merge, quality hold bypass, rework loops, co-product allocation, subcontract stock ownership, capacity/maintenance conflict, backdated/closed-period posting, valuation/GL delivery uncertainty and cross-company IDOR.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- Verified current-code evidence: `MFG-P5-CODE-037` → `database/tenant/migrations/049_quality_module.sql`.
- Evidence describes present foundations only; absence or presence never auto-certifies the canonical feature.

## [SPEC-GAPS] Exact gap analysis
Implementation/product readiness remains explicitly unverified. Pass 5 requires later code-level proof for every approved requirement, especially BOM/routing effectivity, MRP pegging/netting, concurrency, Stock/Quality interlocks, WIP/cost integrity, scheduling/capacity, genealogy, reversals/backdating/period controls, mobile shop-floor execution and cross-module reconciliation.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implement by capability and journey, not one folder per F-ID. Priority: engineering structures/effectivity -> order/snapshot/state model -> MRP/material public contracts -> shop-floor/time/capacity -> quality/traceability/rework -> costing/reconciliation -> maintenance/reporting.

## [SPEC-TESTS] Automated test plan
Automated tests require domain/unit math, BOM graph/property tests, MRP/pegging/netting invariants, database/RLS and concurrency, API auth-negative/idempotency, Stock/Quality/Accounting integration, cost/WIP reconciliation, migration/backdating/period controls, performance/volume and observability diagnostics.

## [SPEC-E2E] Browser and critical-journey E2E
- `F181-E2E-001` — E2E MUST prove an authorized persona can complete the primary Production quality inspections journey and observe correct structure/material/resource/state/history/downstream effects.
- `F181-E2E-002` — E2E MUST cover unauthorized access, stale/concurrent or replayed action and at least one relevant shortage, hold, capacity conflict, partial, reversal, rework or reconciliation path for Production quality inspections.

## [SPEC-UAT] Human UAT plan
- `F181-UAT-001` — A real manufacturing engineer/planner/supervisor/operator MUST execute the primary Production quality inspections job with realistic data on the appropriate desktop/tablet/shop-floor form factor, capturing visible and data evidence.
- `F181-UAT-002` — A production manager plus relevant Stock/Quality/Procurement/Sales/Maintenance/Finance persona MUST verify permissions, exceptions, reversal/reconciliation, audit and cross-module outcomes for Production quality inspections.

## [SPEC-DOD] Objective Definition of Done
Objective completion requires approved requirements with implementation/test evidence; server authorization; valid state transitions; deterministic BOM/MRP/material/WIP/quality/cost calculations; idempotent/auditable cross-module effects; responsive/accessibility evidence; actionable recovery; reconciliation and executed UAT. A page, table, endpoint or existing artifact alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder remains for Pass 5 specification readiness. Implementation-time policies (finite/infinite scheduling, overproduction tolerance, backflush points, co-product allocation, subcontract ownership, labor/rate treatment, period/backdating rules) must be explicit configuration/decisions and cannot weaken deterministic manufacturing, inventory, quality or financial invariants.
