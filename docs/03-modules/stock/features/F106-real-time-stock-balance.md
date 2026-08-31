# F106 — Real-time stock balance

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F106`
- Canonical name: **Real-time stock balance**
- Module: **Stock / Inventory**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `STOCK-CAP-003`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Maintain race-safe real-time physical and reserved balances derived from authoritative stock transactions.

**Non-goal:** specification readiness does not certify current implementation, and Stock does not take private-state ownership from another module.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Quantity/state outcome: reproducible physical stock truth at explicit item/location/tracking grain.
- Control outcome: no bypass of reservation, hold, negative-stock, valuation or permission rules.
- Reconciliation outcome: movement, balance, valuation and downstream financial/control totals can be explained.
- Readiness outcome: specification is independently gated from implementation/product readiness.

## [SPEC-PERSONAS] Personas and jobs to be done
- Warehouse operator / receiver / picker / packer / shipper executes physical work.
- Inventory controller / warehouse manager governs balances, counts, exceptions and replenishment.
- Quality, planner, Sales, Procurement, Manufacturing and Finance personas participate through explicit contracts.
- Negative case: users outside permitted company/warehouse/cost scope cannot infer quantities, costs or restricted references through list counts, dashboards, exports or search.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
- Stock dashboard, availability workspace, operations workspace and role-specific queues.
- Item/warehouse/lot/serial 360, global search/command palette and durable deep links.
- Contextual entry from Procurement receipts, Sales orders, Manufacturing orders, POS, Quality holds and Accounting reconciliation where authorized.

## [SPEC-BENCHMARK] Benchmark research evidence
- `STOCK-P4-BE-019` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `STOCK-P4-BE-020` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: mature inventory integrity, warehouse execution, traceability, valuation and reconciliation behavior.
- `DIFFERENTIATOR`: coherent Vercentlabs capability-oriented UX/contracts instead of copied vendor object structures.
- `NOT_APPLICABLE`: vendor-specific licensing/object names and features outside the canonical product scope.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **transaction isolation, row locking, balance drift diagnostics, derived-vs-cached truth, reservations and reconciliation**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F106-CAP-001` — The Real-time stock balance capability MUST maintain race-safe real-time physical and reserved balances derived from authoritative stock transactions.
- `F106-CAP-002` — The capability MUST explicitly cover transaction isolation, row locking, balance drift diagnostics, derived-vs-cached truth, reservations and reconciliation; the canonical title is a traceability anchor, not complete scope.
- `F106-CAP-003` — Real-time stock balance MUST preserve Stock ownership of physical quantity/stock-ledger effects and use public contracts for Procurement, Sales, Manufacturing, Quality, POS, Projects, Assets and Accounting effects.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F106-FR-001` — The system MUST provide a server-backed Real-time stock balance workflow covering success, validation, permission, conflict, downstream failure, reversal/recovery and audit states.
- `F106-FR-002` — Every material Real-time stock balance mutation MUST preserve actor, effective/posting time, reason, source reference, prior/new state or immutable event, and downstream lineage.
- `F106-FR-003` — Real-time stock balance MUST remain usable at enterprise item/location/movement volumes through stable pagination, indexing, batching, virtualization or background processing as appropriate.
- `F106-US-001` — As an authorized warehouse/inventory operator, I can perform Real-time stock balance accurately without bypassing quantity, traceability, quality, costing or permission controls.
- `F106-US-002` — As an inventory manager/controller, I can review exceptions, history, reconciliation and policy for Real-time stock balance within my permitted company/warehouse scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F106-FLOW-001` — The governed lifecycle MUST follow ACTIVE/VALID -> versioned change or controlled inactivation; posted historical facts remain immutable, with explicit guards and no silent history rewrite.
- `F106-FLOW-002` — Validation, permission, concurrency and downstream failures for Real-time stock balance MUST be actionable and safely retryable without duplicate physical, reservation, valuation or accounting effects.

Lifecycle reference: `ACTIVE/VALID -> versioned change or controlled inactivation; posted historical facts remain immutable`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Stock domain service for **Real-time stock balance**.
- Lifecycle: `ACTIVE/VALID -> versioned change or controlled inactivation; posted historical facts remain immutable`.
- Transitions require current state/version, authorization, dimension eligibility and invariant checks.
- Posted movement facts are corrected by reversal/compensation, never silent mutation.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F106-DATA-001` — The Real-time stock balance model MUST define organization/company, item, warehouse/location and lot/batch/serial dimensions as applicable, with stable keys, constraints, indexes, retention and lineage.
- `F106-DATA-002` — Quantity, UOM, cost, status, source and policy values that determine historical Real-time stock balance interpretation MUST remain reproducible after master/configuration changes.

## [SPEC-VALIDATION] Validation rules
- `F106-VAL-001` — All Real-time stock balance commands MUST validate tenant/company scope, item/location eligibility, UOM, quantity sign/precision, tracking/status rules, lifecycle and reference integrity server-side.
- `F106-VAL-002` — Real-time stock balance failures MUST use stable domain error codes and corrective guidance without exposing unauthorized cost, supplier, customer or cross-company data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F106-BR-001` — The Stock domain command responsible for Real-time stock balance is authoritative; UI, API, import, barcode, automation and AI paths MUST reuse the same invariant checks.
- `F106-BR-002` — Posted stock facts for Real-time stock balance MUST be corrected by reversal/compensation or linked adjustment, never by rewriting authoritative movement history.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F106-CALC-001` — All authoritative quantity, availability, ATP, conversion, valuation, aging or replenishment calculations applicable to Real-time stock balance MUST use deterministic decimal/date rules with explicit precision and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F106-UX-001` — The Real-time stock balance workspace MUST expose item/location identity, state, quantity/cost facts as permitted, source/next action, exceptions, related records and history in one coherent Stock shell.
- `F106-UX-002` — Desktop/tablet/phone views for Real-time stock balance MUST define loading, empty, validation, permission, stale/conflict, offline/retry, destructive confirmation and success states.
- `F106-UX-003` — Warehouse-heavy Real-time stock balance interactions MUST support keyboard operation, touch-safe controls, scanner/manual alternatives, visible focus and non-drag alternatives.

Use the appropriate inventory view archetype: item/warehouse 360, availability grid, ledger, count work, replenishment queue, traceability graph, pick-pack-ship workbench, valuation/reporting dashboard or exception queue.

## [SPEC-LIST] List, table and work-queue behavior
Lists/work queues define server pagination/sorting, column/density personalization, authorization-safe counts, row state/actions, bulk eligibility and virtualization/async thresholds.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search defines item/SKU/barcode/location/lot/serial/reference fields, operators/facets, stable sort, saved views and authorization-safe result/count semantics.

## [SPEC-DETAIL] Detail / 360 workspace
The detail/360 keeps identity, lifecycle/status, dimension grain, quantities/costs as permitted, source/related records, history and downstream state together.

## [SPEC-CREATE] Create and quick-create UX
Create/quick-create applies governed defaults, scanner/manual input, dimensional validation and a deterministic preview before a physical/financial effect is posted.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Master/configuration edits are version/effective-date aware; posted movements and historical valuation/traceability facts are immutable except through governed reversal/compensation.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk operations validate each selected row under the same server rules; partial success, failure export, retry and audit semantics are explicit.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary and destructive actions are role/state aware; post/reverse/adjust/release/ship actions require explicit confirmation when they create irreversible or downstream effects.

## [SPEC-RELATED] Related records and contextual navigation
Related navigation links item, warehouse/location, movement, reservation, lot/serial, source document, quality hold, fulfilment and accounting references without cross-module private writes.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F106-AUTO-001` — Automation MAY create proposals/work for Real-time stock balance only through idempotent Stock/public commands; no automation may directly mutate stock balance tables.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F106-APP-001` — Where policy requires maker-checker for high-value adjustments, negative-stock exceptions, count variances or quality release affecting Real-time stock balance, approval MUST bind to the exact version/value being approved.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F106-NOTIF-001` — Notifications for Real-time stock balance MUST be event-driven, deduplicated, preference/permission aware and deep-link to the exact exception or work item without leaking restricted data.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/labels/count sheets/pick-pack documents/traceability exports use permission-safe templates, durable references, generated-at metadata and reprint history where material.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports require mapping, dry-run/preview, dimension validation, duplicate/idempotency policy, background jobs and failure rows; exports respect company/warehouse/cost permissions and as-of semantics.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F106-REP-001` — Reports/KPIs for Real-time stock balance MUST define grain, filters, freshness, drilldown, as-of semantics and reconciliation to authoritative movement/balance/valuation records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F106-AI-001` — AI for Real-time stock balance is limited to assist/recommend/generate workflows with provenance, explanation and permission filtering; it MUST NOT be authoritative for stock quantity, reservation, valuation, traceability, quality holds or posting legality.

## [SPEC-SECURITY] Security, permissions and field controls
- `F106-SEC-001` — Every Real-time stock balance query and mutation MUST enforce authentication, module entitlement, organization/company/warehouse scope, action permission and record/dimension visibility server-side.
- `F106-SEC-002` — Cost/valuation, customer/supplier references and administrative configuration in Real-time stock balance MUST be field/action restricted and protected against IDOR, aggregate leakage and unauthorized export.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Every Stock query/mutation is organization-scoped and company-scoped; warehouse/location access is an additional dimension where configured. Cross-company inventory is never inferred by absence of UI filters.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time, request/correlation/idempotency key, source document, state/reason, before/after master configuration when mutable, movement/reversal links and downstream event references.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Physical quantity/reservation/valuation mutations use transaction-scoped locking or equivalent atomic compare-and-update at the authoritative dimension grain. Lock ordering, deadlock retry and stale-work recovery are specified.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible stock effects require idempotency keys/source-effect uniqueness, replay/no-op behavior, durable outbox semantics and reconciliation for uncertain downstream delivery.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F106-INT-001` — Inbound cross-module requests affecting Real-time stock balance MUST call a versioned public Stock command with authorization, idempotency key, source reference, validation and explicit failure result.
- `F106-INT-002` — Outbound effects from Real-time stock balance MUST use outbox/public events or orchestration with retry, reversal/compensation and reconciliation; Stock MUST NOT write another module’s private tables.

## [SPEC-API] Commands, queries and API contracts
- `F106-API-001` — Real-time stock balance mutation APIs MUST define request schema, authorization, idempotency, expected state/version, stable errors, audit/outbox effects and compatibility semantics.
- `F106-API-002` — Real-time stock balance query APIs MUST define dimension grain, pagination/filter/sort, as-of/freshness semantics, authorization-safe aggregates and stable response contracts.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Receiving, transfers, picking, counting, packing, shipping and traceability lookup define scanner-first phone/handheld flows, manual fallback, offline boundaries, reconnect/retry and device-security behavior.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop supports dense grids and multi-pane workspaces; tablet supports warehouse work; phone transforms grids into actionable cards/step flows without losing critical actions or exception evidence.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantic labels/headings, full keyboard support, visible focus, status/error announcements, sufficient target sizing/contrast, non-color status cues, reduced motion and non-drag/manual alternatives to scanning.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/STOCK_PASS4_WORKSPACES.md` plus journey/state diagrams in Stock architecture and cross-module contracts.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F106-PERF-001` — Real-time stock balance MUST define performance envelopes for 0/1/100/10k/1m movement or dimension records as applicable, with bounded queries and explicit asynchronous thresholds.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F106-OBS-001` — Real-time stock balance MUST emit structured logs/metrics/traces for failures, retries, lock contention, drift/reconciliation, job lag and downstream delivery with correlation IDs.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Red-team cases include duplicate/replayed scans, concurrent reservation/issue, backdated movement, expired/held stock, partial transfer/shipment, serial reuse, UOM rounding drift, count during movement, failed downstream accounting event, valuation reversal, stale ATP and cross-company IDOR.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- Verified current-code evidence: `STOCK-P4-CODE-010` → `services/api/src/modules/stock/index.js`.
- Evidence describes present foundations only; absence or presence never auto-certifies the canonical feature.

## [SPEC-GAPS] Exact gap analysis
Implementation/product readiness remains explicitly unverified. Pass 4 requires later code-level proof for every approved requirement, especially transaction isolation, quality-hold interlocks, valuation-layer integrity, historical/as-of reporting, warehouse mobile execution and cross-module reconciliation.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implement by capability and journey, not one source folder per F-ID. Priority order: inventory identity/dimensions -> ledger/locking/idempotency -> reservations/availability/ATP -> traceability/status -> warehouse execution/counting/replenishment -> valuation/reconciliation -> analytics/reporting.

## [SPEC-TESTS] Automated test plan
Automated tests require domain/unit math, database/RLS and concurrency, API contract/auth-negative, idempotency/retry, cross-module integration, property/invariant tests for quantity/valuation, migration/data-reconciliation, performance and observability diagnostics.

## [SPEC-E2E] Browser and critical-journey E2E
- `F106-E2E-001` — E2E MUST prove an authorized operator can complete the primary Real-time stock balance journey and observe correct quantity/state/history/downstream references.
- `F106-E2E-002` — E2E MUST cover unauthorized access, invalid/stale data, concurrent/replayed mutation and one relevant failure, short/partial, hold, reversal or reconciliation path for Real-time stock balance.

## [SPEC-UAT] Human UAT plan
- `F106-UAT-001` — A real warehouse/inventory operator MUST execute the primary Real-time stock balance job with realistic data on desktop and an appropriate mobile/scanner path, capturing visible and data evidence.
- `F106-UAT-002` — An inventory manager/controller plus relevant Quality/Finance/Sales/Procurement persona MUST verify permissions, exception/reversal behavior, audit and cross-module reconciliation for Real-time stock balance.

## [SPEC-DOD] Objective Definition of Done
Objective completion requires approved requirements with implementation/test evidence; server authorization; valid state transitions; deterministic quantity/UOM/availability/valuation; idempotent/auditable cross-module effects; responsive/accessibility evidence; actionable recovery; reconciliation and executed UAT. A page, table, endpoint or existing code artifact alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder remains for Pass 4 specification readiness. Implementation-time configuration choices (for example permitted negative-stock exceptions, valuation method by item group, removal strategy and warehouse work policy) must be recorded as explicit decisions and cannot weaken deterministic inventory invariants.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F106-SEM-01` — **Stock-state lifecycle and authoritative ledger effect**: Define movement/reservation/hold/availability lifecycle and make the stock ledger the authoritative quantity history.
- `F106-SEM-02` — **Item, warehouse/bin, lot/serial/UOM and ownership dimensions**: Freeze quantity dimensions, locations, tracking identifiers, ownership/status and source-document lineage.
- `F106-SEM-03` — **Availability, negative-stock, reservation and valuation guards**: Define available/ATP logic, allocation precedence, UOM conversion, tracking requirements, holds and negative-stock policy.
- `F106-SEM-04` — **Warehouse/location/action scope and controlled overrides**: Enforce company/warehouse/bin/action scope, restricted stock states and audited override authority.
- `F106-SEM-05` — **Scan/select/move/count/exception workflow**: Cover barcode/manual entry, work queues, bulk/scanner use, partial completion, conflicts, mobile/offline boundaries and accessibility.
- `F106-SEM-06` — **Sales/procurement/manufacturing/quality/accounting contracts**: Use public commands for reservations/movements/holds and publish idempotent effects for valuation/accounting/reconciliation.
- `F106-SEM-07` — **Last-unit race, duplicate movement, reversal and reconciliation**: Handle concurrent demand, stale availability, duplicate scans/submits, partial failure, reversal and orphan reconciliation.
- `F106-SEM-08` — **Ledger invariant, concurrency, traceability and UAT tests**: Require non-negative/allowed-negative invariants, lot/serial trace, race tests, reconciliation, E2E and human UAT.

Cross-module context: **Sales;Procurement;Manufacturing;Quality;Point of Sale;Accounting / Finance**.
Shared-platform dependencies: `SP008;SP009;SP014;SP015;SP016;SP020;SP022;SP023;SP024;SP030;SP033;SP034`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F106-PFC-01`, `F106-PFC-02`, `F106-PFC-03`, `F106-PFC-04`, `F106-PFC-05`, `F106-PFC-06`, `F106-PFC-07`, `F106-PFC-08`, `F106-PFC-09`, `F106-PFC-10`
- State transition IDs: `F106-STM-01`, `F106-STM-02`, `F106-STM-03`, `F106-STM-04`, `F106-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->
