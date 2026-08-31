# F265 — Gain / loss on disposal

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F265`
- Canonical name: **Gain / loss on disposal**
- Module: **Assets**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `AST-CAP-007`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Provide deterministic gain/loss on disposal derived from authoritative proceeds/disposal cost/carrying value at effective date.

**Non-goal:** specification readiness does not certify current implementation, and Assets does not take private-state ownership from Procurement, Stock, Manufacturing, Projects, HR/Payroll, Quality or Accounting.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Operational outcome: assets remain identifiable, locatable, accountable and maintainable through their lifecycle.
- Financial outcome: value/depreciation/disposal facts reconcile to Accounting without duplicate posting.
- Control outcome: maker-checker, effective dating, period locks, audit and correction/reversal semantics are explicit.
- Field outcome: scan/inspection/calibration/verification workflows work on tablet/phone with accessibility and evidence.

## [SPEC-PERSONAS] Personas and jobs to be done
- Asset manager controls registry, custody, movement and lifecycle.
- Asset accountant/controller controls capitalization, depreciation, value adjustments and disposal accounting evidence.
- Maintenance manager/technician controls maintenance, repair/downtime and field execution.
- Inspector/calibration technician/auditor verifies condition/compliance/evidence.
- Employee/custodian can view/acknowledge assigned assets only as policy allows.
- Negative case: unauthorized users cannot infer cost/NBV, custodian, warranty, maintenance, inspection or financial details through search/aggregates.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
- Assets dashboard, asset register/360, categories, assignments/transfers, maintenance, inspection/calibration, depreciation/value, verification, disposals and reports.
- Global search/command palette, durable deep links and contextual entry from Procurement, Projects, Manufacturing/maintenance, HR custody and Accounting where authorized.
- Mobile scanner opens permitted asset detail and context action without bypassing server controls.

## [SPEC-BENCHMARK] Benchmark research evidence
- `AST-P7-BE-069` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `AST-P7-BE-070` — official benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: mature lifecycle, fixed-asset accounting controls, maintenance/evidence, field identification and audit behavior supported by official benchmarks.
- `DIFFERENTIATOR`: unified operational + financial lifecycle with public contracts and reconciliation, while keeping module ownership clean.
- `NOT_APPLICABLE`: vendor-specific object names/licensing and capabilities outside canonical scope.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review for **Gain / loss on disposal** covered identity uniqueness, hierarchy/component/multi-book implications where relevant, effective dating, thresholds/CIP/partial-transfer/disposal expectations, depreciation convention/rounding, period close, warranty/maintenance/calibration, field/offline evidence, SoD, concurrency, idempotency, reversal/reconciliation, accessibility and scale. No material enterprise expectation is silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F265-CAP-001` — Gain / loss on disposal MUST provide deterministic gain/loss on disposal derived from authoritative proceeds/disposal cost/carrying value at effective date.
- `F265-CAP-002` — Gain / loss on disposal MUST define lifecycle/state, effective dating, authorization, approvals, corrections/reversal and immutable history where facts are financial or compliance relevant.
- `F265-CAP-003` — Gain / loss on disposal MUST expose auditable public contracts/events and evidence needed for Procurement, Stock, Projects, Manufacturing, HR and Accounting interactions without direct private-table mutation.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F265-FR-001` — Authorized users MUST be able to execute the primary Gain / loss on disposal lifecycle with actionable validation, explicit state and durable audit evidence.
- `F265-FR-002` — Users MUST be able to search, filter, inspect exceptions/history/related records for Gain / loss on disposal and resolve eligible exceptions without bypassing controls.
- `F265-FR-003` — Approved or posted Gain / loss on disposal facts MUST be corrected through controlled amendment/reversal/reopen mechanisms rather than silent destructive edits.
- `F265-US-001` — As an asset operator, I can perform Gain / loss on disposal from a focused workspace and understand status, ownership, next action and downstream effect.
- `F265-US-002` — As a controller/auditor, I can prove who changed or approved Gain / loss on disposal, why, under which effective date/book/company, and how it reconciles downstream.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F265-FLOW-001` — The primary Gain / loss on disposal flow MUST validate prerequisites -> authorize -> lock/version relevant records -> apply one atomic domain transition -> audit -> emit idempotent downstream intent -> show outcome.
- `F265-FLOW-002` — Gain / loss on disposal MUST cover invalid source, stale version, duplicate request, permission denial, closed period, partial downstream failure, retry, cancellation/reversal and reconciliation without duplicated business effect.

Lifecycle reference: `draft -> pending approval -> approved -> completed/posted -> reversed/corrected under policy`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Assets domain service for **Gain / loss on disposal**.
- Lifecycle: `draft -> pending approval -> approved -> completed/posted -> reversed/corrected under policy`.
- Transitions require current state/version, authorization, effective date, applicable custody/maintenance/accounting/period guards.
- Approved/posted/compliance-significant history is corrected via linked reversal/reopen/revision, not silent overwrite.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F265-DATA-001` — Gain / loss on disposal MUST persist stable identifiers, organization/company scope, asset/category/source references, status, effective dates, actor/version and feature-specific values required for deterministic gain/loss on disposal derived from authoritative proceeds/disposal cost/carrying value at effective date.
- `F265-DATA-002` — Gain / loss on disposal MUST retain lineage to source procurement/accounting/maintenance/inspection/disposal records, attachments/evidence, approvals, reversals and correlation/idempotency identifiers where applicable.

## [SPEC-VALIDATION] Validation rules
- `F265-VAL-001` — Gain / loss on disposal MUST reject malformed identifiers, invalid dates/amounts/units, inactive references, cross-company references, duplicate identities and impossible lifecycle combinations with actionable errors.
- `F265-VAL-002` — Gain / loss on disposal MUST validate current asset state, open assignments/maintenance/verification obligations, book/period status and downstream eligibility before committing a controlled transition.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F265-BR-001` — Gain / loss on disposal MUST obey authoritative asset lifecycle, company/book/effective-date, valuation, custody/maintenance and period rules; AI or UI state cannot override these invariants.
- `F265-BR-002` — Once Gain / loss on disposal creates an approved, posted, completed or compliance-significant fact, history MUST remain immutable and corrections MUST link to the original fact.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F265-CALC-001` — Gain/loss MUST be reproducible from authoritative disposal proceeds less disposal costs less carrying amount relieved at the disposal effective date, with currency/tax/accounting treatment delegated to Accounting.

## [SPEC-VIEWS] Required view archetypes
- `F265-UX-001` — Desktop UX for Gain / loss on disposal MUST expose identity/status, key facts, exception banners, related records, audit and eligible actions without forcing operators through generic CRUD screens.
- `F265-UX-002` — Mobile/tablet UX for Gain / loss on disposal MUST support field-relevant scan/search, large touch targets, evidence/photo/document capture where applicable, explicit offline boundary and conflict-safe sync.
- `F265-UX-003` — Gain / loss on disposal MUST meet WCAG 2.2 AA intent with semantic labels, keyboard/focus order, announced errors/status, non-color-only state, target sizing and non-drag alternatives.

Applicable archetypes include asset register, 360/detail, exception queue, maintenance board/calendar, depreciation ledger/schedule, verification scan queue and reporting/dashboard.

## [SPEC-LIST] List, table and work-queue behavior
Lists/work queues define permission-safe server pagination/sorting, personalized columns/density, status/value/due/exception indicators, bulk eligibility, row actions and virtualization/async thresholds.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search supports asset number/tag/serial/category/location/custodian/department/status/vendor/warranty/maintenance/inspection/book/value fields as authorized, with stable filters, facets, saved views and permission-safe counts.

## [SPEC-DETAIL] Detail / 360 workspace
Asset 360 keeps identity, category, acquisition/source, location/custody, value/books/depreciation, maintenance/downtime/warranty, inspections/calibration, physical verification, disposal and audit/event history together with permission-based sections.

## [SPEC-CREATE] Create and quick-create UX
Create/quick-create defines required/default fields, category/source selection, numbering/tag uniqueness, capitalization threshold/source evidence, validation summary and post-create navigation; quick create cannot bypass lifecycle or accounting controls.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Mutable descriptive/operational fields are distinguished from approved/posted financial/compliance facts. Cost, book, depreciation, revaluation/impairment, disposal, source IDs and signed evidence require governed amendment/reversal rather than silent inline edit.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk assign/transfer/verification/maintenance/report actions show per-record eligibility, preview intended effects, run through individual authorization/domain rules and return partial-result evidence; bulk financial postings use governed batches.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary/contextual/destructive actions are permission/state aware; capitalize, transfer, assign, start/complete maintenance, inspect/calibrate, verify, post depreciation, revalue/impair, sell/scrap/dispose and reverse require confirmation/reason/evidence as policy dictates.

## [SPEC-RELATED] Related records and contextual navigation
Related navigation uses stable public IDs/contracts to procurement sources, stock parts/movements, manufacturing availability, project capex, HR custodian/resource identity, quality references and accounting journals/ledger without private cross-module writes.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F265-AUTO-001` — Background automation for Gain / loss on disposal MAY generate due work, schedules, alerts, draft calculations or integration jobs, but MUST use normal domain authorization/system policy, idempotency, audit and reconciliation controls.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F265-APP-001` — Approval-required Gain / loss on disposal transitions MUST snapshot material evidence/values, record approver/reason/time, block prohibited self-approval and invalidate/re-review when material inputs change.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F265-NOTIF-001` — Gain / loss on disposal notifications MUST be event-driven, deduplicated, permission-safe and actionable for due/overdue, exception, approval, expiry/warranty, maintenance/calibration or reconciliation conditions as applicable.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/generated documents include invoices/receipts, capitalization evidence, handover forms, warranty documents, maintenance records, inspection/calibration certificates, physical-verification evidence and disposal documents; define scanning, versioning, retention, access and provenance.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Import/export/migration defines mapping, preview/dry-run, source/asset identity resolution, duplicate/tag/serial handling, row errors, background thresholds, resumability, permission-safe exports and audit. Historical financial/posted facts require controlled migration modes and reconciliation.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F265-REP-001` — Gain / loss on disposal reporting MUST define metric formulas, as-of/effective-date/book/company scope, permission-safe drilldown, export and reconciliation to authoritative source facts.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F265-AI-001` — AI for Gain / loss on disposal MAY extract documents, classify/analyze anomalies, explain schedules or recommend maintenance/verification priorities, but MUST show provenance/uncertainty and MUST NOT authoritatively determine ledger, depreciation, tax, authorization or legal state transitions.

## [SPEC-SECURITY] Security, permissions and field controls
- `F265-SEC-001` — Every Gain / loss on disposal query/command MUST enforce server-side organization, company/branch/location/record scope plus action permission; unauthorized totals, finance fields, custodian data and documents MUST not leak.
- `F265-SEC-002` — Sensitive Gain / loss on disposal actions MUST enforce maker-checker/SoD policy where configured; creators/requesters/technicians cannot self-approve capitalization, financial posting, impairment/revaluation, disposal or compliance closure when prohibited.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Scope is organization -> company -> branch/site/location -> asset/category/record, with field-level controls for acquisition cost, carrying value, custodian, warranty, maintenance/inspection evidence and accounting references. Cross-company consolidation requires elevated permission and cannot leak unauthorized detail.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time/reason, before/after or immutable event, effective date/book, request/correlation/idempotency IDs, approval/reversal/source links and retention for master, custody, maintenance, verification, value/depreciation and disposal changes.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Use optimistic versions/expected state plus row/advisory locks where financial/assignment/maintenance races matter. Simultaneous transfer/assignment/disposal/depreciation/maintenance actions must not create double custody, duplicate posting or stale carrying value.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Procurement auto-create, depreciation posting, maintenance parts issue, disposal/accounting handoff and other externally visible effects require source-scoped idempotency keys. Replay returns prior outcome/safe no-op; failures remain reconcilable.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F265-INT-001` — Gain / loss on disposal MUST consume external-module facts only through versioned public contracts with source ID, company, effective date, payload validation, authorization/system trust, retry semantics and reconciliation.
- `F265-INT-002` — Gain / loss on disposal MUST publish downstream intent/event with stable source identity and idempotency key; Procurement, Stock, Manufacturing, Projects, HR or Accounting retain ownership of their private state and may reject/reconcile independently.

## [SPEC-API] Commands, queries and API contracts
- `F265-API-001` — Gain / loss on disposal commands MUST define request schema, permission/scope, expected state/version, idempotency where externally visible, domain errors, transaction boundary, audit and downstream effects.
- `F265-API-002` — Gain / loss on disposal queries MUST define pagination/filter/sort, as-of/effective-date semantics where relevant, permission-safe aggregates, stable identifiers and compatibility/versioning behavior.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Phone/tablet supports scan/search, asset 360 summary, assignment/transfer handover, maintenance/repair, inspection/calibration, photo/document capture and physical verification. Offline write support is limited to explicitly safe field drafts/queues with encrypted storage, sync conflict review and server reauthorization.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop provides dense register/ledger/analytics; tablet adapts detail + field workflows; phone uses cards/step flows/scanner. Critical actions retain parity where operationally safe, with sticky action areas and no mandatory horizontal-table interaction.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantic labels, keyboard/focus, screen-reader status, announced validation, contrast, target sizes, reduced motion, accessible scanner fallback/manual code entry and non-drag alternatives.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/ASSETS_PASS7_WORKSPACES.md` for desktop/tablet/mobile asset register/360, maintenance, depreciation, verification/scanner and disposal states.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F265-PERF-001` — Gain / loss on disposal MUST define behavior for 0/1/100/10k/1m relevant rows, server pagination/virtualization, batch/background thresholds and latency budgets so enterprise asset registers/history do not degrade into unbounded scans.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F265-OBS-001` — Gain / loss on disposal MUST emit structured logs/metrics/traces with correlation IDs, job/retry/dead-letter state, business exception counters and reconciliation diagnostics without exposing sensitive financial/custodian data.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover zero/large values, salvage >= cost, zero/changed useful life, backdated acquisition/disposal, leap/month-end conventions, closed periods, duplicate source receipt/invoice, lost/replaced tags, concurrent custody changes, overdue calibration, warranty overlaps, partially failed stock/accounting effects, deleted/archived references, currency/rate gaps and retry/recovery.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- `AST-P7-CODE-035` — verified current-code evidence: `services/api/src/modules/assets/index.js`.
- Evidence is a foundation/implementation observation only; it does not certify the target requirement set.

## [SPEC-GAPS] Exact gap analysis
Target requirements were compared against verified Assets/Accounting source foundations. Existing code covers meaningful register/category/capitalization/assignment/transfer/maintenance/inspection/depreciation/disposal foundations, but broad enterprise certification remains absent for multi-book/effectivity, revaluation/impairment depth, calibration/verification/barcode field workflows, partial lifecycle adjustments, accounting reconciliation, concurrency, mobile/offline, performance and E2E/UAT.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Likely later implementation areas: `database/tenant`, `services/api/src/modules/assets`, `services/api/src/modules/accounting` public contracts, orchestration/worker jobs, `apps/web/src/modules/assets`, mobile/scanner surfaces, permissions/shared types/SDK, integration adapters and comprehensive DB/security/E2E tests. Pass 7 writes documentation only.

## [SPEC-TESTS] Automated test plan
Automated plan covers calculation/property tests for depreciation/value/gain-loss, state-machine tests, DB constraints/RLS/tenant-company isolation, permission-negative/SoD, API contracts, concurrency/idempotency, procurement/stock/manufacturing/HR/accounting integrations, reversal/reconciliation, migration, performance and observability.

## [SPEC-E2E] Browser and critical-journey E2E
- `F265-E2E-001` — Browser/device E2E MUST prove the primary authorized Gain / loss on disposal journey including visible state, persisted data, audit and downstream contract outcome.
- `F265-E2E-002` — E2E MUST prove Gain / loss on disposal permission denial, stale/conflict handling, duplicate/retry behavior and reversal/reconciliation or exception recovery without duplicated effect.

## [SPEC-UAT] Human UAT plan
- `F265-UAT-001` — A realistic asset operator MUST execute Gain / loss on disposal using documented prerequisites/steps and verify visible, data, audit and downstream outcomes with evidence capture.
- `F265-UAT-002` — A controller/auditor MUST independently verify Gain / loss on disposal authorization/SoD, history, calculation/reconciliation and exception/reversal behavior before sign-off.

## [SPEC-DOD] Objective Definition of Done
Done means approved dossier requirements, benchmark + code evidence, capability/dependency/journey mappings, security/SoD, data/API/integration, responsive/mobile/accessibility, test/E2E/UAT and omission/red-team gates are objectively satisfied. A table/API/page alone never qualifies, and specification readiness never certifies product readiness.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder blocks specification readiness. Phased implementation choices such as first-release depreciation books/components/CIP breadth may be narrowed only by explicit change-control decisions without weakening the target enterprise data model.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F265-SEM-01` — **Authoritative calculation scope and triggering lifecycle**: Define when calculation runs, authoritative owner, provisional/final states and whether recalculation is permitted.
- `F265-SEM-02` — **Inputs, bases, dimensions and effective-dated parameters**: Freeze source inputs, rates/bases, currencies/UOMs, effective dates, source snapshots and lineage.
- `F265-SEM-03` — **Formula, precision, rounding and precedence**: Specify deterministic formulas, precision/scale, rounding order, thresholds, caps/floors and configuration precedence.
- `F265-SEM-04` — **Rate/base visibility and calculation authority**: Define who may configure inputs, run/recalculate, approve/finalize and view sensitive results.
- `F265-SEM-05` — **Explanation, preview, variance and correction experience**: Show inputs, derivation, preview, warnings, variance/explanation, recalculation/correction and accessible output.
- `F265-SEM-06` — **Ledger/stock/payroll/project downstream consequence**: Define authoritative handoff, posting date, idempotency, source reference and reconciliation to downstream truth.
- `F265-SEM-07` — **Backdating, stale inputs, retroactivity and reversal**: Handle changed rates, locked periods, retroactive changes, duplicate runs, partial failure and controlled reversal.
- `F265-SEM-08` — **Golden, property, reconciliation and regression tests**: Require formula goldens, boundary/property tests, precision/serialization tests, reconciliation, E2E and UAT.

Cross-module context: **Procurement;HR & Payroll;Projects;Accounting / Finance**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP019;SP022;SP024;SP030;SP031;SP033;SP034`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.
