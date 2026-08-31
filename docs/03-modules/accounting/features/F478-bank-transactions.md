# F478 — Bank transactions

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F478`
- Canonical name: **Bank transactions**
- Module: **Accounting / Finance**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `ACC-CAP-004`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
For **Bank transactions**, define and verify business purpose, accounting owner and explicit non-goals. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-OUTCOMES] Business outcomes and success measures
For **Bank transactions**, define and verify measurable financial-control, operator, reconciliation and data-quality outcomes. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-PERSONAS] Personas and jobs to be done
For **Bank transactions**, define and verify accountant/controller/CFO/AP/AR/treasury/tax/auditor jobs, authority and negative permissions. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
For **Bank transactions**, define and verify finance navigation, work queues, search, drilldown and deep-link authorization. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-BENCHMARK] Benchmark research evidence
Official benchmark evidence: `ACC-P12-BM-026-A`, `ACC-P12-BM-026-B`. Tax/legal values remain dated configuration from authoritative sources.

## [SPEC-DECISION] Vercentlabs benchmark decisions
For **Bank transactions**, define and verify benchmark disposition, deterministic authority and public-contract boundaries. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-OMISSION-GATE] Enterprise omission gate
For **Bank transactions**, define and verify mature ERP omissions including close, reversal, reconciliation, multi-company/currency, tax, audit and failure recovery. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
Parent capability `ACC-CAP-004`. Explicit contract: `F478-CAP-001`. All 21 requirement types are materialized in the control-plane register.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
Functional/user contracts: `F478-FR-001`, `F478-FR-002`, `F478-FR-003`, `F478-US-001`.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
Flow contracts: `F478-FLOW-001`, `F478-FLOW-002`, `F478-FLOW-003`.

## [SPEC-STATE-MACHINE] State machine and transition rules
For **Bank transactions**, define and verify aggregate states, approval/post/reverse/close guards, terminal/reopen behavior and immutable history. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-DATA] Data model, entities, relationships and fields
Data contracts: `F478-DATA-001`, `F478-DATA-002`.

## [SPEC-VALIDATION] Validation rules
Validation contracts: `F478-VAL-001`, `F478-VAL-002`.

## [SPEC-BUSINESS-RULES] Business rules and invariants
Business-rule contracts: `F478-BR-001`, `F478-BR-002`.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
Calculation contract: `F478-CALC-001`. Money/rates use explicit precision/rounding and JSON-safe decimal serialization.

## [SPEC-VIEWS] Required view archetypes
UX contracts: `F478-UX-001`, `F478-UX-002`.

## [SPEC-LIST] List, table and work-queue behavior
For **Bank transactions**, define and verify server pagination/filter/sort, safe counts, bulk preflight, exception queues and large-ledger virtualization. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-SEARCH] Search, filters, sorting and saved views
For **Bank transactions**, define and verify authorization-aware account/document/reference search with stable filters and safe aggregates. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-DETAIL] Detail / 360 workspace
For **Bank transactions**, define and verify source-to-posting 360 detail, approvals, allocations, settlement, reconciliation and audit drilldown. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CREATE] Create and quick-create UX
For **Bank transactions**, define and verify number/source identity, duplicate detection, period/account validation and idempotent creation. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-EDIT] Edit, inline edit and immutable fields
For **Bank transactions**, define and verify draft edit, immutable posted fields, stale-write protection and controlled correction/reversal. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-BULK] Bulk actions and selection semantics
For **Bank transactions**, define and verify per-record authorization/state/period preflight, bounded batches and explicit partial outcomes. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
For **Bank transactions**, define and verify risk/state-aware primary/destructive actions with reason, approval and returned posting/audit references. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-RELATED] Related records and contextual navigation
For **Bank transactions**, define and verify permission-safe public relationships to customer/supplier/order/receipt/stock/payroll/assets/project/POS source records. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
Automation contract: `F478-AUTO-001`.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
Approval contracts: `F478-APP-001`, `F478-APP-002`.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
Notification contract: `F478-NOTIF-001`.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
For **Bank transactions**, define and verify permissioned/versioned invoices/statements/reports/attachments/templates with retention and audit. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
For **Bank transactions**, define and verify preview/dry-run, schema/duplicate validation, decimal-safe serialization, per-row errors, source hash and audit. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
Reporting contract: `F478-REP-001`.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
AI contracts: `F478-AI-001`, `F478-AI-002`; ledger/tax/payment/authorization/period truth remains deterministic.

## [SPEC-SECURITY] Security, permissions and field controls
Security contracts: `F478-SEC-001`, `F478-SEC-002`.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
For **Bank transactions**, define and verify tenant/company/ledger/branch/dimension/account/record scope and cross-company privilege boundaries. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-AUDIT] Auditability and history
For **Bank transactions**, define and verify actor/time/reason/source/correlation/approval/posting/period/reversal/reconciliation evidence without secrets. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
For **Bank transactions**, define and verify row/version locks for posting, allocation, reconciliation, close and report snapshot races. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
For **Bank transactions**, define and verify stable source/external identities for invoices, payments, bank imports, journals, callbacks, reversals and outbox effects. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
Integration contracts: `F478-INT-001`, `F478-INT-002`.

## [SPEC-API] Commands, queries and API contracts
API contract: `F478-API-001`; monetary values/rates use explicit JSON-safe decimal representations rather than raw BigInt.

## [SPEC-MOBILE] Mobile-specific and offline behavior
For **Bank transactions**, define and verify mobile approval/read/exception workflows without exposing unsupported full ledger editing. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-RESPONSIVE] Responsive behavior
For **Bank transactions**, define and verify desktop/tablet/phone reflow preserving critical approvals, exceptions, reports and drilldown. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-ACCESSIBILITY] Accessibility contract
For **Bank transactions**, define and verify WCAG 2.2 AA semantics, keyboard/focus, accessible grids/errors/status and non-drag alternatives. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
For **Bank transactions**, define and verify desktop/tablet/mobile workspaces plus posting/reconciliation/close/consolidation data-flow diagrams. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
Performance contracts: `F478-PERF-001`, `F478-PERF-002`.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
Observability contracts: `F478-OBS-001`, `F478-OBS-002`.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
For **Bank transactions**, define and verify zero/negative/large amounts, rounding, duplicate sources, stale periods/rates, partial integrations, retries, reversals, cross-company and timezone failures. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Current-code evidence `ACC-P12-CE-026` is foundation/gap evidence only and does not certify complete behavior. The audit retains the known money/BigInt JSON boundary as an implementation-risk item.

## [SPEC-GAPS] Exact gap analysis
For **Bank transactions**, define and verify target minus verified current evidence, including exact missing financial-control and reconciliation behavior. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
For **Bank transactions**, define and verify later DB/domain/orchestration/web/worker/reporting/test areas and dependency order without product-source changes in this pass. Requirement IDs in the control-plane registers are normative and current code never weakens the target.

## [SPEC-TESTS] Automated test plan
Automated verification includes double-entry/property/golden tests, decimal/rounding/JSON-boundary tests, DB/RLS/SoD negatives, idempotency/race/fault injection, period-close conflicts, subledger/GL/bank/tax reconciliation, migration/opening-balance and performance tests.

## [SPEC-E2E] Browser and critical-journey E2E
E2E contracts: `F478-E2E-001`, `F478-E2E-002`.

## [SPEC-UAT] Human UAT plan
UAT contracts: `F478-UAT-001`, `F478-UAT-002`.

## [SPEC-DOD] Objective Definition of Done
Specification done requires complete requirements/flows/data/security/integration/UX/test/UAT and omission review. This does not certify implementation or Product Ready.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No material placeholder remains for module specification readiness. Tax rates/thresholds/forms, exchange-rate sources, reporting mappings and jurisdiction rules remain governed effective-dated configuration. Enterprise omission audit remains mandatory before architecture freeze.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F478-SEM-01` — **Money-movement lifecycle and processor/bank truth**: Define initiated/pending/authorized/settled/failed/voided/refunded/reconciled states and authoritative external truth.
- `F478-SEM-02` — **Tender/account/allocation/reference model**: Store amount, currency, account/tender, allocation, external reference, idempotency key and immutable reconciliation evidence.
- `F478-SEM-03` — **Amount, allocation, eligibility and settlement rules**: Define allowed methods, partial/split allocation, over/under payment, rounding, settlement dates and policy constraints.
- `F478-SEM-04` — **Payment authority, PCI/PII boundary and SoD**: Minimize sensitive payment data, separate initiate/approve/reconcile authority and protect bank/payment details.
- `F478-SEM-05` — **Initiate, confirm, uncertain-state and reconciliation experience**: Show pending/uncertain outcomes, duplicate prevention, retry guidance, allocation, receipt and accessible operator feedback.
- `F478-SEM-06` — **Gateway/bank/accounting contract**: Define request/response/webhook, signature validation, callback dedupe, posting/outbox and reconciliation contracts.
- `F478-SEM-07` — **Timeout-after-success, replay, reversal and charge/refund races**: Handle unknown outcome, duplicate callback, retry, void/refund replay, partial settlement and exception queue.
- `F478-SEM-08` — **Idempotency, fault-injection and financial reconciliation tests**: Require callback replay, timeout fault injection, duplicate prevention, ledger reconciliation, E2E and UAT.

Cross-module context: **Sales;Procurement;Stock / Inventory;Manufacturing;Projects;Assets;Point of Sale;HR & Payroll**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP019;SP022;SP023;SP024;SP027;SP030;SP031;SP033;SP036`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.
