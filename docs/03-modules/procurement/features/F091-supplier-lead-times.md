# F091 — Supplier lead times

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F091`
- Canonical name: **Supplier lead times**
- Module: **Procurement**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `PROC-CAP-007`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Maintain supplier/item/site lead times and planning buffers with effective dates, planned-versus-actual measurement and safe use in promised receipt/replenishment calculations.

**Primary operator outcome:** authorized users can maintain supplier/item/site lead times and planning buffers with effective dates, planned-versus-actual measurement and safe use in promised receipt/replenishment calculations.

**Non-goal:** this specification does not certify current implementation or transfer another module's private-state ownership into Procurement.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Business: Maintain supplier/item/site lead times and planning buffers with effective dates, planned-versus-actual measurement and safe use in promised receipt/replenishment calculations.
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
- `PROC-P3-BE-057` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `PROC-P3-BE-058` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: generally expected enterprise behavior needed for procurement integrity/control.
- `DIFFERENTIATOR`: one coherent Vercentlabs modular experience rather than copied vendor object/UI structures.
- `NOT_APPLICABLE`: vendor-specific licensing/proprietary object names and unrelated suite behavior are excluded.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **supplier/item/site specificity, working/calendar days, days-to-purchase buffer, promised versus actual, effective dates, multiple vendors, variability, safety buffer, late PO flags and replenishment use**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F091-CAP-001` — The Supplier lead times capability MUST let authorized Procurement users maintain supplier/item/site lead times and planning buffers with effective dates, planned-versus-actual measurement and safe use in promised receipt/replenishment calculations.
- `F091-CAP-002` — The capability MUST explicitly cover supplier/item/site specificity, working/calendar days, days-to-purchase buffer, promised versus actual, effective dates, multiple vendors, variability, safety buffer, late PO flags and replenishment use; the canonical title is a traceability anchor, not complete scope.
- `F091-CAP-003` — Supplier lead times MUST preserve Procurement ownership and use public contracts/orchestration for Stock, Quality, Accounting, Manufacturing, Sales, Projects or Shared Platform effects.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F091-FR-001` — The system MUST provide a complete server-backed workflow to maintain supplier/item/site lead times and planning buffers with effective dates, planned-versus-actual measurement and safe use in promised receipt/replenishment calculations, including success, empty, validation, failure, permission and stale/conflict states.
- `F091-FR-002` — Every material Supplier lead times mutation MUST preserve actor, timestamp, prior/new state or immutable version, reason/approval where required and durable source/downstream lineage.
- `F091-FR-003` — Supplier lead times MUST remain usable at enterprise list/document volumes through stable pagination/sorting, background jobs, batching or virtualization where appropriate.
- `F091-US-001` — As an authorized procurement operator, I can maintain supplier/item/site lead times and planning buffers with effective dates, planned-versus-actual measurement and safe use in promised receipt/replenishment calculations without bypassing sourcing, approval, receipt, match or accounting controls.
- `F091-US-002` — As a procurement manager/control user, I can review exceptions, approvals, history, risk and performance for Supplier lead times within my permitted scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F091-FLOW-001` — The governed lifecycle MUST follow FUTURE/PLANNED -> ACTIVE -> EXPIRED/INACTIVE with measured actual lead-time history retained with explicit guards, failure states and cancellation/reversal/compensation semantics.
- `F091-FLOW-002` — Validation, permission, concurrency and downstream failures MUST be actionable and safely retryable without duplicate purchase, stock, quality or financial effects.

Lifecycle reference: `FUTURE/PLANNED -> ACTIVE -> EXPIRED/INACTIVE with measured actual lead-time history retained`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Procurement domain service for **Supplier lead times**.
- Lifecycle: `FUTURE/PLANNED -> ACTIVE -> EXPIRED/INACTIVE with measured actual lead-time history retained`.
- Transitions require current version/state, authorization and business guards.
- Material historical facts are corrected by revision, reversal or compensation—not history rewrite.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F091-DATA-001` — The authoritative Supplier lead times model MUST define stable tenant/company-scoped keys, relationships, fields, constraints, lineage, retention and indexes.
- `F091-DATA-002` — Commercial, supplier, quantity, receipt, matching or valuation facts that affect commitment or accounting MUST retain source IDs and immutable snapshots where later configuration could alter interpretation.

## [SPEC-VALIDATION] Validation rules
- `F091-VAL-001` — All Supplier lead times commands MUST validate required fields, references, tenant/company scope, lifecycle legality, supplier eligibility, currency/UOM/date rules and downstream preconditions server-side.
- `F091-VAL-002` — Failures MUST return stable domain codes and corrective guidance without leaking restricted supplier banking, tax, bid, price, approval, cost or cross-company data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F091-BR-001` — The owning Procurement domain service is authoritative for Supplier lead times; UI, API, import, bulk, automation and AI paths MUST reuse the same rules.
- `F091-BR-002` — Later supplier, price, policy or master-data edits MUST NOT rewrite material historical Supplier lead times evidence; corrections use version, reversal or linked adjustment semantics.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F091-CALC-001` — All authoritative amount, quantity, currency conversion, bid score, tolerance, receipt, match, lead-time, landed-cost or KPI calculations applicable to Supplier lead times MUST use deterministic decimal/rule logic with explicit rounding/UOM/date boundaries and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F091-UX-001` — The Supplier lead times workspace MUST expose identity/status, supplier/demand/document context, key totals/facts, next action, exceptions, related records and downstream state in one coherent Procurement shell.
- `F091-UX-002` — Desktop/tablet/phone views MUST define loading, empty, validation, permission, stale/conflict, partial-downstream-failure, destructive confirmation and success feedback.
- `F091-UX-003` — Dense requisition/RFQ/PO/matching tables and comparison views MUST support keyboard operation, visible focus, semantic labels, non-drag alternatives, touch-safe actions and usable small-screen transformation.

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
- `F091-AUTO-001` — Automation may act on Supplier lead times only through normal domain commands with trigger provenance, recursion control, deterministic eligibility, retry/idempotency policy, audit and visible outcomes.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F091-APP-001` — Configured high-impact Supplier lead times exceptions MUST use explicit approval/override rules, segregation of duties, reason capture and stale-approval invalidation; normal low-risk work must not be universally blocked.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F091-NOTIF-001` — Material Supplier lead times assignments, approvals, supplier deadlines, late/exception states or downstream failures MUST be preference-aware, deduplicated, localized where needed and deep-linked to authorized records.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/generated RFQs, POs, receipts, supplier documents and invoices bind to the relevant immutable business version, obey record/field permissions, use safe file handling/retention and support accessible print/PDF output.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports use mapping, preview/dry-run, validation, duplicate handling, row results, resumability and domain commands; exports preserve authorization, bid confidentiality and injection-safe formats.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F091-REP-001` — Reports/KPIs for Supplier lead times MUST define grain, filters, period/timezone, currency basis, freshness, permission-safe aggregation, drilldown and reconciliation to authoritative source records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F091-AI-001` — Classification AI_RECOMMEND applies. AI may operate only on authorized evidence and MUST NOT directly write database state or override deterministic supplier eligibility, approval, sourcing award, PO, receipt, match, landed-cost, stock, tax or accounting truth.

## [SPEC-SECURITY] Security, permissions and field controls
- `F091-SEC-001` — Every Supplier lead times query/command MUST enforce server-side organization, company/branch where applicable, action permission and requester/buyer/supplier/record scope before data is returned or mutated.
- `F091-SEC-002` — Supplier bank/tax data, confidential bids, pricing, evaluations, exceptions and approval evidence MUST support stricter field/action restrictions and negative tests across search, export, reports, errors and AI.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Reads/writes are organization-isolated and apply company/branch/site/requester/buyer/supplier/record scope where relevant. Cross-company access and supplier portal access are explicit and permissioned.

## [SPEC-AUDIT] Auditability and history
Audit captures actor/channel/time, before-after or immutable version, reason/approval, request/correlation ID and downstream request/event references for material **Supplier lead times** actions.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Optimistic concurrency protects mutable purchasing records. Award, PO amendment, receipt, reorder and match races use transactional constraints/idempotency and user-visible retry rules.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible/cross-module effects use business idempotency keys plus database uniqueness. Exact replay returns prior result/no-op; conflicting replay is rejected; reconciliation detects stranded or duplicate purchasing/stock/financial effects.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F091-INT-001` — Every Supplier lead times cross-module handoff MUST call the destination module public contract/orchestration, never mutate another module private tables.
- `F091-INT-002` — Cross-module Supplier lead times handoffs MUST define trigger, source/destination owner, transaction boundary, idempotency, retry/failure, audit/outbox, result, reversal/compensation and reconciliation.

## [SPEC-API] Commands, queries and API contracts
- `F091-API-001` — Mutating Supplier lead times APIs MUST use explicit command intent, validated schemas, authorization, stable errors, optimistic concurrency where needed, idempotency for externally visible effects and audit/outbox correlation.
- `F091-API-002` — Read APIs for Supplier lead times MUST provide authorization-safe pagination/filter/sort, stable schemas, count semantics and field redaction appropriate to supplier/bid/price/compliance sensitivity.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Mobile supports approval, supplier/PO/receipt lookup, exception triage and constrained receiving where device context permits; offline mutation is allowed only with explicit queue/conflict/idempotency rules and no confidential-bid leakage.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop favors dense sourcing/document work; tablet reflows secondary panels; phone uses stacked summaries/cards/action sheets. Intentional table comparison scrolling never hides critical identity/status/actions.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantics, labels/instructions, visible focus, keyboard use, announced validation/status, contrast/target sizing, reduced motion and non-drag alternatives; bid comparison cannot rely on color alone.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Pass-level visual contract: `docs/11-visual-assets/wireframes/PROCUREMENT_PASS3_WORKSPACES.md`; complex workspaces require desktop/tablet/phone and normal/empty/error/permission/stale/conflict/failure states before implementation.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F091-PERF-001` — Supplier lead times MUST define representative 0/1/100/10k+ record behavior, latency/query budgets, async thresholds and protection against unbounded joins, comparison sets or exports.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F091-OBS-001` — Structured logs/metrics/traces for Supplier lead times MUST carry safe correlation/business-state/downstream-request data without logging secrets, supplier banking data or unnecessary PII.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover empty/min/max/negative values where relevant, decimal/currency/UOM boundaries, duplicate supplier/invoice/submit, stale/archived references, concurrent actors, permission changes, supplier deadline/timezone, partial receipts/invoices, downstream partial failure, retry and reversal/reconciliation.

## [SPEC-CODE-AUDIT] Current-code evidence audit
Verified current-code evidence: `PROC-P3-CODE-029` at `services/api/src/modules/procurement/pass1-operations.js`. It proves an inspected foundation only; code does not override this approved specification.

## [SPEC-GAPS] Exact gap analysis
The current artifact is not treated as complete. Implementation must be gap-audited against all approved requirement IDs above, especially the omission set: supplier/item/site specificity, working/calendar days, days-to-purchase buffer, promised versus actual, effective dates, multiple vendors, variability, safety buffer, late PO flags and replenishment use.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implement by coherent Procurement capability/domain ownership rather than one source folder per F-ID. Reuse shared authorization/audit/outbox/approval/document/notification primitives and public cross-module contracts. Preserve existing working behavior only where it satisfies the approved contract.

## [SPEC-TESTS] Automated test plan
Automated evidence must include domain/unit, database/RLS/constraint, API/contract, authorization-negative, deterministic calculation/property, concurrency/idempotency, integration/reconciliation, performance/volume and migration tests where applicable.

## [SPEC-E2E] Browser and critical-journey E2E
- `F091-E2E-001` — Browser/API E2E MUST prove the primary authorized workflow to maintain supplier/item/site lead times and planning buffers with effective dates, planned-versus-actual measurement and safe use in promised receipt/replenishment calculations and verify resulting state, history and downstream references.
- `F091-E2E-002` — E2E MUST cover unauthorized access, invalid/stale data, concurrency/idempotent replay and at least one relevant downstream failure/retry, approval rejection, exception or reversal path for Supplier lead times.

## [SPEC-UAT] Human UAT plan
- `F091-UAT-001` — A real requester/buyer/receiver/AP/manager persona as appropriate MUST execute the primary Supplier lead times job with realistic data on desktop and an appropriate responsive path, capturing visible/business evidence.
- `F091-UAT-002` — A manager/finance/quality/warehouse control persona as applicable MUST verify permissions, exception/approval behavior, audit/history and cross-module reconciliation for Supplier lead times.

## [SPEC-DOD] Objective Definition of Done
Objective completion requires every approved requirement to have implementation/test evidence; server authorization and valid state transitions; deterministic calculations where applicable; idempotent/auditable cross-module effects; responsive/accessibility evidence; actionable failure/recovery; and executed UAT. A page, table, endpoint or existing code artifact alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder remains for Pass 3 specification readiness. Implementation-time product/config choices may be recorded as explicit decision IDs without changing canonical identity. Stock, Quality, Accounting, Manufacturing, Sales and Projects implementation readiness remains independently gated.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F091-SEM-01` — **Feature-specific lifecycle and operator outcome**: Freeze entry conditions, valid states/actions, terminal outcomes and explicit non-goals for this feature. Lead capture/identity/qualification/assignment/conversion context must remain distinct from customer/account truth.
- `F091-SEM-02` — **Authoritative data, relationships and historical truth**: Define identifiers, required/optional fields, references, effective dates, lineage, retention and immutable historical facts.
- `F091-SEM-03` — **Eligibility, validation, precedence and invariant rules**: Specify server-side guards, configuration precedence, deterministic decisions and actionable failure messages. Lead capture/identity/qualification/assignment/conversion context must remain distinct from customer/account truth.
- `F091-SEM-04` — **Role, scope, sensitive field and override authority**: Define permissions, tenant/company/branch/team/owner scope, field visibility and privileged override audit.
- `F091-SEM-05` — **Primary/alternate/exception operator workflow**: Cover list/search/detail/create/edit/actions, bulk behavior, empty/error/conflict states, responsive/mobile applicability and accessibility.
- `F091-SEM-06` — **Cross-module/external ownership and contract boundaries**: Identify authoritative owner, public commands/queries, event/outbox effects, idempotency and reconciliation. Lead capture/identity/qualification/assignment/conversion context must remain distinct from customer/account truth.
- `F091-SEM-07` — **Concurrency, duplicate, retry, cancellation and recovery**: Define stale writes, duplicate submissions, retries, partial integration failure, reversal/compensation and exception queues. Lead capture/identity/qualification/assignment/conversion context must remain distinct from customer/account truth.
- `F091-SEM-08` — **Audit, observability, automated tests and UAT**: Require auditable state changes, metrics/logs, negative/concurrency/integration tests, E2E and human sign-off.

Cross-module context: **Stock / Inventory;Quality;Accounting / Finance;Projects;Assets**.
Shared-platform dependencies: `SP008;SP009;SP012;SP014;SP015;SP019;SP022;SP023;SP024;SP030;SP031;SP033`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.
