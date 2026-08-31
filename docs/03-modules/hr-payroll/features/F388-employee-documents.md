# F388 — Employee documents

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F388`
- Canonical name: **Employee documents**
- Module: **HR & Payroll**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `HR-CAP-001`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
For **Employee documents**, define and verify business purpose and explicit non-goals. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-OUTCOMES] Business outcomes and success measures
For **Employee documents**, define and verify measurable operator/control outcomes. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-PERSONAS] Personas and jobs to be done
For **Employee documents**, define and verify personas, jobs, authority and negative permissions. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
For **Employee documents**, define and verify navigation, inboxes, search and deep-link authorization. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-BENCHMARK] Benchmark research evidence
Official benchmark evidence: `HR-P11-BM-008-A`, `HR-P11-BM-008-B`. Statutory values remain dated configuration backed by authoritative sources.

## [SPEC-DECISION] Vercentlabs benchmark decisions
For **Employee documents**, define and verify benchmark disposition and deterministic authority. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-OMISSION-GATE] Enterprise omission gate
For **Employee documents**, define and verify enterprise omissions, concurrency, privacy, correction, statutory and failure recovery. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
Parent capability `HR-CAP-001`. Explicit contract: `F388-CAP-001`. All 21 requirement types are materialized in the control-plane register.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
Functional/user contracts: `F388-FR-001`, `F388-FR-002`, `F388-FR-003`, `F388-US-001`.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
Flow contracts: `F388-FLOW-001`, `F388-FLOW-002`, `F388-FLOW-003`.

## [SPEC-STATE-MACHINE] State machine and transition rules
For **Employee documents**, define and verify aggregate owner, states, transition guards, correction/reopen and history. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-DATA] Data model, entities, relationships and fields
Data contracts: `F388-DATA-001`, `F388-DATA-002`.

## [SPEC-VALIDATION] Validation rules
Validation contracts: `F388-VAL-001`, `F388-VAL-002`.

## [SPEC-BUSINESS-RULES] Business rules and invariants
Business-rule contracts: `F388-BR-001`, `F388-BR-002`.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
Calculation contract: `F388-CALC-001`.

## [SPEC-VIEWS] Required view archetypes
UX contracts: `F388-UX-001`, `F388-UX-002`.

## [SPEC-LIST] List, table and work-queue behavior
For **Employee documents**, define and verify server pagination/filter/sort, saved views, safe counts, bulk preflight and virtualization. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-SEARCH] Search, filters, sorting and saved views
For **Employee documents**, define and verify authorization-aware search with sensitive-data exclusion. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-DETAIL] Detail / 360 workspace
For **Employee documents**, define and verify 360/detail history, approvals, source versions and permitted actions. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-CREATE] Create and quick-create UX
For **Employee documents**, define and verify uniqueness, effective-date and idempotent creation. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-EDIT] Edit, inline edit and immutable fields
For **Employee documents**, define and verify effective-dated change, stale-write protection and controlled corrections. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-BULK] Bulk actions and selection semantics
For **Employee documents**, define and verify per-record authorization/state preflight and explicit partial outcomes. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
For **Employee documents**, define and verify risk/state-aware commands, confirmations, reasons and returned audit references. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-RELATED] Related records and contextual navigation
For **Employee documents**, define and verify permission-safe public cross-module relationships. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
Automation contract: `F388-AUTO-001`.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
Approval contracts: `F388-APP-001`, `F388-APP-002`.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
Notification contract: `F388-NOTIF-001`.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
For **Employee documents**, define and verify permissioned, versioned, retained and auditable documents. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
For **Employee documents**, define and verify preview/dry-run, validation, masking, per-row errors and audit. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
Reporting contract: `F388-REP-001`.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
AI contracts: `F388-AI-001`, `F388-AI-002`; deterministic payroll/statutory/authorization truth remains authoritative.

## [SPEC-SECURITY] Security, permissions and field controls
Security contracts: `F388-SEC-001`, `F388-SEC-002`.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
For **Employee documents**, define and verify tenant/company/branch/manager/employee/record scoping. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-AUDIT] Auditability and history
For **Employee documents**, define and verify actor/time/reason/effective-date/correlation/approval/run references without secrets. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
For **Employee documents**, define and verify version/row-lock semantics for overlapping changes and payroll transitions. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
For **Employee documents**, define and verify stable keys for conversion, punches, payroll, bank/accounting/statutory effects. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
Integration contracts: `F388-INT-001`, `F388-INT-002`.

## [SPEC-API] Commands, queries and API contracts
API contract: `F388-API-001`.

## [SPEC-MOBILE] Mobile-specific and offline behavior
For **Employee documents**, define and verify mobile ESS/manager workflows and constrained sync-safe attendance. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-RESPONSIVE] Responsive behavior
For **Employee documents**, define and verify desktop/tablet/phone reflow preserving critical actions/evidence. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-ACCESSIBILITY] Accessibility contract
For **Employee documents**, define and verify WCAG 2.2 AA keyboard, focus, semantics, status, errors, target size and non-drag alternatives. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
For **Employee documents**, define and verify desktop/tablet/mobile wireframes and state/data-flow evidence. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
Performance contracts: `F388-PERF-001`, `F388-PERF-002`.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
Observability contracts: `F388-OBS-001`, `F388-OBS-002`.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
For **Employee documents**, define and verify leap days, timezones, mid-period join/separate, retro changes, duplicates, stale permissions and partial failures. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Current-code evidence `HR-P11-CE-008` is foundation/gap evidence only and does not certify complete behavior.

## [SPEC-GAPS] Exact gap analysis
For **Employee documents**, define and verify target minus verified current evidence with missing behavior explicit. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
For **Employee documents**, define and verify later database/domain/orchestration/web/mobile/worker/test areas without source changes in this pass. Requirement IDs in the control-plane registers are normative and testable; current code never weakens the target.

## [SPEC-TESTS] Automated test plan
Automated verification includes payroll golden/property tests where applicable, DB/RLS/field-security negatives, API/contract, effective-date/statutory, idempotency/race, reconciliation, performance and fault-injection tests.

## [SPEC-E2E] Browser and critical-journey E2E
E2E contracts: `F388-E2E-001`, `F388-E2E-002`.

## [SPEC-UAT] Human UAT plan
UAT contracts: `F388-UAT-001`, `F388-UAT-002`.

## [SPEC-DOD] Objective Definition of Done
Specification done requires complete requirements/flows/data/security/integration/UX/test/UAT and omission review. This does not certify implementation or Product Ready.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No material unresolved placeholder remains for specification readiness. Statutory rates/ceilings/forms remain maintained effective-dated configuration from authoritative sources.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F388-SEM-01` — **Person/candidate/employment lifecycle and effective dating**: Define identity, candidate/employment states, effective-dated changes and immutable historical employment facts.
- `F388-SEM-02` — **Personal, organizational, contractual and document data**: Freeze employee/candidate identifiers, org placement, manager, employment terms, documents and sensitive classifications.
- `F388-SEM-03` — **Eligibility, conversion, transfer/promotion/separation rules**: Define uniqueness, lifecycle guards, probation/confirmation, transfer/promotion effectivity and separation/offboarding prerequisites.
- `F388-SEM-04` — **HR/manager/employee field-level privacy and SoD**: Apply least privilege, field masking, manager scope, ESS boundaries, sensitive payroll/PII protections and audit.
- `F388-SEM-05` — **HR/manager/ESS lifecycle workspace**: Cover create/convert/update/request/approve, documents, timelines, effective-dated previews, responsive/mobile and accessibility.
- `F388-SEM-06` — **Payroll/projects/assets/identity downstream contracts**: Publish effective-dated employment changes through public contracts for payroll, resource planning, custody and access lifecycle.
- `F388-SEM-07` — **Duplicate identity, retro change, manager cycle and offboarding partial failure**: Handle duplicate person, conflicting effective dates, hierarchy cycles, rehire, failed deprovisioning and reconciliation.
- `F388-SEM-08` — **PII, lifecycle, effective-date and integration verification**: Require IDOR/field-leak tests, temporal tests, conversion idempotency, offboarding journeys and UAT.

Cross-module context: **Projects;Assets;Accounting / Finance**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP017;SP019;SP023;SP024;SP028;SP030;SP033;SP034;SP036`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F388-PFC-01`, `F388-PFC-02`, `F388-PFC-03`, `F388-PFC-04`, `F388-PFC-05`, `F388-PFC-06`, `F388-PFC-07`, `F388-PFC-08`, `F388-PFC-09`, `F388-PFC-10`
- State transition IDs: `F388-STM-01`, `F388-STM-02`, `F388-STM-03`, `F388-STM-04`, `F388-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F388-1`; `PFD-BM-F388-2`
- The Pass D mappings are the implementation-planning benchmark authority for **Employee documents**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
