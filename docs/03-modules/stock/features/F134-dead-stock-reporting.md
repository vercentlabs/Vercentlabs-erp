# F134 — Dead-stock reporting

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F134`
- Canonical name: **Dead-stock reporting**
- Module: **Stock / Inventory**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `STOCK-CAP-007`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Identify dead stock using policy thresholds, exclusions and explainable evidence without auto-writing off inventory.

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
- `STOCK-P4-BE-075` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.
- `STOCK-P4-BE-076` — official primary benchmark evidence in `BENCHMARK_REGISTER.csv`.

## [SPEC-DECISION] Vercentlabs benchmark decisions
- `REQUIRED`: mature inventory integrity, warehouse execution, traceability, valuation and reconciliation behavior.
- `DIFFERENTIATOR`: coherent Vercentlabs capability-oriented UX/contracts instead of copied vendor object structures.
- `NOT_APPLICABLE`: vendor-specific licensing/object names and features outside the canonical product scope.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Independent omission review covered **enterprise states, permissions, dimension grain, concurrency, failure/retry/reversal, cross-module lineage, responsive UX, audit, reporting and scale behavior expected for Dead-stock reporting**. These expectations are requirements or explicit boundaries; none are silently omitted because the canonical title is short.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F134-CAP-001` — The Dead-stock reporting capability MUST identify dead stock using policy thresholds, exclusions and explainable evidence without auto-writing off inventory.
- `F134-CAP-002` — The capability MUST explicitly cover enterprise states, permissions, dimension grain, concurrency, failure/retry/reversal, cross-module lineage, responsive UX, audit, reporting and scale behavior expected for Dead-stock reporting; the canonical title is a traceability anchor, not complete scope.
- `F134-CAP-003` — Dead-stock reporting MUST preserve Stock ownership of physical quantity/stock-ledger effects and use public contracts for Procurement, Sales, Manufacturing, Quality, POS, Projects, Assets and Accounting effects.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F134-FR-001` — The system MUST provide a server-backed Dead-stock reporting workflow covering success, validation, permission, conflict, downstream failure, reversal/recovery and audit states.
- `F134-FR-002` — Every material Dead-stock reporting mutation MUST preserve actor, effective/posting time, reason, source reference, prior/new state or immutable event, and downstream lineage.
- `F134-FR-003` — Dead-stock reporting MUST remain usable at enterprise item/location/movement volumes through stable pagination, indexing, batching, virtualization or background processing as appropriate.
- `F134-US-001` — As an authorized warehouse/inventory operator, I can perform Dead-stock reporting accurately without bypassing quantity, traceability, quality, costing or permission controls.
- `F134-US-002` — As an inventory manager/controller, I can review exceptions, history, reconciliation and policy for Dead-stock reporting within my permitted company/warehouse scope.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F134-FLOW-001` — The governed lifecycle MUST follow ACTIVE/VALID -> versioned change or controlled inactivation; posted historical facts remain immutable, with explicit guards and no silent history rewrite.
- `F134-FLOW-002` — Validation, permission, concurrency and downstream failures for Dead-stock reporting MUST be actionable and safely retryable without duplicate physical, reservation, valuation or accounting effects.

Lifecycle reference: `ACTIVE/VALID -> versioned change or controlled inactivation; posted historical facts remain immutable`.

## [SPEC-STATE-MACHINE] State machine and transition rules
- Aggregate owner: Stock domain service for **Dead-stock reporting**.
- Lifecycle: `ACTIVE/VALID -> versioned change or controlled inactivation; posted historical facts remain immutable`.
- Transitions require current state/version, authorization, dimension eligibility and invariant checks.
- Posted movement facts are corrected by reversal/compensation, never silent mutation.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F134-DATA-001` — The Dead-stock reporting model MUST define organization/company, item, warehouse/location and lot/batch/serial dimensions as applicable, with stable keys, constraints, indexes, retention and lineage.
- `F134-DATA-002` — Quantity, UOM, cost, status, source and policy values that determine historical Dead-stock reporting interpretation MUST remain reproducible after master/configuration changes.

## [SPEC-VALIDATION] Validation rules
- `F134-VAL-001` — All Dead-stock reporting commands MUST validate tenant/company scope, item/location eligibility, UOM, quantity sign/precision, tracking/status rules, lifecycle and reference integrity server-side.
- `F134-VAL-002` — Dead-stock reporting failures MUST use stable domain error codes and corrective guidance without exposing unauthorized cost, supplier, customer or cross-company data.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F134-BR-001` — The Stock domain command responsible for Dead-stock reporting is authoritative; UI, API, import, barcode, automation and AI paths MUST reuse the same invariant checks.
- `F134-BR-002` — Posted stock facts for Dead-stock reporting MUST be corrected by reversal/compensation or linked adjustment, never by rewriting authoritative movement history.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F134-CALC-001` — All authoritative quantity, availability, ATP, conversion, valuation, aging or replenishment calculations applicable to Dead-stock reporting MUST use deterministic decimal/date rules with explicit precision and reproducible inputs; AI is never authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F134-UX-001` — The Dead-stock reporting workspace MUST expose item/location identity, state, quantity/cost facts as permitted, source/next action, exceptions, related records and history in one coherent Stock shell.
- `F134-UX-002` — Desktop/tablet/phone views for Dead-stock reporting MUST define loading, empty, validation, permission, stale/conflict, offline/retry, destructive confirmation and success states.
- `F134-UX-003` — Warehouse-heavy Dead-stock reporting interactions MUST support keyboard operation, touch-safe controls, scanner/manual alternatives, visible focus and non-drag alternatives.

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
- `F134-AUTO-001` — Automation MAY create proposals/work for Dead-stock reporting only through idempotent Stock/public commands; no automation may directly mutate stock balance tables.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F134-APP-001` — Where policy requires maker-checker for high-value adjustments, negative-stock exceptions, count variances or quality release affecting Dead-stock reporting, approval MUST bind to the exact version/value being approved.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F134-NOTIF-001` — Notifications for Dead-stock reporting MUST be event-driven, deduplicated, preference/permission aware and deep-link to the exact exception or work item without leaking restricted data.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Attachments/labels/count sheets/pick-pack documents/traceability exports use permission-safe templates, durable references, generated-at metadata and reprint history where material.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Imports require mapping, dry-run/preview, dimension validation, duplicate/idempotency policy, background jobs and failure rows; exports respect company/warehouse/cost permissions and as-of semantics.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F134-REP-001` — Reports/KPIs for Dead-stock reporting MUST define grain, filters, freshness, drilldown, as-of semantics and reconciliation to authoritative movement/balance/valuation records.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F134-AI-001` — AI for Dead-stock reporting is limited to assist/recommend/generate workflows with provenance, explanation and permission filtering; it MUST NOT be authoritative for stock quantity, reservation, valuation, traceability, quality holds or posting legality.

## [SPEC-SECURITY] Security, permissions and field controls
- `F134-SEC-001` — Every Dead-stock reporting query and mutation MUST enforce authentication, module entitlement, organization/company/warehouse scope, action permission and record/dimension visibility server-side.
- `F134-SEC-002` — Cost/valuation, customer/supplier references and administrative configuration in Dead-stock reporting MUST be field/action restricted and protected against IDOR, aggregate leakage and unauthorized export.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Every Stock query/mutation is organization-scoped and company-scoped; warehouse/location access is an additional dimension where configured. Cross-company inventory is never inferred by absence of UI filters.

## [SPEC-AUDIT] Auditability and history
Audit records actor/channel/time, request/correlation/idempotency key, source document, state/reason, before/after master configuration when mutable, movement/reversal links and downstream event references.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Physical quantity/reservation/valuation mutations use transaction-scoped locking or equivalent atomic compare-and-update at the authoritative dimension grain. Lock ordering, deadlock retry and stale-work recovery are specified.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Externally visible stock effects require idempotency keys/source-effect uniqueness, replay/no-op behavior, durable outbox semantics and reconciliation for uncertain downstream delivery.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F134-INT-001` — Inbound cross-module requests affecting Dead-stock reporting MUST call a versioned public Stock command with authorization, idempotency key, source reference, validation and explicit failure result.
- `F134-INT-002` — Outbound effects from Dead-stock reporting MUST use outbox/public events or orchestration with retry, reversal/compensation and reconciliation; Stock MUST NOT write another module’s private tables.

## [SPEC-API] Commands, queries and API contracts
- `F134-API-001` — Dead-stock reporting mutation APIs MUST define request schema, authorization, idempotency, expected state/version, stable errors, audit/outbox effects and compatibility semantics.
- `F134-API-002` — Dead-stock reporting query APIs MUST define dimension grain, pagination/filter/sort, as-of/freshness semantics, authorization-safe aggregates and stable response contracts.

## [SPEC-MOBILE] Mobile-specific and offline behavior
Receiving, transfers, picking, counting, packing, shipping and traceability lookup define scanner-first phone/handheld flows, manual fallback, offline boundaries, reconnect/retry and device-security behavior.

## [SPEC-RESPONSIVE] Responsive behavior
Desktop supports dense grids and multi-pane workspaces; tablet supports warehouse work; phone transforms grids into actionable cards/step flows without losing critical actions or exception evidence.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantic labels/headings, full keyboard support, visible focus, status/error announcements, sufficient target sizing/contrast, non-color status cues, reduced motion and non-drag/manual alternatives to scanning.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/STOCK_PASS4_WORKSPACES.md` plus journey/state diagrams in Stock architecture and cross-module contracts.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F134-PERF-001` — Dead-stock reporting MUST define performance envelopes for 0/1/100/10k/1m movement or dimension records as applicable, with bounded queries and explicit asynchronous thresholds.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F134-OBS-001` — Dead-stock reporting MUST emit structured logs/metrics/traces for failures, retries, lock contention, drift/reconciliation, job lag and downstream delivery with correlation IDs.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Red-team cases include duplicate/replayed scans, concurrent reservation/issue, backdated movement, expired/held stock, partial transfer/shipment, serial reuse, UOM rounding drift, count during movement, failed downstream accounting event, valuation reversal, stale ATP and cross-company IDOR.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- Verified current-code evidence: `STOCK-P4-CODE-038` → `apps/web/src/modules/stock/components/stock-dashboard.tsx`.
- Evidence describes present foundations only; absence or presence never auto-certifies the canonical feature.

## [SPEC-GAPS] Exact gap analysis
Implementation/product readiness remains explicitly unverified. Pass 4 requires later code-level proof for every approved requirement, especially transaction isolation, quality-hold interlocks, valuation-layer integrity, historical/as-of reporting, warehouse mobile execution and cross-module reconciliation.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Implement by capability and journey, not one source folder per F-ID. Priority order: inventory identity/dimensions -> ledger/locking/idempotency -> reservations/availability/ATP -> traceability/status -> warehouse execution/counting/replenishment -> valuation/reconciliation -> analytics/reporting.

## [SPEC-TESTS] Automated test plan
Automated tests require domain/unit math, database/RLS and concurrency, API contract/auth-negative, idempotency/retry, cross-module integration, property/invariant tests for quantity/valuation, migration/data-reconciliation, performance and observability diagnostics.

## [SPEC-E2E] Browser and critical-journey E2E
- `F134-E2E-001` — E2E MUST prove an authorized operator can complete the primary Dead-stock reporting journey and observe correct quantity/state/history/downstream references.
- `F134-E2E-002` — E2E MUST cover unauthorized access, invalid/stale data, concurrent/replayed mutation and one relevant failure, short/partial, hold, reversal or reconciliation path for Dead-stock reporting.

## [SPEC-UAT] Human UAT plan
- `F134-UAT-001` — A real warehouse/inventory operator MUST execute the primary Dead-stock reporting job with realistic data on desktop and an appropriate mobile/scanner path, capturing visible and data evidence.
- `F134-UAT-002` — An inventory manager/controller plus relevant Quality/Finance/Sales/Procurement persona MUST verify permissions, exception/reversal behavior, audit and cross-module reconciliation for Dead-stock reporting.

## [SPEC-DOD] Objective Definition of Done
Objective completion requires approved requirements with implementation/test evidence; server authorization; valid state transitions; deterministic quantity/UOM/availability/valuation; idempotent/auditable cross-module effects; responsive/accessibility evidence; actionable recovery; reconciliation and executed UAT. A page, table, endpoint or existing code artifact alone is insufficient.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder remains for Pass 4 specification readiness. Implementation-time configuration choices (for example permitted negative-stock exceptions, valuation method by item group, removal strategy and warehouse work policy) must be recorded as explicit decisions and cannot weaken deterministic inventory invariants.
