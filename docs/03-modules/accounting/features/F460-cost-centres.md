# F460 — Cost centres

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F460`
- Canonical name: **Cost centres**
- Module: **Accounting / Finance**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `ACC-CAP-001`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
For **Cost centres**, define and verify business purpose, accounting owner and explicit non-goals. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-OUTCOMES] Business outcomes and success measures
For **Cost centres**, define and verify measurable financial-control, operator, reconciliation and data-quality outcomes. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-PERSONAS] Personas and jobs to be done
For **Cost centres**, define and verify accountant/controller/CFO/AP/AR/treasury/tax/auditor jobs, authority and negative permissions. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
For **Cost centres**, define and verify finance navigation, work queues, search, drilldown and deep-link authorization. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-BENCHMARK] Benchmark research evidence
Official benchmark evidence: `ACC-P12-BM-008-A`, `ACC-P12-BM-008-B`. Tax/legal values remain dated configuration from authoritative sources.

## [SPEC-DECISION] Vercentlabs benchmark decisions
For **Cost centres**, define and verify benchmark disposition, deterministic authority and public-contract boundaries. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-OMISSION-GATE] Enterprise omission gate
For **Cost centres**, define and verify mature ERP omissions including close, reversal, reconciliation, multi-company/currency, tax, audit and failure recovery. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
Parent capability `ACC-CAP-001`. Explicit contract: `F460-CAP-001`. All 21 requirement types are materialized in the control-plane register.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
Functional/user contracts: `F460-FR-001`, `F460-FR-002`, `F460-FR-003`, `F460-US-001`.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
Flow contracts: `F460-FLOW-001`, `F460-FLOW-002`, `F460-FLOW-003`.

## [SPEC-STATE-MACHINE] State machine and transition rules
For **Cost centres**, define and verify aggregate states, approval/post/reverse/close guards, terminal/reopen behavior and immutable history. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-DATA] Data model, entities, relationships and fields
Data contracts: `F460-DATA-001`, `F460-DATA-002`.

## [SPEC-VALIDATION] Validation rules
Validation contracts: `F460-VAL-001`, `F460-VAL-002`.

## [SPEC-BUSINESS-RULES] Business rules and invariants
Business-rule contracts: `F460-BR-001`, `F460-BR-002`.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
Calculation contract: `F460-CALC-001`. Money/rates use explicit precision/rounding and JSON-safe decimal serialization.

## [SPEC-VIEWS] Required view archetypes
UX contracts: `F460-UX-001`, `F460-UX-002`.

## [SPEC-LIST] List, table and work-queue behavior
For **Cost centres**, define and verify server pagination/filter/sort, safe counts, bulk preflight, exception queues and large-ledger virtualization. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-SEARCH] Search, filters, sorting and saved views
For **Cost centres**, define and verify authorization-aware account/document/reference search with stable filters and safe aggregates. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-DETAIL] Detail / 360 workspace
For **Cost centres**, define and verify source-to-posting 360 detail, approvals, allocations, settlement, reconciliation and audit drilldown. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CREATE] Create and quick-create UX
For **Cost centres**, define and verify number/source identity, duplicate detection, period/account validation and idempotent creation. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-EDIT] Edit, inline edit and immutable fields
For **Cost centres**, define and verify draft edit, immutable posted fields, stale-write protection and controlled correction/reversal. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-BULK] Bulk actions and selection semantics
For **Cost centres**, define and verify per-record authorization/state/period preflight, bounded batches and explicit partial outcomes. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
For **Cost centres**, define and verify risk/state-aware primary/destructive actions with reason, approval and returned posting/audit references. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-RELATED] Related records and contextual navigation
For **Cost centres**, define and verify permission-safe public relationships to customer/supplier/order/receipt/stock/payroll/assets/project/POS source records. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
Automation contract: `F460-AUTO-001`.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
Approval contracts: `F460-APP-001`, `F460-APP-002`.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
Notification contract: `F460-NOTIF-001`.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
For **Cost centres**, define and verify permissioned/versioned invoices/statements/reports/attachments/templates with retention and audit. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
For **Cost centres**, define and verify preview/dry-run, schema/duplicate validation, decimal-safe serialization, per-row errors, source hash and audit. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
Reporting contract: `F460-REP-001`.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
AI contracts: `F460-AI-001`, `F460-AI-002`; ledger/tax/payment/authorization/period truth remains deterministic.

## [SPEC-SECURITY] Security, permissions and field controls
Security contracts: `F460-SEC-001`, `F460-SEC-002`.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
For **Cost centres**, define and verify tenant/company/ledger/branch/dimension/account/record scope and cross-company privilege boundaries. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-AUDIT] Auditability and history
For **Cost centres**, define and verify actor/time/reason/source/correlation/approval/posting/period/reversal/reconciliation evidence without secrets. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
For **Cost centres**, define and verify row/version locks for posting, allocation, reconciliation, close and report snapshot races. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
For **Cost centres**, define and verify stable source/external identities for invoices, payments, bank imports, journals, callbacks, reversals and outbox effects. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
Integration contracts: `F460-INT-001`, `F460-INT-002`.

## [SPEC-API] Commands, queries and API contracts
API contract: `F460-API-001`; monetary values/rates use explicit JSON-safe decimal representations rather than raw BigInt.

## [SPEC-MOBILE] Mobile-specific and offline behavior
For **Cost centres**, define and verify mobile approval/read/exception workflows without exposing unsupported full ledger editing. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-RESPONSIVE] Responsive behavior
For **Cost centres**, define and verify desktop/tablet/phone reflow preserving critical approvals, exceptions, reports and drilldown. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ACCESSIBILITY] Accessibility contract
For **Cost centres**, define and verify WCAG 2.2 AA semantics, keyboard/focus, accessible grids/errors/status and non-drag alternatives. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
For **Cost centres**, define and verify desktop/tablet/mobile workspaces plus posting/reconciliation/close/consolidation data-flow diagrams. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
Performance contracts: `F460-PERF-001`, `F460-PERF-002`.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
Observability contracts: `F460-OBS-001`, `F460-OBS-002`.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
For **Cost centres**, define and verify zero/negative/large amounts, rounding, duplicate sources, stale periods/rates, partial integrations, retries, reversals, cross-company and timezone failures. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Current-code evidence `ACC-P12-CE-008` is foundation/gap evidence only and does not certify complete behavior. The audit retains the known money/BigInt JSON boundary as an implementation-risk item.

## [SPEC-GAPS] Exact gap analysis
For **Cost centres**, define and verify target minus verified current evidence, including exact missing financial-control and reconciliation behavior. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
For **Cost centres**, define and verify later DB/domain/orchestration/web/worker/reporting/test areas and dependency order without product-source changes in this pass. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-TESTS] Automated test plan
Automated verification includes double-entry/property/golden tests, decimal/rounding/JSON-boundary tests, DB/RLS/SoD negatives, idempotency/race/fault injection, period-close conflicts, subledger/GL/bank/tax reconciliation, migration/opening-balance and performance tests.

## [SPEC-E2E] Browser and critical-journey E2E
E2E contracts: `F460-E2E-001`, `F460-E2E-002`.

## [SPEC-UAT] Human UAT plan
UAT contracts: `F460-UAT-001`, `F460-UAT-002`.

## [SPEC-DOD] Objective Definition of Done
Specification done requires complete requirements/flows/data/security/integration/UX/test/UAT and omission review. This does not certify implementation or Product Ready.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No material placeholder remains for module specification readiness. Tax rates/thresholds/forms, exchange-rate sources, reporting mappings and jurisdiction rules remain governed effective-dated configuration. Enterprise omission audit remains mandatory before architecture freeze.
