# F090 — Supplier rating

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F090`
- Canonical name: **Supplier rating**
- Module: **Procurement**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `PROC-CAP-007`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Produce weighted supplier ratings/scorecards from governed operational and questionnaire/manual criteria with review, overrides, peer comparison and historical versions.

**Primary operator outcome:** authorized users can produce weighted supplier ratings/scorecards from governed operational and questionnaire/manual criteria with review, overrides, peer comparison and historical versions.

**Non-goal:** this specification does not certify current implementation or transfer another module's private-state ownership into Procurement.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Business: Produce weighted supplier ratings/scorecards from governed operational and questionnaire/manual criteria with review, overrides, peer comparison and historical versions.
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
- `PROC-P3-BE-055` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `PROC-P3-BE-056` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: generally expected enterprise behavior needed for procurement integrity/control.
- `DIFFERENTIATOR`: one coherent Vercentlabs modular experience rather than copied vendor object/UI structures.
- `NOT_APPLICABLE`: vendor-specific licensing/proprietary object names and unrelated suite behavior are excluded.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **operational versus questionnaire/manual criteria, weights, normalization, bands, peer groups, approver override, evidence, effective period, score history and decisions based on stale ratings**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F090-CAP-001` — The Supplier rating capability MUST let authorized Procurement users produce weighted supplier ratings/scorecards from governed operational and questionnaire/manual criteria with review, overrides, peer comparison and historical versions.
- `F090-CAP-002` — The capability MUST explicitly cover operational versus questionnaire/manual criteria, weights, normalization, bands, peer groups, approver override, evidence, effective period, score history and decisions based on stale ratings; the canonical title is a traceability anchor, not complete scope.
- `F090-CAP-003` — Supplier rating MUST preserve Procurement ownership and use public contracts/orchestration for Stock, Quality, Accounting, Manufacturing, Sales, Projects or Shared Platform effects.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F090-FR-001` — The system MUST provide a complete server-backed workflow to produce weighted supplier ratings/scorecards from governed operational and questionnaire/manual criteria with review, overrides, peer comparison and historical versions, including success, empty, validation, failure, permission and stale/conflict states.
- `F090-FR-002` — Every material Supplier rating mutation MUST preserve actor, timestamp, prior/new state or immutable version, reason/approval where required and durable source/downstream lineage.
- `F090-FR-003` — Supplier rating MUST remain usable at enterprise list/document volumes through stable pagination/sorting, background jobs, batching or virtualization where appropriate.
- `F090-US-001` — As an authorized procurement operator, I can produce weighted supplier ratings/scorecards from governed operational and questionnaire/manual criteria with review, overrides, peer comparison and historical versions without bypassing sourcing, approval, receipt, match or accounting controls.
- `F090-US-002` — As a procurement manager/control user, I can review exceptions, approvals, history, risk and performance for Supplier rating within my permitted scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F090-FLOW-001` — The governed lifecycle MUST follow DRAFT SCORECARD -> REVIEWED -> APPROVED/PUBLISHED -> SUPERSEDED with explicit guards, failure states and cancellation/reversal/compensation semantics.
- `F090-FLOW-002` — Validation, permission, concurrency and downstream failures MUST be actionable and safely retryable without duplicate purchase, stock, quality or financial effects.

Lifecycle reference: `DRAFT SCORECARD -> REVIEWED -> APPROVED/PUBLISHED -> SUPERSEDED`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Procurement domain service for **Supplier rating**.
- Lifecycle: `DRAFT SCORECARD -> REVIEWED -> APPROVED/PUBLISHED -> SUPERSEDED`.
- Transitions require current version/state, authorization and business guards.
- Material historical facts are corrected by revision, reversal or compensation—not history rewrite.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F090-DATA-001` — The authoritative Supplier rating model MUST define stable tenant/company-scoped keys, relationships, fields, constraints, lineage, retention and indexes.
- `F090-DATA-002` — Commercial, supplier, quantity, receipt, matching or valuation facts that affect commitment or accounting MUST retain source IDs and immutable snapshots where later configuration could alter interpretation.

## [SPEC-VALIDATION] Validation rules
- `F090-VAL-001` — All Supplier rating commands MUST validate required fields, references, tenant/company scope, lifecycle legality, supplier eligibility, currency/UOM/date rules and downstream preconditions server-side.
- `F090-VAL-002` — Failures MUST return stable domain codes and corrective guidance without leaking restricted supplier banking, tax, bid, price, approval, cost or cross-company data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F090-BR-001` — The owning Procurement domain service is authoritative for Supplier rating; UI, API, import, bulk, automation and AI paths MUST reuse the same rules.
- `F090-BR-002` — Later supplier, price, policy or master-data edits MUST NOT rewrite material historical Supplier rating evidence; corrections use version, reversal or linked adjustment semantics.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F090-CALC-001` — All authoritative amount, quantity, currency conversion, bid score, tolerance, receipt, match, lead-time, landed-cost or KPI calculations applicable to Supplier rating MUST use deterministic decimal/rule logic with explicit rounding/UOM/date boundaries and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F090-UX-001` — The Supplier rating workspace MUST expose identity/status, supplier/demand/document context, key totals/facts, next action, exceptions, related records and downstream state in one coherent Procurement shell.
- `F090-UX-002` — Desktop/tablet/phone views MUST define loading, empty, validation, permission, stale/conflict, partial-downstream-failure, destructive confirmation and success feedback.
- `F090-UX-003` — Dense requisition/RFQ/PO/matching tables and comparison views MUST support keyboard operation, visible focus, semantic labels, non-drag alternatives, touch-safe actions and usable small-screen transformation.

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
- `F090-AUTO-001` — Automation may act on Supplier rating only through normal domain commands with trigger provenance, recursion control, deterministic eligibility, retry/idempotency policy, audit and visible outcomes.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F090-APP-001` — Configured high-impact Supplier rating exceptions MUST use explicit approval/override rules, segregation of duties, reason capture and stale-approval invalidation; normal low-risk work must not be universally blocked.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F090-NOTIF-001` — Material Supplier rating assignments, approvals, supplier deadlines, late/exception states or downstream failures MUST be preference-aware, deduplicated, localized where needed and deep-linked to authorized records.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/generated RFQs, POs, receipts, supplier documents and invoices bind to the relevant immutable business version, obey record/field permissions, use safe file handling/retention and support accessible print/PDF output.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports use mapping, preview/dry-run, validation, duplicate handling, row results, resumability and domain commands; exports preserve authorization, bid confidentiality and injection-safe formats.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F090-REP-001` — Reports/KPIs for Supplier rating MUST define grain, filters, period/timezone, currency basis, freshness, permission-safe aggregation, drilldown and reconciliation to authoritative source records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F090-AI-001` — Classification AI_RECOMMEND applies. AI may operate only on authorized evidence and MUST NOT directly write database state or override deterministic supplier eligibility, approval, sourcing award, PO, receipt, match, landed-cost, stock, tax or accounting truth.

## [SPEC-SECURITY] Security, permissions and field controls
- `F090-SEC-001` — Every Supplier rating query/command MUST enforce server-side organization, company/branch where applicable, action permission and requester/buyer/supplier/record scope before data is returned or mutated.
- `F090-SEC-002` — Supplier bank/tax data, confidential bids, pricing, evaluations, exceptions and approval evidence MUST support stricter field/action restrictions and negative tests across search, export, reports, errors and AI.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Reads/writes are organization-isolated and apply company/branch/site/requester/buyer/supplier/record scope where relevant. Cross-company access and supplier portal access are explicit and permissioned.

## [SPEC-AUDIT] Auditability and history
Audit captures actor/channel/time, before-after or immutable version, reason/approval, request/correlation ID and downstream request/event references for material **Supplier rating** actions.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Optimistic concurrency protects mutable purchasing records. Award, PO amendment, receipt, reorder and match races use transactional constraints/idempotency and user-visible retry rules.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible/cross-module effects use business idempotency keys plus database uniqueness. Exact replay returns prior result/no-op; conflicting replay is rejected; reconciliation detects stranded or duplicate purchasing/stock/financial effects.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F090-INT-001` — Every Supplier rating cross-module handoff MUST call the destination module public contract/orchestration, never mutate another module private tables.
- `F090-INT-002` — Cross-module Supplier rating handoffs MUST define trigger, source/destination owner, transaction boundary, idempotency, retry/failure, audit/outbox, result, reversal/compensation and reconciliation.

## [SPEC-API] Commands, queries and API contracts
- `F090-API-001` — Mutating Supplier rating APIs MUST use explicit command intent, validated schemas, authorization, stable errors, optimistic concurrency where needed, idempotency for externally visible effects and audit/outbox correlation.
- `F090-API-002` — Read APIs for Supplier rating MUST provide authorization-safe pagination/filter/sort, stable schemas, count semantics and field redaction appropriate to supplier/bid/price/compliance sensitivity.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Mobile supports approval, supplier/PO/receipt lookup, exception triage and constrained receiving where device context permits; offline mutation is allowed only with explicit queue/conflict/idempotency rules and no confidential-bid leakage.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop favors dense sourcing/document work; tablet reflows secondary panels; phone uses stacked summaries/cards/action sheets. Intentional table comparison scrolling never hides critical identity/status/actions.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantics, labels/instructions, visible focus, keyboard use, announced validation/status, contrast/target sizing, reduced motion and non-drag alternatives; bid comparison cannot rely on color alone.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Pass-level visual contract: `docs/11-visual-assets/wireframes/PROCUREMENT_PASS3_WORKSPACES.md`; complex workspaces require desktop/tablet/phone and normal/empty/error/permission/stale/conflict/failure states before implementation.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F090-PERF-001` — Supplier rating MUST define representative 0/1/100/10k+ record behavior, latency/query budgets, async thresholds and protection against unbounded joins, comparison sets or exports.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F090-OBS-001` — Structured logs/metrics/traces for Supplier rating MUST carry safe correlation/business-state/downstream-request data without logging secrets, supplier banking data or unnecessary PII.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover empty/min/max/negative values where relevant, decimal/currency/UOM boundaries, duplicate supplier/invoice/submit, stale/archived references, concurrent actors, permission changes, supplier deadline/timezone, partial receipts/invoices, downstream partial failure, retry and reversal/reconciliation.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Verified current-code evidence: `PROC-P3-CODE-028` at `services/api/src/modules/procurement/index.js`. It proves an inspected foundation only; code does not override this approved specification.

## [SPEC-GAPS] Exact gap analysis
The current artifact is not treated as complete. Implementation must be gap-audited against all approved requirement IDs above, especially the omission set: operational versus questionnaire/manual criteria, weights, normalization, bands, peer groups, approver override, evidence, effective period, score history and decisions based on stale ratings.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implement by coherent Procurement capability/domain ownership rather than one source folder per F-ID. Reuse shared authorization/audit/outbox/approval/document/notification primitives and public cross-module contracts. Preserve existing working behavior only where it satisfies the approved contract.

## [SPEC-TESTS] Automated test plan
Automated evidence must include domain/unit, database/RLS/constraint, API/contract, authorization-negative, deterministic calculation/property, concurrency/idempotency, integration/reconciliation, performance/volume and migration tests where applicable.

## [SPEC-E2E] Browser and critical-journey E2E
- `F090-E2E-001` — Browser/API E2E MUST prove the primary authorized workflow to produce weighted supplier ratings/scorecards from governed operational and questionnaire/manual criteria with review, overrides, peer comparison and historical versions and verify resulting state, history and downstream references.
- `F090-E2E-002` — E2E MUST cover unauthorized access, invalid/stale data, concurrency/idempotent replay and at least one relevant downstream failure/retry, approval rejection, exception or reversal path for Supplier rating.

## [SPEC-UAT] Human UAT plan
- `F090-UAT-001` — A real requester/buyer/receiver/AP/manager persona as appropriate MUST execute the primary Supplier rating job with realistic data on desktop and an appropriate responsive path, capturing visible/business evidence.
- `F090-UAT-002` — A manager/finance/quality/warehouse control persona as applicable MUST verify permissions, exception/approval behavior, audit/history and cross-module reconciliation for Supplier rating.

## [SPEC-DOD] Objective Definition of Done
Objective completion requires every approved requirement to have implementation/test evidence; server authorization and valid state transitions; deterministic calculations where applicable; idempotent/auditable cross-module effects; responsive/accessibility evidence; actionable failure/recovery; and executed UAT. A page, table, endpoint or existing code artifact alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder remains for Pass 3 specification readiness. Implementation-time product/config choices may be recorded as explicit decision IDs without changing canonical identity. Stock, Quality, Accounting, Manufacturing, Sales and Projects implementation readiness remains independently gated.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F090-SEM-01` — **Feature-specific lifecycle and operator outcome**: Freeze entry conditions, valid states/actions, terminal outcomes and explicit non-goals for this feature.
- `F090-SEM-02` — **Authoritative data, relationships and historical truth**: Define identifiers, required/optional fields, references, effective dates, lineage, retention and immutable historical facts.
- `F090-SEM-03` — **Eligibility, validation, precedence and invariant rules**: Specify server-side guards, configuration precedence, deterministic decisions and actionable failure messages.
- `F090-SEM-04` — **Role, scope, sensitive field and override authority**: Define permissions, tenant/company/branch/team/owner scope, field visibility and privileged override audit.
- `F090-SEM-05` — **Primary/alternate/exception operator workflow**: Cover list/search/detail/create/edit/actions, bulk behavior, empty/error/conflict states, responsive/mobile applicability and accessibility.
- `F090-SEM-06` — **Cross-module/external ownership and contract boundaries**: Identify authoritative owner, public commands/queries, event/outbox effects, idempotency and reconciliation.
- `F090-SEM-07` — **Concurrency, duplicate, retry, cancellation and recovery**: Define stale writes, duplicate submissions, retries, partial integration failure, reversal/compensation and exception queues.
- `F090-SEM-08` — **Audit, observability, automated tests and UAT**: Require auditable state changes, metrics/logs, negative/concurrency/integration tests, E2E and human sign-off.

Cross-module context: **Stock / Inventory;Quality;Accounting / Finance;Projects;Assets**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP019;SP022;SP023;SP024;SP030;SP031;SP033`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F090-PFC-01`, `F090-PFC-02`, `F090-PFC-03`, `F090-PFC-04`, `F090-PFC-05`, `F090-PFC-06`, `F090-PFC-07`, `F090-PFC-08`, `F090-PFC-09`, `F090-PFC-10`
- State transition IDs: `F090-STM-01`, `F090-STM-02`, `F090-STM-03`, `F090-STM-04`, `F090-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F090-1`; `PFD-BM-F090-2`
- The Pass D mappings are the implementation-planning benchmark authority for **Supplier rating**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
