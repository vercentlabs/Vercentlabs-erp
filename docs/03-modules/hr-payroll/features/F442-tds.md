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

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F442-SEM-01` — **Authoritative calculation scope and triggering lifecycle**: Define when calculation runs, authoritative owner, provisional/final states and whether recalculation is permitted. Jurisdiction rules must be effective-dated/configurable and never treated as timeless constants.
- `F442-SEM-02` — **Inputs, bases, dimensions and effective-dated parameters**: Freeze source inputs, rates/bases, currencies/UOMs, effective dates, source snapshots and lineage.
- `F442-SEM-03` — **Formula, precision, rounding and precedence**: Specify deterministic formulas, precision/scale, rounding order, thresholds, caps/floors and configuration precedence. Jurisdiction rules must be effective-dated/configurable and never treated as timeless constants.
- `F442-SEM-04` — **Rate/base visibility and calculation authority**: Define who may configure inputs, run/recalculate, approve/finalize and view sensitive results.
- `F442-SEM-05` — **Explanation, preview, variance and correction experience**: Show inputs, derivation, preview, warnings, variance/explanation, recalculation/correction and accessible output.
- `F442-SEM-06` — **Ledger/stock/payroll/project downstream consequence**: Define authoritative handoff, posting date, idempotency, source reference and reconciliation to downstream truth. Jurisdiction rules must be effective-dated/configurable and never treated as timeless constants.
- `F442-SEM-07` — **Backdating, stale inputs, retroactivity and reversal**: Handle changed rates, locked periods, retroactive changes, duplicate runs, partial failure and controlled reversal. Jurisdiction rules must be effective-dated/configurable and never treated as timeless constants.
- `F442-SEM-08` — **Golden, property, reconciliation and regression tests**: Require formula goldens, boundary/property tests, precision/serialization tests, reconciliation, E2E and UAT.

Cross-module context: **Projects;Assets;Accounting / Finance**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP017;SP019;SP023;SP024;SP028;SP030;SP033;SP034;SP036`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F442-PFC-01`, `F442-PFC-02`, `F442-PFC-03`, `F442-PFC-04`, `F442-PFC-05`, `F442-PFC-06`, `F442-PFC-07`, `F442-PFC-08`, `F442-PFC-09`, `F442-PFC-10`
- State transition IDs: `F442-STM-01`, `F442-STM-02`, `F442-STM-03`, `F442-STM-04`, `F442-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F442-1`; `PFD-BM-F442-2`
- The Pass D mappings are the implementation-planning benchmark authority for **TDS**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
