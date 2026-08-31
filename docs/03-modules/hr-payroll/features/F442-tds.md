# F442 — TDS

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F442`
- Canonical name: **TDS**
- Module: **HR & Payroll**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `HR-CAP-008`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
For **TDS**, define and verify business purpose and explicit non-goals. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-OUTCOMES] Business outcomes and success measures
For **TDS**, define and verify measurable operator/control outcomes. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-PERSONAS] Personas and jobs to be done
For **TDS**, define and verify personas, jobs, authority and negative permissions. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
For **TDS**, define and verify navigation, inboxes, search and deep-link authorization. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-BENCHMARK] Benchmark research evidence
Official benchmark evidence: `HR-P11-BM-062-A`, `HR-P11-BM-062-B`. Statutory values remain dated configuration backed by authoritative sources.

## [SPEC-DECISION] Vercentlabs benchmark decisions
For **TDS**, define and verify benchmark disposition and deterministic authority. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-OMISSION-GATE] Enterprise omission gate
For **TDS**, define and verify enterprise omissions, concurrency, privacy, correction, statutory and failure recovery. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
Parent capability `HR-CAP-008`. Explicit contract: `F442-CAP-001`. All 21 requirement types are materialized in the control-plane register.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
Functional/user contracts: `F442-FR-001`, `F442-FR-002`, `F442-FR-003`, `F442-US-001`.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
Flow contracts: `F442-FLOW-001`, `F442-FLOW-002`, `F442-FLOW-003`.

## [SPEC-STATE-MACHINE] State machine and transition rules
For **TDS**, define and verify aggregate owner, states, transition guards, correction/reopen and history. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-DATA] Data model, entities, relationships and fields
Data contracts: `F442-DATA-001`, `F442-DATA-002`.

## [SPEC-VALIDATION] Validation rules
Validation contracts: `F442-VAL-001`, `F442-VAL-002`.

## [SPEC-BUSINESS-RULES] Business rules and invariants
Business-rule contracts: `F442-BR-001`, `F442-BR-002`.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
Calculation contract: `F442-CALC-001`.

## [SPEC-VIEWS] Required view archetypes
UX contracts: `F442-UX-001`, `F442-UX-002`.

## [SPEC-LIST] List, table and work-queue behavior
For **TDS**, define and verify server pagination/filter/sort, saved views, safe counts, bulk preflight and virtualization. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-SEARCH] Search, filters, sorting and saved views
For **TDS**, define and verify authorization-aware search with sensitive-data exclusion. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-DETAIL] Detail / 360 workspace
For **TDS**, define and verify 360/detail history, approvals, source versions and permitted actions. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-CREATE] Create and quick-create UX
For **TDS**, define and verify uniqueness, effective-date and idempotent creation. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-EDIT] Edit, inline edit and immutable fields
For **TDS**, define and verify effective-dated change, stale-write protection and controlled corrections. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-BULK] Bulk actions and selection semantics
For **TDS**, define and verify per-record authorization/state preflight and explicit partial outcomes. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
For **TDS**, define and verify risk/state-aware commands, confirmations, reasons and returned audit references. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-RELATED] Related records and contextual navigation
For **TDS**, define and verify permission-safe public cross-module relationships. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
Automation contract: `F442-AUTO-001`.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
Approval contracts: `F442-APP-001`, `F442-APP-002`.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
Notification contract: `F442-NOTIF-001`.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
For **TDS**, define and verify permissioned, versioned, retained and auditable documents. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
For **TDS**, define and verify preview/dry-run, validation, masking, per-row errors and audit. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
Reporting contract: `F442-REP-001`.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
AI contracts: `F442-AI-001`, `F442-AI-002`; deterministic payroll/statutory/authorization truth remains authoritative.

## [SPEC-SECURITY] Security, permissions and field controls
Security contracts: `F442-SEC-001`, `F442-SEC-002`.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
For **TDS**, define and verify tenant/company/branch/manager/employee/record scoping. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-AUDIT] Auditability and history
For **TDS**, define and verify actor/time/reason/effective-date/correlation/approval/run references without secrets. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
For **TDS**, define and verify version/row-lock semantics for overlapping changes and payroll transitions. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
For **TDS**, define and verify stable keys for conversion, punches, payroll, bank/accounting/statutory effects. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
Integration contracts: `F442-INT-001`, `F442-INT-002`.

## [SPEC-API] Commands, queries and API contracts
API contract: `F442-API-001`.

## [SPEC-MOBILE] Mobile-specific and offline behavior
For **TDS**, define and verify mobile ESS/manager workflows and constrained sync-safe attendance. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-RESPONSIVE] Responsive behavior
For **TDS**, define and verify desktop/tablet/phone reflow preserving critical actions/evidence. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-ACCESSIBILITY] Accessibility contract
For **TDS**, define and verify WCAG 2.2 AA keyboard, focus, semantics, status, errors, target size and non-drag alternatives. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
For **TDS**, define and verify desktop/tablet/mobile wireframes and state/data-flow evidence. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
Performance contracts: `F442-PERF-001`, `F442-PERF-002`.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
Observability contracts: `F442-OBS-001`, `F442-OBS-002`.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
For **TDS**, define and verify leap days, timezones, mid-period join/separate, retro changes, duplicates, stale permissions and partial failures. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Current-code evidence `HR-P11-CE-062` is foundation/gap evidence only and does not certify complete behavior.

## [SPEC-GAPS] Exact gap analysis
For **TDS**, define and verify target minus verified current evidence with missing behavior explicit. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
For **TDS**, define and verify later database/domain/orchestration/web/mobile/worker/test areas without source changes in this pass. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-TESTS] Automated test plan
Automated verification includes payroll golden/property tests where applicable, DB/RLS/field-security negatives, API/contract, effective-date/statutory, idempotency/race, reconciliation, performance and fault-injection tests.

## [SPEC-E2E] Browser and critical-journey E2E
E2E contracts: `F442-E2E-001`, `F442-E2E-002`.

## [SPEC-UAT] Human UAT plan
UAT contracts: `F442-UAT-001`, `F442-UAT-002`.

## [SPEC-DOD] Objective Definition of Done
Specification done requires complete requirements/flows/data/security/integration/UX/test/UAT and omission review. This does not certify implementation or Product Ready.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No material unresolved placeholder remains for specification readiness. Statutory rates/ceilings/forms remain maintained effective-dated configuration from authoritative sources.
