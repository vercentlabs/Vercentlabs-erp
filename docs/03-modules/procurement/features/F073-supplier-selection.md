# F073 — Supplier selection

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F073`
- Canonical name: **Supplier selection**
- Module: **Procurement**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `PROC-CAP-003`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Select and award one or more suppliers with justification, split-award policy, approval, immutable evaluation evidence and controlled conversion to an agreement or PO.

**Primary operator outcome:** authorized users can select and award one or more suppliers with justification, split-award policy, approval, immutable evaluation evidence and controlled conversion to an agreement or po.

**Non-goal:** this specification does not certify current implementation or transfer another module's private-state ownership into Procurement.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Business: Select and award one or more suppliers with justification, split-award policy, approval, immutable evaluation evidence and controlled conversion to an agreement or PO.
- Control: deterministic, permission-safe purchasing effects with visible failure/recovery.
- Data: supplier/commercial/receipt/match history remains reproducible after configuration/master changes.
- Readiness: specification may be ready while implementation and product readiness remain separately gated.

## [SPEC-PERSONAS] Personas and jobs to be done
- Requester / buyer / procurement operations: execute demand and purchasing work.
- Procurement manager / approver / category manager: govern spend, sourcing and exceptions.
- Receiver / Quality / AP / planner personas participate only through explicit responsibilities and cross-module journeys.
- Supplier/portal personas can see only their own authorized invitations, documents and collaboration surfaces.
- Negative case: users without supplier-sensitive, bid, match-override or approval permission cannot infer restricted values through any surface.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
- Procurement module navigation and role-specific work queues.
- Authorization-safe global search / command palette.
- Supplier, requisition, sourcing, PO, receipt and match 360 workspaces with durable deep links.
- Contextual creation from Stock, Manufacturing, Sales, Projects or prior Procurement records where permitted.

## [SPEC-BENCHMARK] Benchmark research evidence
- `PROC-P3-BE-021` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `PROC-P3-BE-022` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: generally expected enterprise behavior needed for procurement integrity/control.
- `DIFFERENTIATOR`: one coherent Vercentlabs modular experience rather than copied vendor object/UI structures.
- `NOT_APPLICABLE`: vendor-specific licensing/proprietary object names and unrelated suite behavior are excluded.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **single/split award, quantity allocation, approval thresholds, conflict-of-interest declaration, negotiation evidence, reasons, rejected vendor communication, idempotent PO/agreement creation and re-award/reversal**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F073-CAP-001` — The Supplier selection capability MUST let authorized Procurement users select and award one or more suppliers with justification, split-award policy, approval, immutable evaluation evidence and controlled conversion to an agreement or po.
- `F073-CAP-002` — The capability MUST explicitly cover single/split award, quantity allocation, approval thresholds, conflict-of-interest declaration, negotiation evidence, reasons, rejected vendor communication, idempotent PO/agreement creation and re-award/reversal; the canonical title is a traceability anchor, not complete scope.
- `F073-CAP-003` — Supplier selection MUST preserve Procurement ownership and use public contracts/orchestration for Stock, Quality, Accounting, Manufacturing, Sales, Projects or Shared Platform effects.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F073-FR-001` — The system MUST provide a complete server-backed workflow to select and award one or more suppliers with justification, split-award policy, approval, immutable evaluation evidence and controlled conversion to an agreement or po, including success, empty, validation, failure, permission and stale/conflict states.
- `F073-FR-002` — Every material Supplier selection mutation MUST preserve actor, timestamp, prior/new state or immutable version, reason/approval where required and durable source/downstream lineage.
- `F073-FR-003` — Supplier selection MUST remain usable at enterprise list/document volumes through stable pagination/sorting, background jobs, batching or virtualization where appropriate.
- `F073-US-001` — As an authorized procurement operator, I can select and award one or more suppliers with justification, split-award policy, approval, immutable evaluation evidence and controlled conversion to an agreement or po without bypassing sourcing, approval, receipt, match or accounting controls.
- `F073-US-002` — As a procurement manager/control user, I can review exceptions, approvals, history, risk and performance for Supplier selection within my permitted scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F073-FLOW-001` — The governed lifecycle MUST follow PROPOSED -> PENDING_APPROVAL -> AWARDED/PARTIALLY_AWARDED or REJECTED/CANCELLED -> CONVERTED with explicit guards, failure states and cancellation/reversal/compensation semantics.
- `F073-FLOW-002` — Validation, permission, concurrency and downstream failures MUST be actionable and safely retryable without duplicate purchase, stock, quality or financial effects.

Lifecycle reference: `PROPOSED -> PENDING_APPROVAL -> AWARDED/PARTIALLY_AWARDED or REJECTED/CANCELLED -> CONVERTED`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Procurement domain service for **Supplier selection**.
- Lifecycle: `PROPOSED -> PENDING_APPROVAL -> AWARDED/PARTIALLY_AWARDED or REJECTED/CANCELLED -> CONVERTED`.
- Transitions require current version/state, authorization and business guards.
- Material historical facts are corrected by revision, reversal or compensation—not history rewrite.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F073-DATA-001` — The authoritative Supplier selection model MUST define stable tenant/company-scoped keys, relationships, fields, constraints, lineage, retention and indexes.
- `F073-DATA-002` — Commercial, supplier, quantity, receipt, matching or valuation facts that affect commitment or accounting MUST retain source IDs and immutable snapshots where later configuration could alter interpretation.

## [SPEC-VALIDATION] Validation rules
- `F073-VAL-001` — All Supplier selection commands MUST validate required fields, references, tenant/company scope, lifecycle legality, supplier eligibility, currency/UOM/date rules and downstream preconditions server-side.
- `F073-VAL-002` — Failures MUST return stable domain codes and corrective guidance without leaking restricted supplier banking, tax, bid, price, approval, cost or cross-company data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F073-BR-001` — The owning Procurement domain service is authoritative for Supplier selection; UI, API, import, bulk, automation and AI paths MUST reuse the same rules.
- `F073-BR-002` — Later supplier, price, policy or master-data edits MUST NOT rewrite material historical Supplier selection evidence; corrections use version, reversal or linked adjustment semantics.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F073-CALC-001` — All authoritative amount, quantity, currency conversion, bid score, tolerance, receipt, match, lead-time, landed-cost or KPI calculations applicable to Supplier selection MUST use deterministic decimal/rule logic with explicit rounding/UOM/date boundaries and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F073-UX-001` — The Supplier selection workspace MUST expose identity/status, supplier/demand/document context, key totals/facts, next action, exceptions, related records and downstream state in one coherent Procurement shell.
- `F073-UX-002` — Desktop/tablet/phone views MUST define loading, empty, validation, permission, stale/conflict, partial-downstream-failure, destructive confirmation and success feedback.
- `F073-UX-003` — Dense requisition/RFQ/PO/matching tables and comparison views MUST support keyboard operation, visible focus, semantic labels, non-drag alternatives, touch-safe actions and usable small-screen transformation.

Use the view archetype appropriate to the job: supplier 360, requisition/approval queue, sourcing comparison, commercial document editor, receiving/match exception queue or analytics dashboard.

## [SPEC-LIST] List, table and work-queue behavior
Lists/work queues define stable server pagination/sorting, column/density behavior, authorization-safe counts, row states/actions, bulk eligibility and virtualization/async thresholds.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search defines identifiers/fields/operators/facets, stable sort, saved/shared views where useful and authorization-safe result/count semantics; confidential supplier/bid data never appears through unauthorized indexing.

## [SPEC-DETAIL] Detail / 360 workspace
The detail/360 keeps identity, lifecycle, supplier/demand/document context, totals/key facts, next action, exceptions, related records, history and downstream request/reference status together.

## [SPEC-CREATE] Create and quick-create UX
Create/quick-create applies governed defaults, validates references/duplicates/supplier eligibility, previews deterministic calculations where applicable and navigates to a durable created record.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Editability depends on lifecycle/version. Issued RFQs, submitted bids, awarded sourcing, approved/dispatched POs, posted receipts and matched evidence become immutable or controlled through version/reversal flows.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk operations filter ineligible records, preserve permissions, support all-results semantics, move large jobs async, report partial failure and remain idempotent.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Actions are state/permission/scope aware. High-impact supplier activation, award, approval, dispatch, receipt reversal, match override and return actions require confirmation/reason/approval as configured and have keyboard/mobile equivalents.

## [SPEC-RELATED] Related records and contextual navigation
Related supplier, requisition, sourcing, PO, Stock, Quality, invoice/AP, Manufacturing and replenishment links expose only authorized summaries and never perform direct private-table mutation.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F073-AUTO-001` — Automation may act on Supplier selection only through normal domain commands with trigger provenance, recursion control, deterministic eligibility, retry/idempotency policy, audit and visible outcomes.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F073-APP-001` — Configured high-impact Supplier selection exceptions MUST use explicit approval/override rules, segregation of duties, reason capture and stale-approval invalidation; normal low-risk work must not be universally blocked.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F073-NOTIF-001` — Material Supplier selection assignments, approvals, supplier deadlines, late/exception states or downstream failures MUST be preference-aware, deduplicated, localized where needed and deep-linked to authorized records.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/generated RFQs, POs, receipts, supplier documents and invoices bind to the relevant immutable business version, obey record/field permissions, use safe file handling/retention and support accessible print/PDF output.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports use mapping, preview/dry-run, validation, duplicate handling, row results, resumability and domain commands; exports preserve authorization, bid confidentiality and injection-safe formats.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F073-REP-001` — Reports/KPIs for Supplier selection MUST define grain, filters, period/timezone, currency basis, freshness, permission-safe aggregation, drilldown and reconciliation to authoritative source records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F073-AI-001` — Classification AI_RECOMMEND applies. AI may operate only on authorized evidence and MUST NOT directly write database state or override deterministic supplier eligibility, approval, sourcing award, PO, receipt, match, landed-cost, stock, tax or accounting truth.

## [SPEC-SECURITY] Security, permissions and field controls
- `F073-SEC-001` — Every Supplier selection query/command MUST enforce server-side organization, company/branch where applicable, action permission and requester/buyer/supplier/record scope before data is returned or mutated.
- `F073-SEC-002` — Supplier bank/tax data, confidential bids, pricing, evaluations, exceptions and approval evidence MUST support stricter field/action restrictions and negative tests across search, export, reports, errors and AI.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Reads/writes are organization-isolated and apply company/branch/site/requester/buyer/supplier/record scope where relevant. Cross-company access and supplier portal access are explicit and permissioned.

## [SPEC-AUDIT] Auditability and history
Audit captures actor/channel/time, before-after or immutable version, reason/approval, request/correlation ID and downstream request/event references for material **Supplier selection** actions.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Optimistic concurrency protects mutable purchasing records. Award, PO amendment, receipt, reorder and match races use transactional constraints/idempotency and user-visible retry rules.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible/cross-module effects use business idempotency keys plus database uniqueness. Exact replay returns prior result/no-op; conflicting replay is rejected; reconciliation detects stranded or duplicate purchasing/stock/financial effects.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F073-INT-001` — Every Supplier selection cross-module handoff MUST call the destination module public contract/orchestration, never mutate another module private tables.
- `F073-INT-002` — Cross-module Supplier selection handoffs MUST define trigger, source/destination owner, transaction boundary, idempotency, retry/failure, audit/outbox, result, reversal/compensation and reconciliation.

## [SPEC-API] Commands, queries and API contracts
- `F073-API-001` — Mutating Supplier selection APIs MUST use explicit command intent, validated schemas, authorization, stable errors, optimistic concurrency where needed, idempotency for externally visible effects and audit/outbox correlation.
- `F073-API-002` — Read APIs for Supplier selection MUST provide authorization-safe pagination/filter/sort, stable schemas, count semantics and field redaction appropriate to supplier/bid/price/compliance sensitivity.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Mobile supports approval, supplier/PO/receipt lookup, exception triage and constrained receiving where device context permits; offline mutation is allowed only with explicit queue/conflict/idempotency rules and no confidential-bid leakage.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop favors dense sourcing/document work; tablet reflows secondary panels; phone uses stacked summaries/cards/action sheets. Intentional table comparison scrolling never hides critical identity/status/actions.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantics, labels/instructions, visible focus, keyboard use, announced validation/status, contrast/target sizing, reduced motion and non-drag alternatives; bid comparison cannot rely on color alone.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Pass-level visual contract: `docs/11-visual-assets/wireframes/PROCUREMENT_PASS3_WORKSPACES.md`; complex workspaces require desktop/tablet/phone and normal/empty/error/permission/stale/conflict/failure states before implementation.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F073-PERF-001` — Supplier selection MUST define representative 0/1/100/10k+ record behavior, latency/query budgets, async thresholds and protection against unbounded joins, comparison sets or exports.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F073-OBS-001` — Structured logs/metrics/traces for Supplier selection MUST carry safe correlation/business-state/downstream-request data without logging secrets, supplier banking data or unnecessary PII.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover empty/min/max/negative values where relevant, decimal/currency/UOM boundaries, duplicate supplier/invoice/submit, stale/archived references, concurrent actors, permission changes, supplier deadline/timezone, partial receipts/invoices, downstream partial failure, retry and reversal/reconciliation.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Verified current-code evidence: `PROC-P3-CODE-011` at `services/api/src/modules/procurement/index.js`. It proves an inspected foundation only; code does not override this approved specification.

## [SPEC-GAPS] Exact gap analysis
The current artifact is not treated as complete. Implementation must be gap-audited against all approved requirement IDs above, especially the omission set: single/split award, quantity allocation, approval thresholds, conflict-of-interest declaration, negotiation evidence, reasons, rejected vendor communication, idempotent PO/agreement creation and re-award/reversal.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implement by coherent Procurement capability/domain ownership rather than one source folder per F-ID. Reuse shared authorization/audit/outbox/approval/document/notification primitives and public cross-module contracts. Preserve existing working behavior only where it satisfies the approved contract.

## [SPEC-TESTS] Automated test plan
Automated evidence must include domain/unit, database/RLS/constraint, API/contract, authorization-negative, deterministic calculation/property, concurrency/idempotency, integration/reconciliation, performance/volume and migration tests where applicable.

## [SPEC-E2E] Browser and critical-journey E2E
- `F073-E2E-001` — Browser/API E2E MUST prove the primary authorized workflow to select and award one or more suppliers with justification, split-award policy, approval, immutable evaluation evidence and controlled conversion to an agreement or po and verify resulting state, history and downstream references.
- `F073-E2E-002` — E2E MUST cover unauthorized access, invalid/stale data, concurrency/idempotent replay and at least one relevant downstream failure/retry, approval rejection, exception or reversal path for Supplier selection.

## [SPEC-UAT] Human UAT plan
- `F073-UAT-001` — A real requester/buyer/receiver/AP/manager persona as appropriate MUST execute the primary Supplier selection job with realistic data on desktop and an appropriate responsive path, capturing visible/business evidence.
- `F073-UAT-002` — A manager/finance/quality/warehouse control persona as applicable MUST verify permissions, exception/approval behavior, audit/history and cross-module reconciliation for Supplier selection.

## [SPEC-DOD] Objective Definition of Done
Objective completion requires every approved requirement to have implementation/test evidence; server authorization and valid state transitions; deterministic calculations where applicable; idempotent/auditable cross-module effects; responsive/accessibility evidence; actionable failure/recovery; and executed UAT. A page, table, endpoint or existing code artifact alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder remains for Pass 3 specification readiness. Implementation-time product/config choices may be recorded as explicit decision IDs without changing canonical identity. Stock, Quality, Accounting, Manufacturing, Sales and Projects implementation readiness remains independently gated.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F073-SEM-01` — **Decision request, eligibility and lifecycle**: Define trigger, candidate records, pending/approved/rejected/reassigned/escalated states and terminal/reopen behavior.
- `F073-SEM-02` — **Decision context, evidence, reason and delegation**: Store decision inputs, approver/assignee, reasons, evidence, effective time, delegation/escalation and immutable history.
- `F073-SEM-03` — **Deterministic routing, thresholds and precedence**: Define routing/ranking/eligibility rules, thresholds, calendars, fallback, overrides and tie-breaking.
- `F073-SEM-04` — **Authority, segregation of duties and override governance**: Block self-approval where prohibited, scope decisions by role/company/team and audit privileged overrides.
- `F073-SEM-05` — **Queue, action, explanation and exception experience**: Provide work queues, bulk-safe actions, reasons, SLA/age, conflict feedback, responsive/mobile approval and accessibility.
- `F073-SEM-06` — **Trigger and downstream side-effect contracts**: Define source event, public command, notifications, downstream state and exactly-once/reconciliation behavior.
- `F073-SEM-07` — **Race, withdrawal, supersession and retry recovery**: Handle simultaneous actors, changed source state, withdrawn request, duplicate job, retry and manual exception resolution.
- `F073-SEM-08` — **Decision audit and negative-path verification**: Require routing tests, SoD tests, concurrency tests, notification/outbox tests, E2E and UAT evidence.

Cross-module context: **Stock / Inventory;Quality;Accounting / Finance;Projects;Assets**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP019;SP022;SP023;SP024;SP030;SP031;SP033`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F073-PFC-01`, `F073-PFC-02`, `F073-PFC-03`, `F073-PFC-04`, `F073-PFC-05`, `F073-PFC-06`, `F073-PFC-07`, `F073-PFC-08`, `F073-PFC-09`, `F073-PFC-10`
- State transition IDs: `F073-STM-01`, `F073-STM-02`, `F073-STM-03`, `F073-STM-04`, `F073-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F073-1`; `PFD-BM-F073-2`
- The Pass D mappings are the implementation-planning benchmark authority for **Supplier selection**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
