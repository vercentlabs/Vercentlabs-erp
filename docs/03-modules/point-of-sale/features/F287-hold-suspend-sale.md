# F287 — Hold / suspend sale

## [SPEC-IDENTITY] Identity and traceability
- Canonical ID: `F287`
- Canonical name: **Hold / suspend sale**
- Module: **Point of Sale**
- Working status: `SPECIFICATION_READY`
- Readiness gate: `SPECIFICATION_READY`
- Implementation status: `NOT_STARTED`
- Product status: `NOT_READY`
- Parent capability IDs: `POS-CAP-004`
- Canonical source: `docs/02-register/FEATURE_REGISTER.csv`

## [SPEC-INTENT] Product intent and business problem
Hold / suspend sale exists to provide suspend sale without payment/stock/accounting commitment while preserving immutable cart identity/version and ownership policy. Non-goal: POS does not become the private source of truth for Stock balances/valuation, customer masters, payment-provider truth or Accounting journals.

## [SPEC-OUTCOMES] Business outcomes and success measures
- Fast, unambiguous operator completion for Hold / suspend sale.
- Exactly-once financial/physical effects and transparent exception recovery.
- Reconciliation from POS transaction identity to payment, Stock, cash/shift and Accounting evidence.

## [SPEC-PERSONAS] Personas and jobs to be done
Primary personas: cashier, cashier supervisor/store manager, retail administrator, finance/reconciliation operator, customer-service/returns operator and auditor. Negative cases include unauthorized overrides, self-approval where prohibited and cross-store/terminal access.

## [SPEC-ENTRY-POINTS] Entry points, navigation and deep links
Entry points include store/terminal setup, cashier checkout, product search/scan, cart/tender drawer, hold queue, returns, shift/cash workspace, reconciliation queue, dashboard/report drilldown and durable transaction/shift deep links.

## [SPEC-BENCHMARK] Benchmark research evidence
- `POS-P8-BM-020-A` — captured official-source benchmark evidence.
- `POS-P8-BM-020-B` — captured official-source benchmark evidence.

## [SPEC-DECISION] Vercentlabs benchmark decisions
Pass 8 adopts mature retail patterns as REQUIRED where they protect transaction/payment/stock/cash/accounting truth; vendor-specific screens/objects are not copied. See `DECISION_REGISTER.csv` entries `POS-P8-DEC-*`.

## [SPEC-OMISSION-GATE] Enterprise omission gate
Red-team review for **Hold / suspend sale** covered retail edge cases beyond the short title: multi-terminal races, uncertain provider outcomes, offline replay, duplicate scans/submits, peripheral failure, overrides, original-sale linkage, cash variance, fiscal cutoffs, reconciliation, accessibility and recovery. No unresolved material placeholder remains.

## [SPEC-SUBCAPABILITIES] Sub-capabilities and capability mapping
- `F287-CAP-001` — Hold / suspend sale MUST provide suspend sale without payment/stock/accounting commitment while preserving immutable cart identity/version and ownership policy.
- `F287-CAP-002` — Hold / suspend sale MUST define lifecycle/state, operator/device scope, authorization, overrides/approvals, correction/reversal and immutable transaction evidence where financially relevant.
- `F287-CAP-003` — Hold / suspend sale MUST expose auditable public contracts/events and evidence for Stock, customer/Sales/CRM, Accounting and shared platform interactions without direct private-table mutation.

## [SPEC-FUNCTIONAL] Functional requirements and user stories
- `F287-FR-001` — Authorized users MUST execute the primary Hold / suspend sale lifecycle from a focused POS/store workspace with actionable validation and explicit state.
- `F287-FR-002` — Users MUST inspect history, exceptions, provider/sync/reconciliation state and related sale/shift/stock/accounting evidence for Hold / suspend sale without leaking unauthorized data.
- `F287-FR-003` — Committed Hold / suspend sale facts MUST be corrected through void/refund/reversal/amendment/reconciliation mechanisms rather than silent destructive edits.
- `F287-US-001` — As an authorized cashier/operator, I can perform Hold / suspend sale quickly and understand price/payment/stock/shift state and the next safe action.
- `F287-US-002` — As a supervisor/auditor, I can prove who executed/overrode Hold / suspend sale, on which store/terminal/shift, why, and how it reconciles to payment, stock and accounting truth.

## [SPEC-FLOWS] Primary, alternate, exception, retry and reversal flows
- `F287-FLOW-001` — The primary Hold / suspend sale flow MUST validate store/terminal/shift/operator prerequisites -> authorize -> lock/version relevant transaction state -> apply one atomic POS transition -> audit -> emit idempotent public downstream intent -> show result.
- `F287-FLOW-002` — Hold / suspend sale MUST cover stale cart, duplicate submit, permission denial, stock conflict, device/peripheral failure, payment/network uncertainty, offline replay, downstream failure, retry, void/refund/reversal and reconciliation without duplicate business effect.

## [SPEC-STATE-MACHINE] State machine and transition rules
Authoritative state model: `active cart -> suspended -> resumed/revalidated -> completed/cancelled; receipt/invoice outputs linked to completed sale`. Transitions require expected state/version, server authorization, audit and linked reversal/correction for committed facts.

## [SPEC-DATA] Data model, entities, relationships and fields
- `F287-DATA-001` — Hold / suspend sale MUST persist stable organization/company/store/terminal/shift/transaction identifiers, status/version, actor/device, timestamps/timezone, customer/item/tender references and feature-specific values required for suspend sale without payment/stock/accounting commitment while preserving immutable cart identity/version and ownership policy.
- `F287-DATA-002` — Hold / suspend sale MUST retain lineage to cart/sale/line/payment/provider/stock/refund/shift/reconciliation/accounting records, overrides/approvals and correlation/idempotency/offline transaction identifiers where applicable.

## [SPEC-VALIDATION] Validation rules
- `F287-VAL-001` — Hold / suspend sale MUST reject malformed IDs/codes, inactive/cross-company/store references, invalid quantity/price/tender/lot/serial/provider states, duplicate identities and impossible combinations with actionable errors.
- `F287-VAL-002` — Hold / suspend sale MUST validate current cart/sale/shift/payment/return/offline-sync state and final Stock/payment eligibility immediately before committing financially or physically visible effects.

## [SPEC-BUSINESS-RULES] Business rules and invariants
- `F287-BR-001` — Hold / suspend sale MUST obey authoritative payment, tax, pricing, stock, cash, shift, accounting and authorization rules; AI or client UI state cannot override these invariants.
- `F287-BR-002` — Once Hold / suspend sale contributes to a completed sale, payment, refund, closed shift, Z report or accounting batch, source history MUST remain immutable and corrections MUST link to the original fact.

## [SPEC-CALCULATIONS] Calculations, precision and rounding
- `F287-CALC-001` — Hold / suspend sale calculations, if applicable, MUST define currency/unit precision, rounding and reproducible deterministic formulas; otherwise the requirement records that no derived numeric result is authoritative.

## [SPEC-VIEWS] Required view archetypes
- `F287-UX-001` — Hold / suspend sale UX MUST optimize cashier speed with clear totals/status, keyboard/touch support, exception banners, manager override path and no generic CRUD dependency for high-frequency checkout work.
- `F287-UX-002` — Hold / suspend sale tablet/terminal UX MUST handle scanner/printer/cash-drawer/payment-device/network state, explicit offline capability indicators and conflict-safe recovery without ambiguous completion.
- `F287-UX-003` — Hold / suspend sale MUST meet WCAG 2.2 AA intent with semantic labels, keyboard/focus, announced validation/status, non-color-only state, target sizing and accessible manual alternatives to scanner/touch-only actions.

## [SPEC-LIST] List, table and work-queue behavior
Lists/queues define cashier-speed defaults, stable sorting, store/terminal/shift scoping, exception badges, server pagination/virtualization where large, bulk actions only where safe and permission-aware row/action visibility.

## [SPEC-SEARCH] Search, filters, sorting and saved views
Search/filters cover product/SKU/barcode/variant/customer, transaction/receipt/provider reference, shift/store/terminal/cashier, date/tender/status/return/variance with authorization-safe counts and stable URL/saved-view state for management workspaces.

## [SPEC-DETAIL] Detail / 360 workspace
Transaction/shift detail uses a POS 360 layout: identity/status, store-terminal-shift-cashier, customer, line pricing/tax/discount, tenders/provider states, stock movements, return/refund links, cash/reconciliation/accounting references, audit and eligible controlled actions.

## [SPEC-CREATE] Create and quick-create UX
Create/quick-create covers store/terminal setup and purpose-built checkout/return initiation with required/default fields, stable transaction identity, server validation and post-create navigation; quick create cannot bypass shift/payment/stock/tax controls.

## [SPEC-EDIT] Edit, inline edit and immutable fields
Editable cart/configuration fields are separated from completed sale/payment/refund/closed-shift facts. Committed financial/physical facts require void/refund/reversal/reconciliation rather than silent inline edit.

## [SPEC-BULK] Bulk actions and selection semantics
Bulk operations are limited to safe administration/report/reconciliation use cases with dry-run/preview where material. Bulk transaction/payment/refund mutation is prohibited unless a dedicated audited job explicitly preserves idempotency and per-record authorization.

## [SPEC-ACTIONS] Primary, secondary, contextual and destructive actions
Primary/contextual/destructive actions are permission/state aware; pay/capture/void/refund, override price/discount, hold/resume, return/exchange, paid-in/out, close shift, resolve variance and post/reverse Accounting intent require confirmation/reason/manager approval as policy dictates.

## [SPEC-RELATED] Related records and contextual navigation
Related navigation uses stable public IDs/contracts to customer/Sales/CRM context, Stock movements/lot/serial, payment references, returns/refunds, shift/cash reconciliation and Accounting batches without private cross-module writes.

## [SPEC-AUTOMATION] Automation and workflow engine behavior
- `F287-AUTO-001` — Automation for Hold / suspend sale MAY prefetch/sync catalog, retry jobs, generate alerts/drafts or reconcile provider callbacks, but MUST use normal domain/system authorization, idempotency, audit and exception queues.

## [SPEC-APPROVALS] Approvals, maker-checker and segregation of duties
- `F287-APP-001` — Approval/override-required Hold / suspend sale transitions MUST snapshot material values, capture approver/reason/time, block prohibited self-approval and revalidate if cart/payment/return/shift facts change.

## [SPEC-NOTIFICATIONS] Notifications and communication behavior
- `F287-NOTIF-001` — Hold / suspend sale notifications MUST be event-driven, deduplicated, permission-safe and actionable for payment uncertainty, sync conflict, stock/serial exception, cash variance, shift close or reconciliation failure as applicable.

## [SPEC-DOCUMENTS] Attachments, generated documents, print and templates
Generated/attached documents include receipts, invoice references, return/refund/exchange evidence, shift/Z reports, reconciliation evidence and override notes. Define original/copy status, numbering/provenance, device retry/reprint, retention and permission-safe access.

## [SPEC-IMPORT-EXPORT] Import, export and migration behavior
Import/export/migration covers store/terminal config and eligible master/config snapshots with mapping, preview/dry-run, duplicate handling and audit. Completed POS/payment/shift histories require controlled migration with stable transaction identities and reconciliation.

## [SPEC-REPORTING] Reports, KPIs, analytics and drilldown
- `F287-REP-001` — Hold / suspend sale reporting MUST define formula, store/terminal/shift/cashier/timezone scope, payment/return treatment, freshness, permission-safe drilldown/export and reconciliation to immutable POS facts.

## [SPEC-AI] AI opportunities, authority boundary and safeguards
- `F287-AI-001` — AI for Hold / suspend sale MAY improve search, explain promotions, detect anomalies/fraud signals or summarize analytics, but MUST show provenance/uncertainty and MUST NOT determine payment truth, tax, stock quantity, accounting, cash reconciliation, authorization or transition legality.

## [SPEC-SECURITY] Security, permissions and field controls
- `F287-SEC-001` — Every Hold / suspend sale query/command MUST enforce server-side organization, company, store, terminal, shift, role and record scope; unauthorized pricing overrides, customer data, payment references, cash values and aggregates MUST not leak.
- `F287-SEC-002` — Sensitive Hold / suspend sale actions MUST enforce manager override/maker-checker where configured and minimize PCI-sensitive data; raw PAN/CVV MUST NOT be stored by the ERP, and provider/token references are preferred.

## [SPEC-SCOPE] Tenant, company, branch, team, owner and record scope
Scope is organization -> company -> store/outlet -> terminal -> shift -> transaction/record, with field controls for customer PII, provider references, override reasons, cash/tender values and cost/margin context. Cross-store consolidated views require elevated permission and authorization-safe aggregation.

## [SPEC-AUDIT] Auditability and history
Audit records actor/device/channel/time/reason, store/terminal/shift/transaction IDs, before/after or immutable event, manager override, provider/stock/accounting source links, request/correlation/idempotency/offline IDs and linked void/refund/reversal/reconciliation events.

## [SPEC-CONCURRENCY] Concurrency and conflict handling
Use transaction row/version locks plus Stock/public-command concurrency controls. Two terminals selling the last unit, duplicate scan/tender submit, simultaneous return, shift close during payment, or offline sync races must resolve deterministically without double charge/stock/accounting effect.

## [SPEC-IDEMPOTENCY] Idempotency, retry safety and exactly-once business effects
Sale completion, provider payment/refund, Stock issue/restock, invoice/accounting posting, loyalty effect and offline sync require stable source-scoped idempotency keys. Replay returns prior outcome/safe no-op; uncertain external results stay pending/reconcilable.

## [SPEC-INTEGRATIONS] Cross-module and external integrations
- `F287-INT-001` — Hold / suspend sale MUST consume item/customer/price/tax/stock/payment/provider facts only through versioned public contracts with source identity, scope, validation, retry semantics and reconciliation.
- `F287-INT-002` — Hold / suspend sale MUST publish Stock/customer/Accounting/loyalty effects with stable source transaction identity and idempotency key; destination modules retain private-state ownership and may reject/reconcile independently.

## [SPEC-API] Commands, queries and API contracts
- `F287-API-001` — Hold / suspend sale commands MUST define request schema, store/terminal/shift permission scope, expected state/version, idempotency for externally visible effects, domain errors, transaction boundary, audit and downstream outcomes.
- `F287-API-002` — Hold / suspend sale queries MUST define pagination/search/filter/sort, offline/freshness semantics where relevant, permission-safe aggregates, stable transaction IDs and compatibility/versioning behavior.

## [SPEC-MOBILE] Mobile-specific and offline behavior
POS is terminal/tablet-first with touch + keyboard parity, scanner/manual-code fallback, printer/payment/cash-drawer status, responsive management views and explicit offline indicator. Offline local data is encrypted/minimized and queued writes are reauthorized/revalidated on sync.

## [SPEC-RESPONSIVE] Responsive behavior
Checkout preserves primary cart/tender actions on constrained terminals/tablets; management/detail screens reflow to cards/steps on phone. Dense tables have non-horizontal alternatives and all critical safe actions retain accessible parity.

## [SPEC-ACCESSIBILITY] Accessibility contract
Target WCAG 2.2 AA: semantic controls, keyboard/focus, screen-reader announcements for scan/cart/payment state, accessible errors, contrast/target sizes, reduced motion, no color-only/payment-only cues and manual alternatives to scanner/touch gestures.

## [SPEC-VISUAL-EVIDENCE] Wireframes, diagrams and visual evidence
Reference `docs/11-visual-assets/wireframes/POS_PASS8_WORKSPACES.md` for checkout, tender, return, shift, offline/conflict and management states across terminal/tablet/mobile.

## [SPEC-PERFORMANCE] Performance, scale and data-volume envelope
- `F287-PERF-001` — Hold / suspend sale MUST define p95/p99 latency and behavior for peak multi-terminal checkout, 0/1/100/10k/1m records, bounded search/scan, background sync thresholds and no unbounded request-time scans.

## [SPEC-OBSERVABILITY] Logs, metrics, traces, jobs and support diagnostics
- `F287-OBS-001` — Hold / suspend sale MUST emit structured logs/metrics/traces with correlation, terminal/shift/transaction/provider/offline IDs, job retry/dead-letter state, payment/sync/reconciliation exception counters and support diagnostics without sensitive card data.

## [SPEC-EDGE-CASES] Edge cases, abuse cases and recovery
Cover duplicate barcode scans/submits, zero/large quantities, last-unit race, stale prices/promotions, expired coupons, lot/serial mismatch, printer/scanner/payment-device failure, network timeout after provider success, partial split tender, offline duplicate transaction ID, clock/timezone drift, shift-close race, over-return/refund replay, cash variance, provider settlement mismatch, closed accounting period and retry/recovery.

## [SPEC-CODE-AUDIT] Current-code evidence audit
- `POS-P8-CE-020` — verified current-code evidence: `database/tenant/migrations/048_point_of_sale_module.sql`.
- Evidence is a foundation/gap observation only; it does not certify the target requirement set.

## [SPEC-GAPS] Exact gap analysis
Current code provides meaningful foundations for store/terminal/shift, sale/payment/return/cash/reconciliation tables, transactional sale completion, Stock handoff, permissions and dashboard/routes. Enterprise gaps remain for full scanner/search/pricing/promotion/coupon UX, payment-provider lifecycle/callbacks, receipt/invoice devices, exchanges, offline/sync, loyalty, exhaustive reconciliation/accounting, mobile/peripheral recovery, security/PCI hardening, performance and E2E/UAT.

## [SPEC-IMPLEMENTATION] Implementation map and dependency order
Likely later implementation areas: `database/tenant`, `services/api/src/modules/point-of-sale`, Stock/Accounting/customer public contracts/orchestration/worker jobs, `apps/web/src/modules/point-of-sale`, shared types/SDK/permissions, provider/device adapters and comprehensive DB/security/fault-injection/E2E tests. Pass 8 writes documentation only.

## [SPEC-TESTS] Automated test plan
Automated plan covers pricing/tax/discount/promotion property tests, payment/refund state machines, DB/RLS/tenant-store isolation, permissions/override negative tests, duplicate/retry/idempotency, multi-terminal stock races, provider timeout/callback fault injection, offline replay/conflict, Stock/Accounting reconciliation, cash/Z invariants, migration, performance and observability.

## [SPEC-E2E] Browser and critical-journey E2E
- `F287-E2E-001` — Device/browser E2E MUST prove the primary authorized Hold / suspend sale journey including visible state, persisted transaction facts, audit and Stock/payment/Accounting contract outcome as applicable.
- `F287-E2E-002` — E2E MUST prove Hold / suspend sale permission denial, duplicate submit, stale/conflict, network/payment uncertainty/offline replay, retry and void/refund/reversal/reconciliation without duplicate charge, stock or accounting effect.

## [SPEC-UAT] Human UAT plan
- `F287-UAT-001` — A realistic cashier/store operator MUST execute Hold / suspend sale under configured device/store/shift conditions and verify visible, printed/provider, stock, cash and audit outcomes with evidence.
- `F287-UAT-002` — A supervisor/finance/auditor MUST independently verify Hold / suspend sale overrides/SoD, tender/cash reconciliation, return/refund control, downstream accounting and exception recovery before sign-off.

## [SPEC-DOD] Objective Definition of Done
Done means approved dossier requirements, benchmark + code evidence, capability/dependency/journey mappings, security/SoD/PCI boundary, deterministic pricing/payment/stock/cash/accounting contracts, responsive/device/offline/accessibility, test/E2E/UAT and omission/red-team gates are objectively satisfied. Specification readiness never certifies product readiness.

## [SPEC-OPEN-DECISIONS] Open decisions, assumptions and risks
No unresolved material placeholder blocks specification readiness. Payment-provider, fiscal-invoice and jurisdiction-specific GST/UPI implementation choices remain configurable/integration decisions and must not weaken deterministic transaction/reconciliation contracts.

## [PASS-B-SEMANTIC-FREEZE]

Status: `APPROVED` — Final Pass B semantic/sub-feature review.

The canonical F-ID remains unchanged. The following mandatory enterprise semantic scopes are owned by this dossier and must be represented by implementation/test evidence before `FEATURE_READY`:

- `F287-SEM-01` — **Checkout/session/shift transaction lifecycle**: Define terminal/session/cart/sale/return/shift states, immutable transaction identity and offline identity strategy.
- `F287-SEM-02` — **Store/terminal/cart/tender/customer/receipt linkage**: Freeze line/tax/discount/tender/stock/customer/lot-serial/cash-drawer data and original-sale linkage.
- `F287-SEM-03` — **Price/tax/promotion/tender/return rules**: Define price precedence, tax and promotion stacking, split tender, return/refund/exchange policy and loyalty earn/redeem/reversal.
- `F287-SEM-04` — **Cashier/manager/terminal/payment authority**: Enforce terminal identity, cashier permissions, manager overrides, PCI data minimization and cash/refund SoD.
- `F287-SEM-05` — **Touch/scanner/printer/offline checkout experience**: Cover fast search/scan/cart/payment/hold-resume/receipt, peripheral failures, offline feedback, keyboard/touch accessibility.
- `F287-SEM-06` — **Stock/payment/accounting/customer contracts**: Use idempotent payment callbacks, atomic stock effects, customer context and retry-safe accounting posting/reconciliation.
- `F287-SEM-07` — **Last-unit race, uncertain payment, offline replay and refund duplication**: Handle concurrent terminal sales, timeout-after-authorization, duplicate offline IDs, sync conflicts and replay-safe returns.
- `F287-SEM-08` — **Payment/stock/offline/cash reconciliation verification**: Require fault injection, duplicate callbacks, stock races, offline sync, till/Z reconciliation, E2E and UAT.

Cross-module context: **Sales;Stock / Inventory;CRM;Accounting / Finance**.
Shared-platform dependencies: `SP008;SP009;SP014;SP015;SP016;SP017;SP022;SP024;SP025;SP030;SP033;SP034`.

Pass B decision: **no new canonical F-ID required**; mature behavior expands this feature dossier rather than fragmenting the F001–F510 register.

<!-- FINAL-PASS-C:START -->
## [FINAL-PASS-C]

**Frozen user-flow and state-machine authority.**

- Flow review status: `APPROVED`
- Required flow IDs: `F287-PFC-01`, `F287-PFC-02`, `F287-PFC-03`, `F287-PFC-04`, `F287-PFC-05`, `F287-PFC-06`, `F287-PFC-07`, `F287-PFC-08`, `F287-PFC-09`, `F287-PFC-10`
- State transition IDs: `F287-STM-01`, `F287-STM-02`, `F287-STM-03`, `F287-STM-04`, `F287-STM-05`
- Authority registers: `docs/02-register/FEATURE_FLOW_REGISTER.csv`, `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Implementation must cover happy, alternate, permission/validation failure, concurrency, duplicate/retry, reversal/recovery, downstream failure and reconciliation paths; a happy-path-only screen or API cannot satisfy this feature.
- These are planning contracts only and do not promote implementation/product readiness.
<!-- FINAL-PASS-C:END -->

<!-- FINAL-PASS-D:START -->
## [FINAL-PASS-D]

**Final benchmark evidence authority.**

- Review status: `APPROVED`
- Curated authoritative benchmark IDs: `PFD-BM-F287-1`; `PFD-BM-F287-2`
- The Pass D mappings are the implementation-planning benchmark authority for **Hold / suspend sale**.
- Legacy benchmark rows remain in the evidence register for provenance, but any row classified `REMAP_REQUIRED`, `NEEDS_BETTER_SOURCE`, or `NEEDS_BETTER_FINDING` in `BENCHMARK_EVIDENCE_AUDIT.csv` is non-authoritative.
- Benchmark sources inform expected enterprise behavior; the Vercentlabs canonical dossier, Pass B semantic scope, Pass C state/flow contracts and explicit architecture decisions remain normative.
<!-- FINAL-PASS-D:END -->
