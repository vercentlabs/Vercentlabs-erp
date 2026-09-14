# Production Tracker

Replaces the old five-GO/Codex/human-UAT choreography that used to live under `00-program/`, `07-testing/` through `10-uat/`. Requirements stay in the registers/dossiers (`docs/README.md`); this file only tracks how far each module actually is.

## Verification methodology (revised 2026-09-05 after owner challenge)

"Production ready" now means a full atomic-requirement trace: every row in `SUBREQUIREMENT_REGISTER.csv` for a feature is checked against real, cited code/test evidence (file+line), not pattern-matched by test name. `FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv`, `FEATURE_FLOW_REGISTER.csv` and `FEATURE_STATE_TRANSITION_REGISTER.csv` were found to be ~90%+ generated boilerplate (identical text across thousands of rows, and in some cases placeholder state names that contradict the feature's own real state machine) — see commit history for the measurements. They are not traced row-by-row; the dossier + subrequirement register are the real source of truth.

Per-feature output is `docs/03-modules/<module>/features/F###-AUDIT.md` with a verdict (PASS/PARTIAL/GAP/NOT INDEPENDENTLY VERIFIED) and cited evidence per row. Gaps found during the trace are **recorded, not fixed inline** — fixing happens in one dedicated pass per module after all its features are traced, so the trace isn't constantly context-switching into implementation. Exception: a live, exploitable, cross-cutting security bug (like the approval-rejection permission bypass found this session) gets fixed immediately regardless of what pass is in progress.

## Definition of "production ready" (per feature)

A feature counts as done when, for its dossier's requirements:
- domain rules/state machine live in the module's backend service, not the UI;
- every mutation is server-authorized (tenant/company/branch/record scope) and audited;
- the full user-facing surface exists (list/detail/create/edit as applicable) with loading, empty, error, permission, and conflict states;
- concurrency/idempotency is handled where the dossier requires it;
- an automated test exercises the behavior (unit/API/security-negative as applicable);
- the dossier's `Implementation status` / `Product status` fields are updated to match reality.

"Code exists" is not the bar — reconcile against the dossier before marking anything done.

## CRM (module 1/12): production-ready — gap-closing pass complete (2026-09-06)

**2026-09-14 addendum:** the standing "no live E2E" gap noted below is now
closed — `test:e2e:crm` runs end-to-end against a real database and real
browser. Doing so for the first time found and fixed two real, previously
undetected production bugs invisible to CRM's fake-DB-client unit-test
convention: (1) a live concurrency bug (concurrent `client.query()` on one
shared `PoolClient`, reproduced as a Postgres `08P01` protocol violation)
across 22 call sites in the CRM module, and (2) a deterministic bug where 8
of 14 `getCrmReport()` report types always fail against a real database
(parameter-count mismatch). Full detail, root-cause evidence, and remaining
follow-ups in `docs/ERP_COMPLETION_EXECUTION_TRACKER.md`. Does not change
CRM's PASS verdicts below — these were infrastructure/reliability bugs
outside what the atomic-requirement trace covers, not defects in the
traced business logic — but is exactly the kind of gap the "no live E2E"
caveat was flagging.

All 30 features fully traced; every real, reasonably-scoped gap the trace found is fixed (17 fixes, each with its own migration where needed, real regression tests, and clean `tsc`/`eslint`/`verify:db`/`verify:architecture`). The items left in "Real but scoped gaps" below are deliberately **not** fixed — they are multi-day feature additions (new entities, a notification-delivery subsystem, an import-engine redesign, forecast-backtesting analytics), not gaps in what CRM already claims to do; closing them is new scope, decided against for now in favor of moving to the next module. Standing E2E/UAT/load-testing gaps remain, as noted below — these need a human, not more code.

All 30 features (F001-F030) traced against `SUBREQUIREMENT_REGISTER.csv` with cited code evidence — see `docs/03-modules/crm/features/F0##-AUDIT.md` for each. Consolidated gap list for the gap-closing pass:

**Fixed (2026-09-05):**
- F003 Contacts: sensitive-field redaction for email/phone/mobile added (`contact-security.js`, mirrors Leads).
- F022 Conversion: converted-lead immutability now enforced in `assertLifecycleUpdate`.
- F020 Territories: cycle detection added on `parent_territory_id` (copied F002 Accounts' recursive-CTE pattern).
- F028 Custom fields: field-level role visibility added (`visible_to_roles`), enforced on both read (redaction) and write (block).
- F013 Calls: unused 10-table telephony/recording/transcription schema dropped per owner decision; Calls stays manual-logging only.
- F016 Follow-ups: "My Follow-ups" rewired to the lead nurture queue per owner decision — the "gap" was a naming/wiring problem, not missing engineering (30/37 rows now PASS, biggest single jump in the pass).
- F010 Pipeline board: stale-deal/aging data (already computed by `evaluateOpportunityHealth`) is now rendered on each card as overdue/stale badges; stage's `stale_after_days` threshold is now selected and compared.
- F003 Contacts: added `reactivateCrmContact` (mirrors `archiveCrmContact`), wired to `PATCH .../contacts/[id]` with `{action:"reactivate"}` and a "Reactivate" button on the detail page; blocks reactivation while the linked account is still archived.
- F009 Opportunities + F026 Won/lost reasons: `moveOpportunityStage` now allows a won/lost opportunity to reopen into a non-terminal stage of the same pipeline (required reason, `archived` opportunities stay permanently blocked). Migration `078_f009_opportunity_reopen_history.sql` adds `status`/`outcome_reason_id`/`outcome_reason_label`/`outcome_notes` to `crm_opportunity_stage_history`, so every close and reopen is permanently snapshotted with the reason's label at that moment — this single change closed F009's reopen gap and F026's reason-label-snapshot gap together, since they were the same missing capability. Governed "Reopen" UI added to the Opportunity detail page; stage-history timeline now shows the snapshotted outcome per transition.
- Module-wide: the 3 known-missing automation trigger call sites (`lead.updated`, `lead.qualified`, `campaign.member_responded`) now fire from `updateCrmRecord`, `decideLeadQualification` and `captureCrmLead` respectively — all 7 `crm_automation_rules.event_type` values have a real call site.
- F019 Activity timeline: added `getLeadTimelinePage` + `GET /api/crm/leads/[id]/timeline` so activities/communications can page past their initial 200-row cap; correction along the way — the audit's originally-cited `getLeadTimeline` function turned out to be dead code, the real path is `getLeadDetailData`.
- F029 Bulk actions: added job cancellation (migration `079` adds `'cancelled'` to `background_jobs.status`, exactly the additive migration 052's own comment anticipated) and per-row retry (`retryFailedLeadBulkJobItems` re-queues only the previously-failed rows of a finished job, not the whole selection).
- F008 Duplicate detection: added a "dismiss" outcome distinct from override — `dismissLeadDuplicateMatch` marks a *probable* candidate as reviewed-and-not-a-duplicate (never an exact match, which still requires the separate per-write override), reusing the existing immutable `crm_lead_duplicate_overrides` ledger with a new `operation='dismiss'` value.
- F028 Custom fields: added dependent-option picklists (`depends_on_field_key`, migration `081`; `options` becomes a `{parentValue:[childValues]}` map for a dependent field) and a required-field-rollout safety check (`assertCustomFieldRequiredRolloutSafe` blocks marking a field required while active records lack a value for it, unless explicitly confirmed).
- F004 Lead sources: added original-vs-current source lineage (`crm_leads.original_source_id`, migration `082`, fixed at creation and permanently immutable afterward) and a `referrer_name` field for referral/campaign attribution details (`campaign_id` already existed).
- F006 Lead qualification: readiness criteria moved from a hardcoded JS array to `tenant.crm_lead_qualification_criteria` (migration `083`, seeded per-organization at creation and backfilled for existing orgs) — genuinely admin-editable at CRM Setup → Lead management → "Qualification criteria". While wiring this, found and fixed a related bug: F028's `custom-field-definitions`/`custom-records` admin UI existed but was unreachable by any live route (not in `scope.ts`'s resource-key lists) — now exposed under Setup → Customization.
- F005 Lead assignment: added out-of-office awareness (`crm_lead_assignee_availability`, migration `084`, excluded from round-robin/workload/territory/fixed automatic assignment, never blocks manual assignment), a fallback owner (`crm_lead_assignment_fallback`, checked once, last, after every policy fails), and a scheduled Lead-SLA-breach/reassignment tick (`crm.automation.detect_lead_sla_breaches`) — the reassignment domain logic (`scanLeadSlaBreaches`) already existed and was correct, it just had no scheduled trigger, only a manual "Scan now" action.

**Correction, not a fix needed:** F008 Duplicate detection's "merge is unreachable" finding was wrong (twice) — the merge workflow (backend + route + UI + confirmation) is fully built and working. Root cause: bash `**` globs silently fail to recurse into `[id]` route directories in this environment without `shopt -s globstar`; several existence checks this session used that pattern. Re-verified with the Grep tool: F009/F013/F003-reactivation/F016-reminders/F029-cancellation all hold up; F008 was the only false negative found. F008's remaining gaps (dismiss now fixed, see Fixed list above): matching rules hardcoded, no cross-object (Lead vs Contact/Account) matching, no field-conflict reconciliation on merge.

**Real but scoped gaps:**
- F007 Lead stages: transition graph is adjacency-based not truly directional; no dwell-SLA; no reason-code vocabulary; no live-config migration tooling.
- F008 Duplicate detection: matching rules hardcoded, no cross-object matching, no field-conflict reconciliation on merge (see correction above).
- F009 Opportunities: no stakeholders/products/risks/close-plan entities.
- F014 + F016: no confirmed reminder-notification delivery mechanism anywhere (cross-feature, worth one dedicated investigation) — re-verified with Grep tool, holds up.
- F021 Import/export: no dry-run, no upsert policy, no async/resumable path over 1,000 rows.
- F025 Sales forecast: no accuracy/backtesting.
- Module-wide: AI-adjacent dossier requirements (AI-001) are consistently unbuilt — this is a real, consistent scope gap, not a bug.

**Standing, not feature-specific:** no live E2E was run (blocked earlier on missing auth/seed fixtures — still unresolved), no human UAT (cannot be performed by the AI — needs the owner), no load/perf testing exists anywhere in CRM.

**Best-in-class patterns worth reusing elsewhere in the codebase:** F027's deterministic scoring engine, F024/F030's cross-referenced dashboard/report security hardening, F021's shared formula-injection-safe CSV export, F017's fail-closed malware scanning, F012's disjoint-temporary-sequence reorder algorithm, F005/F014's correct concurrency locking.

## Sales (module 2/12): trace and gap-closing pass complete (2026-09-06)

9 fixes landed in the gap-closing pass (pagination, F034 invalidate+companySql+a live fake-reservation bug found and fixed along the way, F035 reason capture, F038 quotation expiry, F039 header discount, F040 dead-schema drop, F042 CRM boundary fix, F057 auto-accrual), on top of the 2 live security bugs fixed during the trace itself. **Sales-to-Stock (F046 release-on-cancel, F047 fulfilment-to-real-movement) closed in a later "full completion" pass (Phase 2, 2026-09-06)** — see the entry below. Still deliberately left open as genuine multi-day feature builds, same treatment as CRM's leftover items: F045/F048/F049's remaining pieces (backorders, shipment/carrier tracking — scoped down per owner decision, not yet built), the Sales-to-Accounting financial reconciliation (F052/F053/F062 — advance payments, credit exposure, payment-status sync), the request-without-consumer cluster (F054/F055/F056 — returns, credit notes, drop-ship), F041's approval-infrastructure gaps (multi-stage/delegation/escalation), F033's item-variant/write-in gaps, and F060's thin analytics capability.

All 32 features (F031-F062) traced against `SUBREQUIREMENT_REGISTER.csv` with cited code evidence — see `docs/03-modules/sales/audits/F0##-AUDIT.md` for each. Two live, cross-cutting security bugs were found and fixed immediately during the trace (below); every other real gap found is recorded here for a dedicated gap-closing pass, mirroring CRM's structure. The trace surfaced one dominant theme worth reading before starting that pass: **the quotation/order commercial core (F031-F044, F050-F051, F057-F059, F061) is excellent, careful engineering** — real concurrency correctness (advisory-locked credit checks), genuine state machines with stale-approval invalidation, idempotent cross-module handoffs, deterministic pricing/tax/margin calculation. **The physical and financial connective tissue to Stock and Accounting (F045-F049, F052-F056, F062) is the weak half** — a consistent pattern of well-validated "request" tables and computed signals with no downstream consumer or action, confirmed in one case (`docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md`) to be a documented architecture requirement that was simply never built.

F031 Customer master was traced first (Sales doesn't own a customer entity — it consumes CRM's `tenant.business_parties` read-only, so this feature is really about that consumption boundary and the read paths built around it). See `docs/03-modules/sales/audits/F031-AUDIT.md`.

**Fixed immediately (live, cross-cutting security bugs, per the methodology's own exception):**
- Cross-company data leak: `getSalesOptions` and all 9 `getSalesReport` variants filtered only by `organization_id`, with zero `company_id` scoping, despite `business_parties`/`items`/`warehouses`/`crm_opportunities`/`sales_quotations`/`sales_orders` all carrying a `company_id` column and RLS in this system being organization-only everywhere (no company/branch-level RLS exists at all — that scoping is an application-layer responsibility per query, confirmed by reading the RLS-application migration block). A user restricted to one company could see every other company's customers, items, warehouses, opportunities, quotations, orders and margin data. Fixed by mirroring the already-correct `getSalesDashboard` convention (and CRM's own `companyVisible()` pattern) across both functions, fail-closed when there's no active company. Regression-tested in `services/api/tests/sales-options-company-scope-f031.test.mjs`.
- Cost-permission bypass: `getSalesOptions`'s `items` query returned `standard_cost` unconditionally to any `sales.view` caller, bypassing the `sales.margin.view` gate the rest of the module enforces consistently (`redactMargin` on quotation/order reads, an explicit permission check on the `margin` report). Fixed by routing `getSalesOptions`'s return through the existing `redactMargin` helper instead of a new mechanism. The web app doesn't currently read this field, so there was no UI to update.

**Real but scoped gaps found, recorded for the Sales gap-closing pass:**
- ~~Pagination: `getSalesOptions` unbounded, `listQuotations`/`listSalesOrders` fixed-200 with no offset...~~ **Fixed in the gap-closing pass:** `getSalesOptions`'s customer/item/warehouse picker queries now cap at `LIMIT 500`; `contacts`/`addresses` (which previously joined across every customer in the org on every load) now accept an optional `partyId` to scope to one customer's own records once selected, falling back to the same 500-row cap otherwise. `listQuotations`/`listSalesOrders` both accept `limit`/`offset` filters (clamped 1-500, default 200/0 — unchanged default behavior for existing callers). Not yet done: a `hasMore`/total-count signal, which would need a return-shape change touching the frontend callers too — left for a future pass since it's a bigger, distinct piece of work than closing the raw pagination gap.
- F033 Products: no item-variant support on sales lines (`item_variants` exists, owned by Stock/F100, but `sales_quotation_lines`/`sales_order_lines` only reference `item_id`); no write-in/non-catalog line policy (undocumented either way).
- ~~F034 Price lists: no explicit invalidate action...~~ **Fixed in the gap-closing pass:** added `deactivateSalesPriceListItem`/`deactivateSalesPricingRule` (wired to `pass1-operations` route actions `deactivate-price-list-item`/`deactivate-pricing-rule`), and reconciled `pass1-operations.js`'s `companySql` helper to the same `companyVisible`-style precedence (`allowAllCompanies` first, then `company_id IS NULL OR company_id=active`, fail-closed otherwise) used by `getSalesDashboard`/`getSalesOptions`.
- ~~F035 Customer-specific prices: no reason capture for a standing negotiated price...~~ **Reason half fixed in the gap-closing pass:** migration `085` adds a nullable `reason` column to `sales_pricing_rules`; `upsertSalesCustomerPrice` now requires one on create and update, matching the same discipline the one-off manual line override already had. Still open: no customer-*group* pricing tier (individual customer only), and no approval workflow before a negotiated price takes effect (bigger work, reuses the F041 approval infrastructure that itself needs multi-stage/delegation work first).
- ~~F038 Quotation expiry: nothing ever transitioned a quotation to expired; the public accept gateway didn't check valid_until at all...~~ **Fixed in the gap-closing pass:** `resolvePublicQuoteToken` now checks the quotation's own `valid_until` in real time (independent of scan cadence); a new `scanExpiredQuotations` domain function + `sales.automation.detect_expired_quotations` worker tick (third scheduled tick, alongside the overdue-activity and Lead SLA ticks) transitions past-due `approved`/`sent`/`viewed` quotations to `expired`. Not fixed (lower priority, still open): no reminder-window notifications, no lightweight "extend validity" action short of a full revision.
- ~~F039 Discounts: no header/document-level discount mechanism existed...~~ **Fixed in the gap-closing pass:** `previewSalesDocument` accepts an optional `headerDiscountPercent`, applied once across the whole document total, folded into `discountTotal`/`maximumDiscountPercent` (so it's still caught by the existing discount-threshold approval gate) and gated behind `sales.price.override`. Wired into the document editor UI.
- ~~F040 Taxes: an unused parallel tax-group schema needed an owner decision...~~ **Resolved in the gap-closing pass:** dropped, matching the CRM F013 precedent (migration `086`). `tenant.sales_tax_groups`/`sales_tax_group_components` and the `tax_group_id` column are gone; `calculateLine`'s real inline CGST/SGST/IGST engine is the only tax model now.
- **F041 Approval workflow (cross-module — this is the shared `approval_requests` infrastructure every module's approvals go through, not Sales-specific):** no multi-stage approval chains (one decision point per request only), no delegation (a pending approval's assignee can't be reassigned), no escalation or staleness handling (grepped the whole worker service: nothing ever touches `approval_requests` — a pending approval can sit forever with no system-driven follow-up). Fixing any of these benefits every module using approvals, not just Sales.
- ~~F042 Sales orders: `confirmSalesOrder` closed the source CRM opportunity with a raw UPDATE instead of CRM's own `moveOpportunityStage`, with no reversal on cancel...~~ **Fixed in the gap-closing pass:** `confirmSalesOrder`/`cancelSalesOrder` now only report `sourceOpportunityId`; new orchestration wrappers `confirmSalesOrderWithCrmSync`/`cancelSalesOrderWithCrmSync` (`services/api/src/orchestration/sales-crm-opportunity-sync.js`) call CRM's real `moveOpportunityStage` to close (using the pipeline's won stage + the seeded `WON_OTHER` reason) and reopen on cancel (into the pipeline's first non-terminal stage, only if still `won`) — producing real `crm_opportunity_stage_history` rows, with a CRM-side misconfiguration never blocking the Sales action itself. The order-actions route now calls these wrappers. Also removed the now-resolved `sales`→`crm_opportunities` entry from `scripts/validation/module-boundary-debt.json` (`verify-platform-foundation` clean).
- **Correction (2026-09-06): F045/F046 were initially reported as complete gaps — wrong.** The original research grepped only `services/api/src/modules/sales/` and missed `services/api/src/orchestration/`, a separate directory holding real cross-module integration code. `services/api/src/orchestration/sales-stock-reservation.js` genuinely implements both availability checking (`checkSalesOrderLineAvailability`, calls Stock's real `getStockAvailability`) and reservation (`reserveSalesOrderLineFromStock`, calls Stock's real `reserveStock`, which really updates `tenant.stock_balances.reserved_quantity` — confirmed by an existing passing test). Both audits corrected in place; see `docs/03-modules/sales/audits/F045-AUDIT.md`/`F046-AUDIT.md` for the full correction.
- **F046 (real finding despite the correction above, found while wiring the F034 fix and fixed immediately in this pass):** `reserveSalesOrderLines` (the *local-only* mirror function the orchestration layer calls internally, after a real Stock reservation succeeds) was **also directly exposed** on `POST /api/sales/orders/operations` as a bare `reserve_lines` action, with no Stock call at all — a caller hitting that route got a success response implying stock was reserved when only the local counter moved. Fixed by removing the duplicate unsafe route action (the UI never called it — only latent API exposure); the correctly-integrated `pass1-operations` route (`action: "reserve-stock"`) is the only reservation entry point now. One real gap remains, not yet fixed: no reservation-release path exists anywhere when an order is cancelled.
- F047 Partial fulfilment: still a real, confirmed gap after re-checking `orchestration/` for a similar wrapper (none exists) — `completeFulfillmentRequest` never calls Stock's canonical `postStockMovement`; fulfilling a Sales order updates only Sales' own bookkeeping with no real inventory effect. Smaller gap also found: no delivery tolerance or remainder-cancellation action.
- F048 Backorders / F049 Delivery and shipment: still real, confirmed gaps after the same re-check — no backorder entity, no shipment/carrier/tracking entity anywhere. Unlike F045/F046, no orchestration-layer integration exists for either.
- Note: F042's cross-module boundary finding (Sales writing directly to `tenant.crm_opportunities`) turned out to already be tracked as known, grandfathered debt in `scripts/validation/module-boundary-debt.json` — not a newly-discovered violation, but still worth fixing since the file's own description invites Sales feature work to pay it down. F050/F051 (invoice request handoff to Accounting) are the encouraging counter-example: genuinely well-built, idempotent, savepoint-protected, with live-quantity re-validation preventing over-invoicing — only the inverse direction of the same known debt class (Accounting writes into Sales' tables directly, also already tracked).
- **F052 Advance payments — same severity class as F046, real money this time.** `recordSalesAdvancePayment` is a bare local-table insert with correct cumulative-total validation, but it never creates any real financial transaction (no Accounting journal entry, no cash/bank posting) and nothing anywhere ever reconciles a recorded advance into a final invoice (`applied` status is referenced in queries but never actually set by any code). Recording an advance has zero real financial-ledger effect.
- F053 Credit limits: the concurrency/override/audit halves are excellent (advisory-locked exposure check, mandatory override reason), but "exposure" only ever means other open Sales orders — it has no visibility into the customer's actual overdue Accounting AR balance or unapplied advance payments (both explicitly named in the dossier). Connects directly to F052 — fixing that reconciliation gap would give this check something real to net against.
- **Systemic pattern confirmed across F054/F055/F056 (returns, credit notes/refunds, drop-shipping): "request created, never consumed."** Each has a well-validated creation function (`createSalesReturnRequest`, `requestSalesCreditAdjustment`, `createSalesDropShipRequest`) but zero downstream consumer — grepped for `UPDATE` on each request table, zero matches for all three. F056 is the one bright spot on cross-module *validation* (checks the supplier through Procurement's public contract before inserting), but still has no Procurement-facing surface to act on the request. Recommend the gap-closing pass sweep every `sales_*_request(s)` table for a real consumer as one effort rather than fixing each in isolation.
- ~~F057 Sales commissions: accrueSalesCommission was only reachable via a manual action...~~ **Triggering half fixed in the gap-closing pass:** `confirmSalesOrderWithCrmSync` now also calls `accrueSalesCommission` automatically on order confirmation (best-effort — no applicable rule is a normal outcome, never blocks confirmation). Still open, deliberately deferred as larger work: the `accrued -> approved -> paid -> reversed` lifecycle never progresses past `accrued`, and nothing in HR & Payroll ever reads it to actually pay a commission out.
- ~~F059 Order status tracking: `readyToClose` was computed but never acted on...~~ **Fixed in the gap-closing pass:** added `closeSalesOrder` (order-governance.js), gated on `sales.order.confirm`, re-validating readiness via the existing health engine before transitioning `confirmed`/`on_hold` -> `closed`; wired to a new `close` action on the order-actions route and a "Close order" button in the document-actions UI.
- F060 Sales analytics: the report queries themselves are solid (and now correctly company-scoped), but the analytics capability around them is thin — no filters, no drilldown API, no export, no configurable date range, no report-level snapshotting. Notably less developed than CRM's equivalent reporting work.
- **F062 Order-to-cash reporting (capstone finding, connects to F053): `sales_orders.payment_status` is a real, modeled column that is never written to by any code path anywhere.** The delivery-to-invoice half of order-to-cash is well-built; the cash half (has the customer actually paid) is completely disconnected from Accounting's real payment state. Same root theme as F053/F052 — Sales' connective tissue to Accounting's actual financial reality is thin across the board. Likely one fix closes all three.

## Procurement (module 3/12): full atomic trace + gap-closing pass + real browser E2E complete (2026-09-14)

All 34 features (F063-F096) traced against `SUBREQUIREMENT_REGISTER.csv`
with cited code evidence — see `docs/03-modules/procurement/audits/F0##-AUDIT.md`
for each. Unlike CRM/Sales, Procurement uses one generic resource-driven
engine (`services/api/src/modules/procurement/index.js`,
`governance.js`, `pass1-operations.js`) rather than per-feature files —
most features share the same create/update/list/transition/audit/
idempotency plumbing, which is genuinely solid (RLS-enforced isolation,
optimistic concurrency with `FOR UPDATE` locking on money-moving paths,
real audit-event + outbox writes on every mutation, sensitive-field
redaction on suppliers, correct self-approval prevention).

**Two release-blocking, module-wide gaps found, not yet fixed:**
1. **`tenant.procurement_outbox` is written on every mutation and read by
   nothing, anywhere** (`grep -rl "procurement_outbox" services/` finds
   only the one file that writes it). Every downstream effect the module
   claims to trigger via outbox — notifications, the Accounting vendor-bill
   handoff on a clean invoice match (F084/F085/F086) — never happens.
2. **Goods receipt never calls Stock's `postStockMovement`** (F080/F081) —
   `applyReceiptToOrder` only updates Procurement's own bookkeeping,
   despite `docs/04-cross-module/PROCUREMENT_TO_STOCK_RECEIVING.md`
   explicitly documenting that posting a receipt should call a Stock
   public contract. This is the exact same class of gap Sales found and
   fixed for its own Stock fulfilment contract before certification;
   Procurement has not been fixed yet.

**Other real gaps found, recorded, not fixed this pass** (see each
feature's audit for full detail): no duplicate-supplier detection (F063);
an `archived` supplier status referenced defensively in queries with no
transition to reach it (F063); no supplier portal exists at all despite
every dossier assuming one (F063); qualification/certification/scorecard
child data is correctly stored and hydrated but has **zero UI** anywhere
to view or manage it (F063/F064/F065/F090) — the governance dashboard can
report a supplier isn't qualified with no way in the product to fix it;
no amount/category/budget-based approval routing anywhere, only flat
single-permission gates (F068/F075); a real, correct, decimal-safe
weighted-scoring function (`evaluateSupplierScore`) that is never called —
bid comparison and supplier scorecards are pure manual number entry
instead (F072/F089/F090); the sourcing-award UI is three `window.prompt()`
dialogs requiring a manually-typed bid UUID, with no comparison view or
justification/approval gate (F073); blanket purchase orders are entirely
unimplemented, no committed-value ceiling or consumption tracking exists
(F077); price lists and lead times are real, validated, and completely
disconnected from PO line pricing and reorder date calculation
respectively (F079/F091); payment terms do not exist anywhere in the
module (F088); the Settings page is a static mock with hardcoded
"Governed" labels and no real category/catalog/policy management UI
behind it (F066); `procurement_reporting_facts` is queried by every
report call but never populated by anything (F092). The best-engineered
code in the module: PO amendment-with-rollback (F076), the sourcing-award
mechanism's locking/idempotency/eligibility-check (F073), the two/three-way
matching calculation itself (F085/F086), and the reorder-generation
orchestration (F094, correctly placed in `services/api/src/orchestration`
with real cross-module idempotency).

**Standing, not feature-specific:** zero Procurement browser E2E exists
(no `erp-procurement-*.spec.ts` files) — this is the same infrastructure
gap CRM had until this session; no human UAT.

**Gap-closing pass, 2026-09-14: both release-blocking gaps fixed.**
Goods receipt now posts a real Stock movement
(`services/api/src/orchestration/procurement-stock-receiving.js`,
modeled on Sales' own pre-existing Stock-fulfilment pattern) on approve,
and a compensating movement on reverse — verified against a real local
Postgres database, not a fake client (see below). A clean invoice match
now automatically imports as a real Accounting vendor bill
(`services/api/src/orchestration/procurement-accounting-vendor-bill.js`)
by calling Accounting's own pre-existing `importProcurementMatchAsVendorBill`
directly instead of routing through the dead outbox — that function
turned out to already be correct and idempotent, just never triggered;
the only genuinely new piece needed was linking a supplier to its
Accounting business partner at all (`accountingPartyId`, previously
absent). Added
`tests/integration/procurement-source-to-receipt-journey.test.mjs`, this
repo's first real-PostgreSQL (non-fake-client) integration test: it runs
Supplier→Requisition→RFQ→Award→PO→Dispatch→Receipt-approve (asserting a
real `stock_balances` row appears)→Match→Receipt-reverse (asserting the
balance nets back to zero) against a genuinely migrated local database,
plus the new cross-module organization-mismatch guard and the
not-yet-linked-to-Accounting skip path. All assertions pass.
`test:api` (883/883) and `typecheck:web` remain clean throughout.

**Browser E2E, 2026-09-14 (same session, later): done.** Built the fixture
infrastructure Procurement was missing (`apps/web/scripts/
e2e-fixture-procurement.mts`) and a real Playwright spec
(`apps/web/tests/e2e/erp-procurement-source-to-pay-journey.spec.ts`)
driving the full Supplier → Requisition → RFQ → Purchase Order → Goods
Receipt → Supplier Bill → Payment journey through two independently
authenticated real browser sessions (buyer + approver, required by the
real self-approval guard) against the real Next.js routes and a real
Postgres database — including the full posted vendor bill/payment this
module's earlier integration test had explicitly deferred, and the real
segregation-of-duties approval-request workflow this fixture organization
defaults both on for. A companion test confirms a CRM-only restricted
user is denied read/write on Procurement resources.

Getting this green found and fixed **three further real production
defects**, all in shared Accounting helpers rather than Procurement
itself, and all invisible to this repo's fake-DB-client test convention
because this was the first time any real HTTP/Postgres path exercised
them: `parseProcurementUpdate` calling Zod 4's `.partial()` on a schema
with an inherited refinement (every PATCH to any Procurement resource
returned 500); `isoDate()` assuming its input was always a string when
node-postgres returns DATE columns as real `Date` objects (posting a real
vendor bill failed with a misleading "Accounting date is invalid.");
and `hashPayload()`'s stable-stringify falling through to a raw
`JSON.stringify()` for BigInt values that `normalizeLines()` always
produces for a journal entry's own contentHash — meaning posting *any*
real document that creates a journal entry (vendor bill, customer
invoice, manual journal, vendor payment) was completely broken. Full
root-cause detail and the fixes in `docs/ERP_COMPLETION_EXECUTION_TRACKER.md`.

**Still not done, so Procurement is not yet declared production-ready:**
multi-company/branch isolation wasn't specifically re-exercised at the
browser level (only at trace/unit level); failure-recovery paths beyond
the one receipt-reversal case (covered in the integration test) weren't
driven through the browser; and the large number of genuinely-new-scope
gaps recorded during the trace remain open (duplicate-supplier detection,
no supplier portal, no Item/Warehouse/UOM master-data UI or API anywhere
in the repo — confirmed again by this E2E's own fixture having to seed
them via raw SQL, approval-threshold routing, the unused
`evaluateSupplierScore` function, blanket POs, payment terms, etc. — see
each feature's own audit). None of these block the fixes above from being
real and verified.

See `docs/ERP_COMPLETION_EXECUTION_TRACKER.md` for the full detail.

## Module order

Following the build order already established in the existing codebase (`apps/web/src/modules/*`, `services/api/src/modules/*`):

1. CRM (30 features) — **production-ready, gap-closing pass complete**
2. Sales (32) — **trace and gap-closing pass complete**
3. Procurement (34)
4. Stock / Inventory (48)
5. Manufacturing (48)
6. Projects (38)
7. Assets (37)
8. Point of Sale (40)
9. Quality (35)
10. Support / Customer Service (38)
11. HR & Payroll (72)
12. Accounting / Finance (58)

A prior effort ("Pass 1") already put substantial real implementation into F015-F114, spanning CRM/Sales/Procurement/Stock — see `apps/web/tests/pass1-f015-f114.test.mjs`. That code is a starting point to audit and complete, not something to rewrite from scratch.

## Real maturity per module (corrected 2026-09-05 — includes route/API layer, not just `src/modules/*`)

| Module | web pages | api routes | dedicated tests | Verdict |
|---|---|---|---|---|
| CRM | 22 | 103 | 49 files / 454 tests | **Certified production-ready** |
| Accounting | 22 | 60 | 1 | Substantial backend, untested — audit next after Sales |
| Procurement | 25 | 10 | 0 | Real UI, thin backend test coverage |
| Sales | 11 | 14 | 20+ files added this session (+ shared Pass-1 aggregate) | Strong backend (2,775-line domain layer, granular per-action permissions, audit, governance snapshots) — **trace and gap-closing pass complete** |
| Stock | 5 | 10 | 3 | Thin |
| Manufacturing / Projects / Assets / POS / Quality / Support / HR-Payroll | 3 each | 3-6 each | 0-1 | Scaffolding only — effectively unbuilt |

Initial file counts under `src/modules/*` alone understated everything except CRM — the route/API layer lives separately under `src/app/(app)/<module>` and `src/app/api/<module>`.

## Status log

- 2026-09-05: Retired the process/governance doc layer (00-program, 05..11, docs/scripts) per owner direction; kept the 5 requirement registers, 510 dossiers, shared-platform requirements, cross-module contracts, and engineering standards. Fixed the two npm scripts and two test/validation files that depended on deleted docs.
- 2026-09-05: Certified CRM (30/30 features) — see git history for evidence. Owner confirmed depth-first, module-order strategy for the remaining 11 modules.
- 2026-09-05: Sales reconnaissance complete. Backend (`services/api/src/modules/sales/{index,order-governance,quotation-governance,pass1-operations}.js`, ~5,150 lines total, 33 `tenant.sales_*` tables) enforces granular per-action permissions (`sales.quotation.create/approve/send`, `sales.order.create/approve/confirm/hold/cancel/amend`, `sales.credit.override`, `sales.margin.view`), audit logging and governance snapshots on every mutation, and same-origin + billing-gated API routes. This codebase's test convention is hand-built fake-DB-client unit tests (see `services/api/tests/crm-record-scope.test.mjs`) — Sales has zero of these yet. Given `loadDocumentContext` alone issues ~10 sequential queries (company/branch/party/owner/contact/addresses/currency/exchange-rate/price-list/payment-term/settings), building accurate mocks requires reading each function closely rather than guessing; in progress, starting with the quotation lifecycle (F036-F038) before orders (F042-F044).
- 2026-09-05: While auditing Sales' approval workflow (F041) against dossier requirement SEC-001, found and fixed a real cross-module authorization bug: `apps/web/src/app/api/approvals/[id]/route.ts` and its mobile equivalent only checked `command.permission` inside the `approved` branch, so rejecting an approval (Sales quotation/order, or Accounting budget/invoice/bill/payment/journal) only required the generic `approvals.manage` permission, not the entity-specific one. The mobile route also never called `command.reject`, so a mobile rejection never reverted the underlying business record. Fixed both, added `apps/web/tests/approvals-reject-permission.test.mjs`. This affects every module with an approval workflow, not just Sales.
- 2026-09-05: Full `test:web` (541) and `test:api` (324) suites pass with zero regressions from the doc cleanup. Note: real cross-module integration coverage exists under generic file names (e.g. Wave-0/POS/Quality/Manufacturing interaction tests in `services/api/tests/`) that a module-name grep does not surface — the per-module test-count column in the maturity table above undercounts actual coverage for modules with cross-cutting logic.
- 2026-09-06: CRM gap-closing pass complete — 17 fixes across F003/F004/F005/F006/F008/F009/F010/F015/F019/F026/F028/F029 plus the module-wide automation-trigger wiring, each with a migration where needed (78→84 tenant migrations), real regression tests, and clean `tsc`/`eslint`/`verify:db`/`verify:architecture` after every one. Two corrections found and documented along the way: F008's "merge is unreachable" claim was wrong twice (a bash `**` glob bug), and F028's `custom-field-definitions`/`custom-records` admin UI was real but completely unreachable by any route (fixed as part of F006's work, using the exact wiring pattern discovered while making `qualification-criteria` reachable). Owner confirmed CRM is done for now — remaining items (F007/F008/F009/F014+F016/F021/F025 sub-gaps, AI-001 module-wide) are multi-day feature additions, not gap fixes, and are deliberately deferred rather than done. Moving to Sales next.
- 2026-09-06: Sales trace started with F031 Customer master. Found and immediately fixed two live, cross-cutting security bugs (a cross-company data leak in `getSalesOptions`/`getSalesReport`, and a `sales.margin.view` permission-gate bypass exposing item cost through the same options endpoint) — see the Sales section above and `docs/03-modules/sales/audits/F031-AUDIT.md`. No migration was needed (query-scoping and redaction fixes only); `test:api` (411, up from 409), `typecheck:web` and `verify:db`/`verify:architecture` all clean.
- 2026-09-06: Sales full atomic-requirement trace complete — all 32 features (F031-F062) traced with cited code evidence, see `docs/03-modules/sales/audits/F0##-AUDIT.md` for each. Owner confirmed continuing at full depth after a mid-trace check-in at F034. Consolidated gap list is in the Sales section above; headline findings beyond the two already-fixed security bugs: the entire Sales-to-Stock fulfilment contract described in `docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md` was never built (F045-F049 are one gap, not five), stock "reservation" and financial "advance payments" are both local bookkeeping with no real downstream effect (F046/F052), several well-validated request tables have no consumer at all (F054/F055/F056), and Sales' own well-built order/fulfilment/billing reconciliation (F059) has no connection to Accounting's actual payment reality (F053/F062 — `sales_orders.payment_status` is never written by any code path). The quotation/order commercial core itself (F031-F044, F050-F051, F057-F059, F061) is genuinely excellent engineering with only minor, well-scoped gaps. Owner confirmed proceeding straight to the gap-closing pass.
- 2026-09-06: Sales gap-closing pass complete — 9 fixes (pagination, F034 invalidate action + a `companySql` convention fix, F035 reason capture, F038 quotation-expiry enforcement (real-time + scheduled, third worker tick), F039 header discount, F040 dead tax-group schema dropped, F042 CRM-opportunity-boundary fix with reopen-on-cancel, F057 automatic commission-accrual trigger), migrations 085-086 (85→86 tenant migrations), real regression tests throughout, and clean `tsc`/`eslint`/`verify:db`/`verify:architecture`/`verify:platform-foundation`/`verify:worker` after every one. One genuine research error found and corrected along the way: F045/F046 were originally reported as complete gaps because the initial grep only covered `services/api/src/modules/sales/` and missed `services/api/src/orchestration/`, where real Sales-to-Stock integration code (`sales-stock-reservation.js`) actually lives — both audits corrected in place. That same investigation surfaced one genuinely new live bug (a second, unguarded route exposing fake stock reservation with no Stock call at all), fixed immediately. Also flagged and resolved with the owner: two commits appeared in history mid-session from a concurrent session/tool, confirmed expected, left as-is per owner direction. Remaining items (Sales-to-Stock/Accounting integration, the request-without-consumer cluster, F041's approval-infrastructure gaps, F033/F060 smaller gaps) are deliberately deferred as multi-day feature builds, same treatment as CRM's leftover items. Owner has not yet confirmed the next module (Procurement, per the original order) — check in before starting.
- 2026-09-06: Owner directive changed scope: fully implement everything remaining in CRM+Sales end to end, plus standardize UI/UX and navigation across the app (not just close documented gaps). Planned via a 10-phase plan (`encapsulated-hopping-beacon.md`) after research confirmed an internal design system ("Experience Kernel", `apps/web/src/shared/design/`) already exists but has near-zero CRM/Sales adoption, and real Playwright+axe E2E infrastructure already exists but covers no CRM/Sales routes. Owner chose, via 4 decisions: UI/UX foundation first; build real scoped-down backorders/shipment-tracking now (not deferred); commission payout posts as a real Accounting entry; AI-001 stays out of scope. Plan approved.
- 2026-09-06: Phase 1 (Experience Kernel adoption) complete. Migrated all 9 CRM/Sales files carrying tracked raw-`<table>` debt (resource-manager, contacts/accounts/lead-sources-workspace, leads-workspace, crm/forecast+reports, sales/reports, pass1-operations-workspace) onto `EnterpriseDataGrid`, plus the quotations/orders list pages (`MetricCard`/`FilterBar`) and the document editor (`Surface`). Raw-table debt baseline fell from 39 occurrences/30 files to 29/20 (all remaining entries are outside CRM/Sales). Added 12 new routes to the Playwright `erp-experience.spec.ts` E2E suite for overflow/axe/visual-regression coverage. One kernel gap found and fixed along the way: `EnterpriseDataGrid` had no way to express fixed per-column pixel widths, which `leads-workspace.tsx`'s three-times-tuned readability/pagination/responsive CSS depended on — added an additive, backward-compatible `width`/`fixedLayout` option rather than force a regression on the highest-traffic CRM screen. Also fixed 16 missing breadcrumb-label overrides for the CRM setup hub's resource pages. Deliberately scoped down: the document editor's ~35 form fields keep their existing (already-accessible) plain `<label>` markup rather than a full `FormField` rewrite — too much regression risk on a live financial-document form with no way to visually verify in this pass — and `leads-workspace.tsx`'s bulk-selection bar stays bespoke since `BulkActionBar`'s API doesn't fit its dual "N selected"/"all N matching" mode. CSS token convergence (hex-literal replacement) remains deferred per the plan's own sequencing. `typecheck:web`/`lint:web`/`test:web` (571) clean after every commit.
- 2026-09-06: Phase 2 (Sales-to-Stock integration) complete — F046 and F047 are no longer gaps. F046: added `listActiveStockReservationsByReference` to Stock's public API and a new `releaseSalesOrderStockReservationsOnCancel` orchestration function, wired into `cancelSalesOrderWithCrmSync` as a best-effort step, so cancelling an order now actually releases any stock it had reserved. F047: added `completeFulfillmentRequestWithStockMovement`, which posts a real `postStockMovement` issue per stock-tracked line on fulfilment completion — deliberately *not* best-effort, since insufficient physical stock must block completion rather than silently succeed. While writing F047's regression test, found and fixed a genuinely severe, fully pre-existing bug unrelated to this session's prior work: `completeFulfillmentRequest` referenced an undefined `positiveAmount` helper, meaning the function threw a `ReferenceError` on every single call — it had never been exercised by any test in the repo's history. `test:api` (460, up from 456), `test:web` (571), `typecheck:web`, `lint:web`, `verify:architecture`, `verify:platform-foundation` all clean.
- 2026-09-10/11 (found stale, reconciled 2026-09-14 — see below): a further, undocumented CRM pass landed directly on `main` without a matching status-log entry here — "CRM vNext F001-F030 hardening and closure passes" plus a full reorganization of `apps/web/src/modules/crm` and `services/api/src/modules/crm` from flat `components/`/`server/` layout into 7 feature-named domains (`prospect-and-relationship-master-data`, `lead-lifecycle-qualification-and-prioritization`, `opportunity-and-pipeline-governance`, `seller-activity-and-follow-up-workspace`, `crm-conversion-and-sales-handoff`, `crm-data-operations-and-customization`, `pipeline-analytics-and-forecasting`, plus `sales-organization-and-coverage`), a shared CRM UI/UX token system, and a working E2E fixture-bootstrap script (`apps/web/scripts/e2e-fixture-bootstrap.mts`) that actually provisions a real organization/users/records against a live Postgres for Playwright. This directory layout matches the Project Structure Constitution's "organized by business capability" rule and `verify:architecture` confirms 0 legacy files remain. Not a regression — just undocumented.
- 2026-09-14: Session start reconciliation against a fresh checkout (this working copy had no `.git`; verified byte-identical to `origin/main` at `79a7fc5` via tree-hash match before restoring git metadata non-destructively). Findings:
  - **CI bug (fixed):** `crm-ci.yml` ran `actions/setup-node@v4` with `cache: pnpm` *before* `corepack enable`, so pnpm wasn't resolvable on PATH yet when the cache step tried to key on it — every CRM-path PR run would have failed before tests ran. Reordered to match the already-correct `landing-ci.yml` pattern. Added a new comprehensive `.github/workflows/erp-ci.yml` covering toolchain/T01/experience/architecture/doc-links/DB-structure verification, web typecheck/lint/tests/routes, mobile typecheck/lint, API/worker/package/SDK/integration/security/enterprise-RBAC tests, the production web build, and a dependency audit — browser E2E and load/perf stay out of this per-PR gate by design.
  - **Root script ambiguity (fixed):** root `pnpm build` only ever built `apps/landing` (the Hostinger deployment target for `server.js`) — nothing enforced that this isn't mistaken for a full ERP build. Added explicit `build:erp` (alias of `build:web`), `build:all` (landing+web), `verify:erp` (alias of the existing comprehensive `verify` script) and `verify:release` (alias of `release:gate`); documented the distinction in `README.md`. `build`/`build:landing`/`verify`/`release:gate` themselves are unchanged — no deployment compatibility risk.
  - **Dev port-cleanup safety bug (fixed):** `scripts/dev/free-ports.mjs` killed *any* process bound to ports 3000/3001/3200/3201 with zero ownership check — a real risk on a shared machine (this environment, for instance, has unrelated Docker/Node services on adjacent ports). Rewrote it to read the held process's command line (via `Get-CimInstance Win32_Process`/`ps -o command=`) and only kill it if the command line references both this repo's own working-tree path and a Next.js/pnpm/turbo dev-process pattern; otherwise it now prints a clear refusal and leaves the process running.
  - **Landing horizontal-overflow bug: re-verified, does NOT currently reproduce.** The brief called out `/book-demo`, `/resources/erp-requirements-checklist` and `/compare/vercentlabs-vs-odoo` at 320-390px. `apps/landing/tests/e2e/mobile-conversion.spec.ts` already has a real, DOM-measured (`scrollWidth` vs `clientWidth`, not a screenshot) test for exactly these three routes plus `/` at 320/360/375/390/412px. Built landing production (`pnpm build:landing`) and ran that spec against both `desktop-chromium` and `mobile-chromium` (the only two Playwright projects that run it — Firefox/WebKit are restricted to `cross-browser-smoke.spec.ts` in this config): **all 40 assertions (20 per project) pass.** Conclusion: either already fixed in an earlier commit not separately logged, or the brief's reproduction conditions differ from this config's (real network idle wait, Chromium engine). Not fabricating a fix for a non-reproducing bug — flagging as `NOT REPRODUCIBLE (re-verify on next real regression report)` rather than `FIXED`.
  - **Real regression found and fixed (worker test):** `services/worker/tests/crm-nurture-queue-dispatch.test.mjs`'s `CRM-VNEXT-052` test read source from the pre-reorg path `services/api/src/modules/crm/lead-intelligence.js`, which the 09-10/09-11 reorg moved to `.../lead-lifecycle-qualification-and-prioritization/lead-intelligence.js` — this left `pnpm test:worker`/`verify:worker` failing with `ENOENT` on a clean environment (Node 24, fresh `pnpm install`, fresh Postgres). Fixed the path; also fixed one stale comment in `services/worker/src/handlers/crm-lead-sla-scan.js` pointing at the same old path. `test:worker` now 99/99 pass.
  - **Lint hygiene (fixed, 0 errors but 9 warnings from the same reorg):** removed 6 unused `./core` helper imports (`branch`/`owner`/`config`) left over in 5 `crm-data-operations-and-customization/resource-definitions/*.ts` files after the reorg, an unused `useEffect` import in `lead-detail-workspace.tsx`, and a genuinely dead `leadWorkspace` local in `apps/web/tests/crm-lead-sources-f004.test.mjs`. `pnpm lint:web` now 0 problems.
  - **Stale tracker claim corrected:** this file's CRM section says "no live E2E was run (blocked earlier on missing auth/seed fixtures — still unresolved)" — that's no longer true. `apps/web/scripts/e2e-fixture-bootstrap.mts` (added in the undocumented 09-10/11 pass) successfully provisions a real organization + owner/restricted users + lead/opportunity fixtures against a live Postgres, confirmed by running it directly this session (`E2E fixture ready: organization crm-e2e-fixture ...`). What's still actually missing is a built `apps/web` standalone bundle for Playwright's `webServer` to launch (`pnpm build:web` first) — a build-ordering gap, not a fixture-infrastructure gap. Re-running `test:e2e:crm` end-to-end (build + bootstrap + Playwright) is in progress as of this entry; result to be logged separately once complete.
  - Toolchain note: this environment's system Node is v26.5.0, but the repo pins `>=24 <25` (`.nvmrc`/`.node-version`/`engines`) and `verify:toolchain` fails closed on major-version mismatch (by design — not a bug). Installed Node 24.21.0 via `fnm` for this session; CI already pins Node 24 via `actions/setup-node`, so this is a local-environment-only note.
  - **Full `pnpm verify:erp` passes end-to-end (exit 0) after the fixes above** — Node 24.21.0 (via `fnm`, system Node was v26), fresh `pnpm install --frozen-lockfile`, real local Postgres 16 (`pnpm infra:up`, migrated 001-111 via `pnpm db:setup`). Breakdown: `verify:toolchain` PASS, `verify:t01` 44/44, `verify:experience` 8/8, `verify:architecture`+`verify:doc-links` PASS (828 markdown files), `typecheck:web` PASS, `lint:web` 0 errors/0 warnings, `test:web` 719/719, `test:api` 883/883, `verify:routes` PASS (137 pages, 399 API routes checked), `typecheck:mobile`/`lint:mobile` PASS, `verify:worker` (99 tests + structure checks) PASS, `test:sdk` 14/14, `test:packages` 138/138, `test:integration` 1/1, `test:security` 4/4, `test:enterprise-rbac` 11/11. **Total: 1,921 automated tests, 0 failures, 0 skipped.** `pnpm build:web` (separately) also succeeds — 187 pages generated. Full logs: session scratch (not committed) — re-run any of the above commands to reproduce.
  - All of the above are real behavioral/unit/API/security-negative/RBAC tests per the file-by-file check earlier in this doc (fake-DB-client convention for `services/api/tests/*`, migration-file static checks for `verify:db`, real Postgres RLS/migration assertions for `tests/security/*`) — none of this is source-text-only pattern matching, though some individual test files still are (flagged per-feature in the existing F0##-AUDIT.md files, unchanged by this session).
  - **Landing full suite:** `pnpm build:landing` succeeds (77 static pages). Ran `apps/landing/tests/e2e/mobile-conversion.spec.ts`'s full overflow matrix on `desktop-chromium` + `mobile-chromium` — 40/40 pass (see the overflow finding above). Did not run the complete `landing-release-verification.yml` cross-browser/Lighthouse matrix this session (Firefox/WebKit + Lighthouse are a separate, longer job by design; nothing found in the Chromium run suggests they're needed to unblock this session's scope).
  - **CRM E2E (`pnpm test:e2e:crm`):** fixture bootstrap + `apps/web` standalone build + real Playwright run against a live Postgres — result logged in a separate entry once the run this session completes (was still in progress when this entry was written).
  - **Not run this session (documented, not silently skipped):** `pnpm test:e2e:erp` (full ERP Playwright suite beyond the 6 CRM specs — larger, would need the same fixture+build pipeline extended to Sales/other modules' E2E specs, out of scope for this session's foundation-repair pass), Lighthouse/performance budgets, disaster-recovery/backup-restore rehearsal, any real external-provider integration (email, payments, GCP) — all require either credentials this environment doesn't have or a scope decision beyond "repair the foundation."
  - **Repository governance (cannot be verified or changed from code):** branch protection on `main`, required PR reviews, required status checks, force-push/branch-deletion protection, secret scanning and Dependabot alerts are GitHub repository *settings*, not code — this session has no GitHub API/web access to check or change them. **Action required from a human with repo admin access:** confirm in GitHub → Settings → Branches/Security that these are enabled for `vercentlabs/Vercentlabs-erp`. Do not treat this tracker's other "PASS" evidence as implying these are configured.
