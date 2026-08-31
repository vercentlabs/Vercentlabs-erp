# F340 — Quality documents

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F340`
- Canonical name: **Quality documents**
- Module: **Quality**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `QUALITY-CAP-007`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Quality documents exists to provide controlled quality documents/SOP/spec attachments with version, approval, effective/obsolete dates, access and reference from inspections/audits/CAPA. Non-goal: Quality does not directly own Stock balances/valuation, Manufacturing execution, Procurement returns/AP, customer support cases or Accounting journals.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Reproducible, evidence-backed outcome for Quality documents.
- Quality exceptions stop unsafe/nonconforming material or process flow before downstream escape.
- Full lineage from source/specification/inspection through hold/disposition/CAPA and downstream reconciliation.

## [SPEC-PERSONAS] Personas and jobs to be done
Primary personas: inspector/technician, quality engineer, quality manager, supplier-quality engineer, auditor/metrology owner, warehouse/production supervisor, procurement/support counterpart and read-only auditor/executive. Negative cases include unauthorized release/use-as-is, self-approval, cross-site access and stale/expired instrument use.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
Entry points include Quality dashboard, plans/control points, inspection work queue, incoming/in-process/final source context, hold/NCR/disposition queue, CAPA board, supplier/customer quality, audits/calibration, traceability, CoA/documents, cost/KPI drilldowns and durable deep links from Procurement/Stock/Manufacturing/Support.

## [SPEC-BENCHMARK] Benchmark research evidence
- `QUALITY-P9-BM-033-A` — captured official-source benchmark evidence.
- `QUALITY-P9-BM-033-B` — captured official-source benchmark evidence.

## [SPEC-DECISION] Vercentlabs benchmark decisions
Pass 9 adopts mature quality-management control patterns as REQUIRED where they protect product/material/evidence truth; vendor-specific screens/objects are not copied and no external certification is claimed. See `DECISION_REGISTER.csv` entries `QUALITY-P9-DEC-*`.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Red-team review for **Quality documents** covered effectivity/version drift, sampling/measurement precision, calibration expiry, duplicate submissions, concurrent hold/release/movement, partial quantities, maker-checker, rework/scrap/RTS/use-as-is, genealogy, document/CoA versioning, CAPA effectiveness, cross-module reconciliation, accessibility and recovery. No unresolved material placeholder remains.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F340-CAP-001` — Quality documents MUST provide controlled quality documents/SOP/spec attachments with version, approval, effective/obsolete dates, access and reference from inspections/audits/CAPA.
- `F340-CAP-002` — Quality documents MUST define version/effectivity, lifecycle/state, company/site/warehouse/plant/team scope, authorization/approval, correction/reversal and immutable evidence where decisions affect material or compliance truth.
- `F340-CAP-003` — Quality documents MUST expose auditable public contracts/events for Procurement, Stock, Manufacturing, Sales/Support, Assets/Calibration and Accounting interactions without direct private-table mutation.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F340-FR-001` — Authorized quality users MUST execute the primary Quality documents lifecycle from a focused quality workspace with explicit source scope, actionable validation and visible downstream effect.
- `F340-FR-002` — Users MUST inspect history, active holds/exceptions, source inspection/NCR/CAPA/lot/instrument evidence and related cross-module effects for Quality documents without leaking unauthorized data.
- `F340-FR-003` — Committed Quality documents evidence MUST be corrected through supersession, release, disposition, reversal, reopen or reconciliation mechanisms rather than silent destructive edits.
- `F340-US-001` — As an authorized inspector/quality operator, I can perform Quality documents, understand the exact standard/specification/source scope and see whether material/process may proceed.
- `F340-US-002` — As a quality manager/auditor, I can prove who decided Quality documents, under which approved version/authority, why, and how it affected inventory, production, supplier/customer and financial evidence.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F340-FLOW-001` — The primary Quality documents flow MUST resolve source context -> approved effective quality rule -> authorize -> lock/version relevant quality/material state -> capture/evaluate evidence -> commit one atomic quality transition -> audit -> emit idempotent public downstream intent/gate -> show outcome.
- `F340-FLOW-002` — Quality documents MUST cover missing/expired specification or calibration, invalid sample/result, permission denial, duplicate submit, concurrent hold/release/movement, stale state, downstream failure, retry, partial disposition, reopen/correction and reconciliation without duplicate business effect.

## [SPEC-STATE-MACHINE] State machine and transition rules
Authoritative state model: `draft -> review -> approved -> effective -> superseded/obsolete/archived; historical references retain exact version`. Every transition requires expected state/version, server authorization, evidence/audit and linked correction/reversal/reopen where history has already become authoritative.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F340-DATA-001` — Quality documents MUST persist stable organization/company/site/warehouse/plant/team/source/item/lot/batch/serial/inspection/NCR/CAPA identifiers, status/version/effectivity, actor/time, quantities/measurements and feature-specific values required for controlled quality documents/SOP/spec attachments with version, approval, effective/obsolete dates, access and reference from inspections/audits/CAPA.
- `F340-DATA-002` — Quality documents MUST retain lineage to source receipt/work order/shipment/return, samples/results, instrument/calibration, defect/NCR/hold/disposition/CAPA, supplier/customer, Stock movements and Accounting/cost references where applicable.

## [SPEC-VALIDATION] Validation rules
- `F340-VAL-001` — Quality documents MUST reject malformed/inactive/cross-company references, invalid quantities/units/limits/sample membership, expired/ineligible instrument, duplicate identities and impossible lifecycle combinations with actionable errors.
- `F340-VAL-002` — Quality documents MUST revalidate current specification/effectivity, source quantity/state, hold/calibration/approval status and downstream movement eligibility immediately before committing a material quality decision.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F340-BR-001` — Quality documents MUST obey authoritative approved specification/tolerance/calibration/hold/disposition/authorization and owning-module Stock/accounting rules; AI/client UI cannot override pass/fail, hold/release, quantity/value or transition legality.
- `F340-BR-002` — Approved/submitted Quality documents evidence MUST preserve exact standard/specification/plan/instrument/source versions and actor/time; corrections/supersessions remain linked to original evidence.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F340-CALC-001` — Quality documents calculations, if numeric, MUST define source units/currency, precision, rounding, effective dates and reproducible formulas; if no authoritative derived numeric result applies, the requirement explicitly records that fact.

## [SPEC-VIEWS] Required view archetypes
- `F340-UX-001` — Quality documents UX MUST expose source identity, applicable spec/checks, sample/result progress, hold/disposition state, exceptions and next safe action without reducing critical inspection work to generic CRUD.
- `F340-UX-002` — Quality documents tablet/mobile UX MUST support barcode/QR/lot/serial scanning, large touch targets, rapid measurement/pass-fail entry, instrument status, offline-safe read/capture boundaries where allowed and explicit sync/conflict recovery.
- `F340-UX-003` — Quality documents MUST target WCAG 2.2 AA with semantic labels, keyboard/focus, announced validation/status/hold state, non-color-only pass/fail, target sizing and accessible manual alternatives to scanning/touch-only actions.

## [SPEC-LIST] List, table and work-queue behavior
Lists/queues define company/site/warehouse/plant/team scope, status/severity/age/due/hold badges, stable sorting, server pagination/virtualization where large, permission-aware rows/actions and bulk operations only where per-record authorization/effect can be preserved.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search/filters cover inspection/NCR/CAPA/hold/audit/CoA number, item/SKU, supplier/customer, lot/batch/serial, receipt/work order/shipment/return, status/severity/disposition/owner/due date/site/warehouse/time with authorization-safe counts and saved/shared views.

## [SPEC-DETAIL] Detail / 360 workspace
Quality 360 detail shows identity/status/version, governing standard/spec/plan/control point, source/lot/sample/instrument, measurements/results, defects/NCR/hold/disposition/CAPA, supplier/customer/audit/CoA/document relationships, downstream Stock/Manufacturing/Procurement effects, audit and eligible controlled actions.

## [SPEC-CREATE] Create and quick-create UX
Purpose-built create/quick-create covers plans/control points, manual inspections, NCR/CAPA/audit/quality-document records where allowed, with source context defaults, stable IDs, server validation and no bypass of approved version, sampling, calibration, hold or approval controls.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Draft configuration/evidence fields have explicit edit rules. Submitted/approved inspection results, active/closed holds, approved dispositions, closed CAPA/audits and issued CoAs are immutable except through controlled correction/supersession/reopen/reissue/reversal paths.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk work is limited to safe assignment, scheduling, reminder, report/export or explicitly designed batch inspection/hold operations with preview, per-record authorization, bounded transaction/job behavior and exception output. Bulk release/use-as-is/disposition cannot bypass maker-checker.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary/contextual/destructive actions are state/permission aware: start/submit inspection, fail/pass evaluation, create hold/NCR, release hold, approve/execute disposition, create/verify CAPA, return/rework/scrap/use-as-is, issue/reissue CoA and close/reopen audit require confirmation/reason/evidence as policy dictates.

## [SPEC-RELATED] Related records and contextual navigation
Related navigation uses stable public IDs/contracts to Procurement receipts/returns/suppliers, Stock movements/locations/lots/serials, Manufacturing orders/operations/rework, Support complaints, Assets calibration, Sales/customer context and Accounting quality-cost evidence without private cross-module writes.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F340-AUTO-001` — Automation for Quality documents MAY generate inspections/holds/tasks/alerts, schedule reminders, classify defects or reconcile events, but MUST use normal domain/system authorization, deterministic guards, idempotency, audit and exception queues.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F340-APP-001` — Approval-required Quality documents transitions MUST snapshot material values/evidence, capture approver/reason/time, block prohibited self-approval, and revalidate if source quantity, hold, specification, calibration or action state changed.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F340-NOTIF-001` — Quality documents notifications MUST be event-driven, deduplicated, permission-safe and actionable for failed/overdue inspection, new/aging hold/NCR/CAPA, calibration expiry, supplier/customer escalation, audit finding or reconciliation failure as applicable.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/generated documents include inspection worksheets/photos, defect/NCR evidence, deviation/use-as-is justification, calibration certificates, audit evidence/reports, CAPA evidence, controlled quality documents/SOPs and CoAs. Define version/provenance/hash or immutable locator where required, retention, print/reissue and permission-safe access.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Import/export/migration covers standards/specifications/plans/control points, approved master mappings and controlled historical inspections/NCR/CAPA/audits/documents with mapping, validation, dry run, duplicate/stable-ID handling, version/effectivity preservation and reconciliation. Authoritative historical evidence cannot be silently re-keyed or re-evaluated under current rules.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F340-REP-001` — Quality documents reporting MUST define formula/population, company/site/supplier/item/lot/severity/time scope, reopen/correction treatment, freshness, permission-safe drilldown/export and reconciliation to immutable source quality facts.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F340-AI-001` — AI for Quality documents MAY suggest defect classification, anomaly/root-cause hypotheses, CAPA drafts, supplier-risk insights, document extraction or explanations with provenance/uncertainty, but MUST NOT determine pass/fail, tolerance truth, hold/release, disposition approval, calibration validity, inventory/accounting, authorization or transition legality.

## [SPEC-SECURITY] Security, permissions and field controls
- `F340-SEC-001` — Every Quality documents query/command MUST enforce server-side organization, company, site/warehouse/plant, quality team and record scope; sensitive supplier/customer findings, deviations and aggregates MUST not leak.
- `F340-SEC-002` — Sensitive Quality documents decisions such as use-as-is, hold release, disposition override, audit closure or CAPA effectiveness MUST support maker-checker/independence and prohibit self-approval where configured.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Scope is organization -> company -> site/plant/warehouse -> quality team -> source/item/lot/record, with field controls for supplier/customer findings, deviation rationale, audit evidence and cost data. Cross-site consolidated reporting requires elevated permission and authorization-safe aggregation.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time/reason, company/site/source/item/lot/inspection/NCR/CAPA/hold IDs, governing versions, before/after or immutable event, approvals, instrument/calibration, downstream contract IDs, request/correlation/idempotency and linked correction/reopen/release/reversal events.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Use expected versions and transaction/row/advisory locks as appropriate. Simultaneous inspection submissions, NCR/disposition execution, CAPA close, hold release, Stock issue/transfer/pick/ship or Manufacturing consumption/release must resolve deterministically. F323 requires the Stock movement decision to observe active hold state atomically so a concurrent hold cannot be bypassed.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Inspection submission, automatic hold generation, disposition execution, rework/scrap/RTS requests, CAPA automation, CoA issue/reissue, notifications and downstream Stock/Procurement/Manufacturing/Accounting effects use stable source-scoped idempotency keys. Replay returns the prior result/safe no-op and reconciliation remains visible.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F340-INT-001` — Quality documents MUST consume Procurement/Stock/Manufacturing/Sales/Support/Assets/Accounting source facts only through versioned public contracts with source identity, scope, validation, authorization and retry/reconciliation semantics.
- `F340-INT-002` — Quality documents MUST publish holds/releases/dispositions/returns/rework/scrap/complaint/cost or evidence effects with stable source identity and idempotency key; destination modules retain private-state ownership and may reject/reconcile independently.

## [SPEC-API] Commands, queries and API contracts
- `F340-API-001` — Quality documents commands MUST define request schema, company/site/record permission scope, expected state/version, idempotency for material effects, domain errors, transaction boundary, audit and downstream outcomes.
- `F340-API-002` — Quality documents queries MUST define pagination/search/filter/sort, effective-version/history semantics, permission-safe aggregates, stable source identifiers and compatibility/versioning behavior.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Quality is field/tablet capable: barcode/QR/lot/serial scan, source-context launch, large touch measurement/pass-fail controls, camera/evidence capture, instrument/status visibility and explicit offline boundaries. Offline may stage non-authoritative evidence only where policy permits; server sync reauthorizes/revalidates before authoritative pass/fail/release/disposition effects.

## [SPEC-RESPONSIVE] Responsive behavior
Inspection execution preserves source/spec/sample/result and primary safe actions on tablet/phone; desktop manages plans, NCR/CAPA, audits, documents and analytics. Dense traceability/results tables reflow or provide card/detail alternatives, with critical action parity.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantic controls, keyboard/focus, screen-reader announcements for pass/fail/hold/error state, accessible measurement instructions/errors, contrast/target sizes, reduced motion, no color-only quality status and manual alternatives to scan/drag gestures.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/QUALITY_PASS9_WORKSPACES.md` for inspection execution, hold/NCR/disposition, CAPA, calibration/audit/CoA, traceability and KPI states across desktop/tablet/mobile.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F340-PERF-001` — Quality documents MUST define p95/p99 latency and behavior for 0/1/100/10k/1m records, large inspection/result/traceability histories, bounded search/drilldown and background-job thresholds without unbounded request-time scans.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F340-OBS-001` — Quality documents MUST emit structured logs/metrics/traces with correlation/source/inspection/NCR/CAPA/hold/lot identifiers, job retry/dead-letter state, hold-block denials, overdue/calibration/reconciliation counters and support diagnostics without exposing unauthorized evidence.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover zero/oversized lots, destructive sampling, fractional units, borderline tolerance values, unit conversion/rounding, duplicate sample/result, deleted/inactive source, superseded specification, expired/out-of-tolerance instrument, active-hold vs Stock-movement race, partial release/disposition, over-disposition, duplicate rework/scrap/RTS, reopened NCR/CAPA/audit, CoA reissue, lot split/merge genealogy, supplier/customer record changes, closed Accounting period and retry/recovery.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- `QUALITY-P9-CE-033` — verified current-code evidence: `database/tenant/migrations/049_quality_module.sql`.
- Evidence is a foundation/gap observation only; it does not certify the target requirement set.

## [SPEC-GAPS] Exact gap analysis
Current code provides meaningful foundations for Quality settings/plans/points/inspections/results, auto-hold on failed inspection, holds, NCR, CAPA, supplier records, audits/events, permissions, web/API/SDK/dashboard and RLS tables. Enterprise gaps remain unverified/incomplete for comprehensive hard hold enforcement inside every Stock/Manufacturing movement path, controlled hold-release endpoint breadth, full disposition execution/reconciliation, root-cause/action/effectiveness workflows, calibration integration/impact assessment, customer complaints, CoA, controlled documents, complete genealogy, quality-cost accounting, field/offline UX, performance, fault/race tests, E2E and UAT.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Likely later implementation areas: `database/tenant`, `services/api/src/modules/quality`, Stock/Procurement/Manufacturing/Support/Assets/Accounting public contracts and orchestration/worker jobs, `apps/web/src/modules/quality`, mobile/field surfaces, shared types/SDK/permissions and comprehensive DB/security/property/race/fault-injection/E2E tests. Pass 9 writes documentation only.

## [SPEC-TESTS] Automated test plan
Automated plan covers tolerance/sampling/measurement property tests, inspection/NCR/hold/disposition/CAPA state machines, DB/RLS/scope and SoD negative tests, F323 concurrent hold-vs-movement races across Stock/Manufacturing commands, duplicate/retry/idempotency, calibration expiry/out-of-tolerance impact, rework/scrap/RTS/Accounting reconciliation, genealogy/CoA/document versioning, migration, performance and observability.

## [SPEC-E2E] Browser and critical-journey E2E
- `F340-E2E-001` — Device/browser E2E MUST prove the primary authorized Quality documents journey including visible state, persisted quality evidence, audit and relevant Stock/Procurement/Manufacturing/Support/Assets/Accounting contract outcome.
- `F340-E2E-002` — E2E MUST prove Quality documents permission denial, duplicate submit, stale/conflict, expired calibration/spec, concurrent hold/release/material movement, downstream failure, retry/reopen/reversal/reconciliation with no duplicate or unauthorized business effect.

## [SPEC-UAT] Human UAT plan
- `F340-UAT-001` — A realistic inspector/quality operator MUST execute Quality documents against actual source/lot/sample/instrument context and verify visible, stored, hold/disposition/downstream and audit outcomes with evidence.
- `F340-UAT-002` — A quality manager/auditor MUST independently verify Quality documents approvals/SoD, traceability, correction/reopen/reconciliation, cross-module outcomes, responsive/accessibility behavior and exception recovery before sign-off.

## [SPEC-DOD] Objective Definition of Done
Done means approved 54-section dossiers, 21-type requirements, official benchmark + verified current-code evidence, capability/dependency/journey mappings, deterministic evaluation/calibration/hold/disposition contracts, F323 race-safe movement blocking, security/SoD/audit, cross-module reconciliation, responsive/mobile/accessibility, tests/E2E/UAT and omission/red-team gates are objectively satisfied. Specification readiness never certifies product readiness.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder blocks specification readiness. Jurisdiction/industry-specific regulatory retention/e-signature/CoA fields, statistical sampling tables and external laboratory/instrument adapters remain configurable implementation decisions and must not weaken deterministic quality/evidence/hold/authorization contracts.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F340-SEM-01` — **Feature-specific lifecycle and operator outcome**: Freeze entry conditions, valid states/actions, terminal outcomes and explicit non-goals for this feature.
- `F340-SEM-02` — **Authoritative data, relationships and historical truth**: Define identifiers, required/optional fields, references, effective dates, lineage, retention and immutable historical facts.
- `F340-SEM-03` — **Eligibility, validation, precedence and invariant rules**: Specify server-side guards, configuration precedence, deterministic decisions and actionable failure messages.
- `F340-SEM-04` — **Role, scope, sensitive field and override authority**: Define permissions, tenant/company/branch/team/owner scope, field visibility and privileged override audit.
- `F340-SEM-05` — **Primary/alternate/exception operator workflow**: Cover list/search/detail/create/edit/actions, bulk behavior, empty/error/conflict states, responsive/mobile applicability and accessibility.
- `F340-SEM-06` — **Cross-module/external ownership and contract boundaries**: Identify authoritative owner, public commands/queries, event/outbox effects, idempotency and reconciliation.
- `F340-SEM-07` — **Concurrency, duplicate, retry, cancellation and recovery**: Define stale writes, duplicate submissions, retries, partial integration failure, reversal/compensation and exception queues.
- `F340-SEM-08` — **Audit, observability, automated tests and UAT**: Require auditable state changes, metrics/logs, negative/concurrency/integration tests, E2E and human sign-off.

Cross-module context: **Procurement;Stock / Inventory;Manufacturing;Support / Customer Service;Assets**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP016;SP019;SP022;SP024;SP030;SP033;SP034`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F340-PFC-01`, `F340-PFC-02`, `F340-PFC-03`, `F340-PFC-04`, `F340-PFC-05`, `F340-PFC-06`, `F340-PFC-07`, `F340-PFC-08`, `F340-PFC-09`, `F340-PFC-10`
- State transition IDs: `F340-STM-01`, `F340-STM-02`, `F340-STM-03`, `F340-STM-04`, `F340-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F340-1`; `PFD-BM-F340-2`
- The Pass D mappings are the implementation-planning benchmark authority for **Quality documents**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
