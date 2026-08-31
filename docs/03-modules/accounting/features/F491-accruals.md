# F491 — Accruals

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F491`
- Canonical name: **Accruals**
- Module: **Accounting / Finance**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `ACC-CAP-006`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
For **Accruals**, define and verify business purpose, accounting owner and explicit non-goals. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-OUTCOMES] Business outcomes and success measures
For **Accruals**, define and verify measurable financial-control, operator, reconciliation and data-quality outcomes. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-PERSONAS] Personas and jobs to be done
For **Accruals**, define and verify accountant/controller/CFO/AP/AR/treasury/tax/auditor jobs, authority and negative permissions. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
For **Accruals**, define and verify finance navigation, work queues, search, drilldown and deep-link authorization. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-BENCHMARK] Benchmark research evidence
Official benchmark evidence: `ACC-P12-BM-039-A`, `ACC-P12-BM-039-B`. Tax/legal values remain dated configuration from authoritative sources.

## [SPEC-DECISION] Vercentlabs benchmark decisions
For **Accruals**, define and verify benchmark disposition, deterministic authority and public-contract boundaries. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-OMISSION-GATE] Enterprise omission gate
For **Accruals**, define and verify mature ERP omissions including close, reversal, reconciliation, multi-company/currency, tax, audit and failure recovery. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
Parent capability `ACC-CAP-006`. Explicit contract: `F491-CAP-001`. All 21 requirement types are materialized in the control-plane register.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
Functional/user contracts: `F491-FR-001`, `F491-FR-002`, `F491-FR-003`, `F491-US-001`.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
Flow contracts: `F491-FLOW-001`, `F491-FLOW-002`, `F491-FLOW-003`.

## [SPEC-STATE-MACHINE] State machine and transition rules
For **Accruals**, define and verify aggregate states, approval/post/reverse/close guards, terminal/reopen behavior and immutable history. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-DATA] Data model, entities, relationships and fields
Data contracts: `F491-DATA-001`, `F491-DATA-002`.

## [SPEC-VALIDATION] Validation rules
Validation contracts: `F491-VAL-001`, `F491-VAL-002`.

## [SPEC-BUSINESS-RULES] Business rules and invariants
Business-rule contracts: `F491-BR-001`, `F491-BR-002`.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
Calculation contract: `F491-CALC-001`. Money/rates use explicit precision/rounding and JSON-safe decimal serialization.

## [SPEC-VIEWS] Required view archetypes
UX contracts: `F491-UX-001`, `F491-UX-002`.

## [SPEC-LIST] List, table and work-queue behavior
For **Accruals**, define and verify server pagination/filter/sort, safe counts, bulk preflight, exception queues and large-ledger virtualization. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-SEARCH] Search, filters, sorting and saved views
For **Accruals**, define and verify authorization-aware account/document/reference search with stable filters and safe aggregates. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-DETAIL] Detail / 360 workspace
For **Accruals**, define and verify source-to-posting 360 detail, approvals, allocations, settlement, reconciliation and audit drilldown. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CREATE] Create and quick-create UX
For **Accruals**, define and verify number/source identity, duplicate detection, period/account validation and idempotent creation. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-EDIT] Edit, inline edit and immutable fields
For **Accruals**, define and verify draft edit, immutable posted fields, stale-write protection and controlled correction/reversal. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-BULK] Bulk actions and selection semantics
For **Accruals**, define and verify per-record authorization/state/period preflight, bounded batches and explicit partial outcomes. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
For **Accruals**, define and verify risk/state-aware primary/destructive actions with reason, approval and returned posting/audit references. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-RELATED] Related records and contextual navigation
For **Accruals**, define and verify permission-safe public relationships to customer/supplier/order/receipt/stock/payroll/assets/project/POS source records. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
Automation contract: `F491-AUTO-001`.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
Approval contracts: `F491-APP-001`, `F491-APP-002`.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
Notification contract: `F491-NOTIF-001`.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
For **Accruals**, define and verify permissioned/versioned invoices/statements/reports/attachments/templates with retention and audit. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
For **Accruals**, define and verify preview/dry-run, schema/duplicate validation, decimal-safe serialization, per-row errors, source hash and audit. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
Reporting contract: `F491-REP-001`.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
AI contracts: `F491-AI-001`, `F491-AI-002`; ledger/tax/payment/authorization/period truth remains deterministic.

## [SPEC-SECURITY] Security, permissions and field controls
Security contracts: `F491-SEC-001`, `F491-SEC-002`.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
For **Accruals**, define and verify tenant/company/ledger/branch/dimension/account/record scope and cross-company privilege boundaries. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-AUDIT] Auditability and history
For **Accruals**, define and verify actor/time/reason/source/correlation/approval/posting/period/reversal/reconciliation evidence without secrets. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
For **Accruals**, define and verify row/version locks for posting, allocation, reconciliation, close and report snapshot races. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
For **Accruals**, define and verify stable source/external identities for invoices, payments, bank imports, journals, callbacks, reversals and outbox effects. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
Integration contracts: `F491-INT-001`, `F491-INT-002`.

## [SPEC-API] Commands, queries and API contracts
API contract: `F491-API-001`; monetary values/rates use explicit JSON-safe decimal representations rather than raw BigInt.

## [SPEC-MOBILE] Mobile-specific and offline behavior
For **Accruals**, define and verify mobile approval/read/exception workflows without exposing unsupported full ledger editing. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-RESPONSIVE] Responsive behavior
For **Accruals**, define and verify desktop/tablet/phone reflow preserving critical approvals, exceptions, reports and drilldown. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ACCESSIBILITY] Accessibility contract
For **Accruals**, define and verify WCAG 2.2 AA semantics, keyboard/focus, accessible grids/errors/status and non-drag alternatives. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
For **Accruals**, define and verify desktop/tablet/mobile workspaces plus posting/reconciliation/close/consolidation data-flow diagrams. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
Performance contracts: `F491-PERF-001`, `F491-PERF-002`.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
Observability contracts: `F491-OBS-001`, `F491-OBS-002`.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
For **Accruals**, define and verify zero/negative/large amounts, rounding, duplicate sources, stale periods/rates, partial integrations, retries, reversals, cross-company and timezone failures. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Current-code evidence `ACC-P12-CE-039` is foundation/gap evidence only and does not certify complete behavior. The audit retains the known money/BigInt JSON boundary as an implementation-risk item.

## [SPEC-GAPS] Exact gap analysis
For **Accruals**, define and verify target minus verified current evidence, including exact missing financial-control and reconciliation behavior. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
For **Accruals**, define and verify later DB/domain/orchestration/web/worker/reporting/test areas and dependency order without product-source changes in this pass. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-TESTS] Automated test plan
Automated verification includes double-entry/property/golden tests, decimal/rounding/JSON-boundary tests, DB/RLS/SoD negatives, idempotency/race/fault injection, period-close conflicts, subledger/GL/bank/tax reconciliation, migration/opening-balance and performance tests.

## [SPEC-E2E] Browser and critical-journey E2E
E2E contracts: `F491-E2E-001`, `F491-E2E-002`.

## [SPEC-UAT] Human UAT plan
UAT contracts: `F491-UAT-001`, `F491-UAT-002`.

## [SPEC-DOD] Objective Definition of Done
Specification done requires complete requirements/flows/data/security/integration/UX/test/UAT and omission review. This does not certify implementation or Product Ready.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No material placeholder remains for module specification readiness. Tax rates/thresholds/forms, exchange-rate sources, reporting mappings and jurisdiction rules remain governed effective-dated configuration. Enterprise omission audit remains mandatory before architecture freeze.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F491-SEM-01` — **Authoritative calculation scope and triggering lifecycle**: Define when calculation runs, authoritative owner, provisional/final states and whether recalculation is permitted.
- `F491-SEM-02` — **Inputs, bases, dimensions and effective-dated parameters**: Freeze source inputs, rates/bases, currencies/UOMs, effective dates, source snapshots and lineage.
- `F491-SEM-03` — **Formula, precision, rounding and precedence**: Specify deterministic formulas, precision/scale, rounding order, thresholds, caps/floors and configuration precedence.
- `F491-SEM-04` — **Rate/base visibility and calculation authority**: Define who may configure inputs, run/recalculate, approve/finalize and view sensitive results.
- `F491-SEM-05` — **Explanation, preview, variance and correction experience**: Show inputs, derivation, preview, warnings, variance/explanation, recalculation/correction and accessible output.
- `F491-SEM-06` — **Ledger/stock/payroll/project downstream consequence**: Define authoritative handoff, posting date, idempotency, source reference and reconciliation to downstream truth.
- `F491-SEM-07` — **Backdating, stale inputs, retroactivity and reversal**: Handle changed rates, locked periods, retroactive changes, duplicate runs, partial failure and controlled reversal.
- `F491-SEM-08` — **Golden, property, reconciliation and regression tests**: Require formula goldens, boundary/property tests, precision/serialization tests, reconciliation, E2E and UAT.

Cross-module context: **Sales;Procurement;Stock / Inventory;Manufacturing;Projects;Assets;Point of Sale;HR & Payroll**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP019;SP022;SP023;SP024;SP027;SP030;SP031;SP033;SP036`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F491-PFC-01`, `F491-PFC-02`, `F491-PFC-03`, `F491-PFC-04`, `F491-PFC-05`, `F491-PFC-06`, `F491-PFC-07`, `F491-PFC-08`, `F491-PFC-09`, `F491-PFC-10`
- State transition IDs: `F491-STM-01`, `F491-STM-02`, `F491-STM-03`, `F491-STM-04`, `F491-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F491-1`; `PFD-BM-F491-2`
- The Pass D mappings are the implementation-planning benchmark authority for **Accruals**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
