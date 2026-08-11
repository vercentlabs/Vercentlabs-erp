# Vercentlabs ERP — Execution Plan, Prompts 12–102

> **Prompts 12–14 of this plan were executed as originally planned (or close to it) and are historical fact — see the real Prompts 12/13/14 delivery docs.** Prompt 14 diverged from this plan's own "Prompt 14/15" entries (CRM automation trigger completion / telephony worker) because Prompt 13's own work surfaced a higher-priority, previously-unknown CRM authorization bug that took priority. **Everything from Prompt 15 onward in this plan is superseded by `ERP_EXECUTION_PLAN_016_102.md`**, rebuilt against the exact 1,039-feature register recovered in Prompt 15. Do not schedule work against this document's Prompt 15+ entries.

Master roadmap produced by Prompt 11's reconciliation (`ERP_FEATURE_RECONCILIATION_011.md`). Allocates all 91 remaining prompts based on real gaps found via direct code inspection — not on the original, now-superseded estimated allocation. Every prompt number 12–102 appears exactly once (validated by `scripts/validation/verify-feature-matrix.mjs`). No product implementation occurred in Prompt 11; this is a plan only.

Each entry references `feature_id`s from `ERP_FEATURE_MATRIX_011.csv` / `ERP_ACCOUNTING_MATRIX_011.csv` where useful — those are the evidence-backed functional areas the prompt is expected to close or improve.

## Summary table

| Prompt range | Area | Primary goal | Dependencies |
|---|---|---|---|
| 12 | Emergency P0 fixes | Fix confirmed-live onboarding-breaking bug + Stock balance desync | None — do first |
| 13–16 | Shared blocker: scheduler/worker | Deploy a real worker process; drain outbox/webhook/telephony queues; complete CRM automation triggers | 12 |
| 17–19 | Shared blocker: write-UI framework | Reusable create/edit/action form pattern so the 8 "roadmap" modules stop being read-only | None |
| 20 | Shared blocker: reporting foundation | Chart library + generic cross-module report scaffold + report builder groundwork | None |
| 21 | Shared blocker: integration foundation | Tenant API keys + OAuth token exchange completion | None |
| 22 | Shared blocker: data management foundation | Generalize the CRM-only import/export/bulk-update/duplicate pattern | 17–19 |
| 23–24 | CRM completion | Automation trigger completion, minor polish | 13–16 |
| 25–28 | Sales completion | Real Stock reservation/fulfillment wiring, returns consumer, hold-release UI fix | 17–19, 33–38 (partial) |
| 29–32 | Procurement completion | Bid/evaluation/award UI, budget checks, receiving→Stock write-through | 17–19, 33–38 (partial) |
| 33–38 | Stock completion | Write UI, lots/serials/expiry, reservations engine, WMS, planning, valuation | 17–19, 12 |
| 39–46 | Manufacturing completion | Write UI, routing/work-center management, MRP, costing, scrap, subcontracting | 17–19, 33–38 |
| 47–51 | Projects completion | Write UI, milestones, expenses, budgets, billing-milestone→Accounting | 17–19 |
| 52–56 | Assets completion | Write UI, transfers, inspections/calibration, depreciation engine, Stock parts integration | 17–19, 33–38 |
| 57–61 | POS completion | Checkout UI (currently zero), catalog, promotions/loyalty, receipts/hardware, return stock reversal | 17–19, 33–38 |
| 62–65 | Quality completion | UI for inspections/NCR, wire CAPA+audits (functions exist), supplier quality, real hold-gating | 17–19, 33–38, 29–32, 39–46 |
| 66–69 | Support completion | UI for tickets, real escalation engine, channel integrations, portal/KB/CSAT | 17–19, 13–16 |
| 70–76 | HR & Payroll completion | P0 payroll-correctness fix FIRST, then attendance/org-structure UI, recruitment/onboarding, talent, separation, GL posting | 17–19 |
| 77–79 | Accounting targeted fixes | Depreciation/tax-pairing bug fixes, TDS/TCS, e-invoice/e-way bill provider, POS/HR/Assets GL wiring | 13–16, 57–61, 70–76, 52–56 |
| 80–82 | Security/MFA/branding/delegation | Real MFA enrollment, org branding, approval delegation | None |
| 83 | SSO + SMS/WhatsApp | External-provider integrations | 21 |
| 84 | UX polish | Dark mode, accessibility audit, mobile-web audit | None |
| 85 | Data management breadth | Extend Prompt 22's pattern to the remaining 8 modules | 22, module campaigns |
| 86 | Data governance breadth | Retention breadth + backup/DR posture verification | 22 |
| 87 | Cross-module E2E | The 10 critical journeys from the reconciliation report | All module campaigns |
| 88 | Landing e2e stabilization | Fix long-flagged Playwright instability (Prompts 4–10) | None |
| 89 | Performance hardening | Large lists, reports, audit logs, search, ledgers, MRP | Module campaigns |
| 90 | Security review #2 | Adversarial review of all new surface area from 12–89 | 12–89 |
| 91 | Migration/schema consolidation | Dead-schema cleanup review, duplicate migration-prefix fix | All |
| 92 | Observability | Logging/metrics/tracing audit and foundation | None |
| 93 | DR/backup runbook | Verify and document real backup/restore posture | None |
| 94 | Final accessibility audit | WCAG AA verification across all modules | 84 |
| 95 | Final responsive/mobile-web audit | Verification across all modules | 84 |
| 96 | Notification scheduling | Digest/scheduled notifications | 13–16 |
| 97 | KPI framework + cross-module BI | Deeper build on Prompt 20's foundation | 20 |
| 98 | Reports & Analytics completion | Real reports for the remaining 8 modules | 20, module campaigns |
| 99 | Automation completion | Cross-module automation using scheduler foundation | 13–16 |
| 100 | Integration completion | Marketplace/e-commerce/live bank feed | 21, 83 |
| 101 | Full regression + UAT re-verification | Re-run `ERP_TEAM_UAT_SCOPE_011.md` against final state | All |
| 102 | Final reconciliation + launch sign-off | Re-run this entire Prompt 11 methodology against the finished state | All |

---

## Shared blockers (12–22)

### Prompt 12
**Title**: Emergency P0 fixes — permission catalogue gap and Stock balance desync
**Primary scope**: Two confirmed, live, currently-active defects found during Prompt 11 reconciliation, not new feature work.
**Feature groups targeted**: CRM-017 (`crm.records.view_all` missing from `permissions` table — breaks org onboarding via FK violation, confirmed live: 0 rows in `permissions`, 0 rows in `role_permissions`), STOCK-025/STOCK-026 (Manufacturing and POS each fork a local `postStockMovement` that never updates `stock_balances`).
**Dependencies**: None — must run before any other prompt in this plan, including 13.
**Expected implementation outcome**: A migration inserting `crm.records.view_all` into `permissions` and backfilling `role_permissions` for existing organizations (following the established migration 018/027/030/031 pattern); Manufacturing and POS's local stock-posting functions replaced with calls to Stock's canonical `postStockMovement`, or backfilled with a `stock_balances` write. New-org onboarding verified end-to-end afterward.
**Main verification requirement**: A live test that creates a new organization and confirms `role_permissions` seeding succeeds without an FK violation; a live test that a Manufacturing production posting and a POS sale both correctly decrement `stock_balances`.

### Prompt 13
**Title**: Worker/scheduler process — architecture and deployment
**Primary scope**: Shared platform. Design and stand up the actual worker process the existing infrastructure manifests (`Dockerfile.worker`, `workers.yaml` CronJob) already reference but which does not exist on disk (SHARED-014).
**Feature groups targeted**: SHARED-014, SHARED-032, SHARED-045, SHARED-052, SHARED-053.
**Dependencies**: Prompt 12.
**Expected implementation outcome**: A real, deployable worker entrypoint with a job-claim pattern usable by all queue-draining prompts that follow (14–16).
**Main verification requirement**: Worker starts, claims a seeded test job, and marks it complete, verified in `pnpm verify:db`/`pnpm verify:web`.

### Prompt 14
**Title**: Outbox and webhook delivery
**Primary scope**: Drain `tenant.crm_outbox_events` and deliver queued CRM webhook subscriptions for real (SHARED-045, SHARED-053).
**Feature groups targeted**: SHARED-045, SHARED-053, ACC-036/ACC-037 (adjacent — same worker pattern could later drain the Sales/Procurement→Accounting request queues, though that remains a manual "Import" action by design per Prompt 11's Accounting section).
**Dependencies**: Prompt 13.
**Expected implementation outcome**: Webhook subscriptions created in `/integrations` actually receive real deliveries; queue depth shown on the page trends toward zero instead of growing.
**Main verification requirement**: Integration test asserting a queued event is delivered and marked delivered.

### Prompt 15
**Title**: CRM automation trigger completion + telephony job worker
**Primary scope**: Wire the 4 currently-dead CRM automation event types (SHARED-031/CRM-012) and the telephony/conversation-intelligence job worker (SHARED-052).
**Feature groups targeted**: CRM-012, SHARED-031, SHARED-052.
**Dependencies**: Prompt 13.
**Expected implementation outcome**: All 7 defined CRM automation event types fire for real; conversation-intelligence recording/transcription jobs actually process.
**Main verification requirement**: Automation execution-history test confirming all 7 event types can produce a real run.

### Prompt 16
**Title**: Escalation and notification scheduling foundation
**Primary scope**: Time-based triggers for Support escalation (SUP-007) and a scheduled-notification/digest capability (SHARED-058), using the Prompt 13 worker.
**Feature groups targeted**: SUP-007, SHARED-058.
**Dependencies**: Prompt 13.
**Expected implementation outcome**: A held-open SLA breach can produce a real escalation record automatically; notification digests can be scheduled.
**Main verification requirement**: Time-travel test confirming an overdue ticket produces an escalation row.

### Prompt 17
**Title**: Generic write-UI framework — design and CRM/Sales pilot
**Primary scope**: Every "roadmap" module (Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll, and most of Stock) was found to have real, working backend mutation logic with **zero UI to invoke it** — every list page is read-only. Design one reusable create/edit/action-button pattern rather than 8 bespoke ones.
**Feature groups targeted**: The UI-blocker rows across MFG-002/007, PROJ-001/003, ASSET-001/003/004/013, POS-001/002, QUAL-002, SUP-001, STOCK-010/012/013/014.
**Dependencies**: None.
**Expected implementation outcome**: A shared form/action-button component library proven on 1–2 pilot resources.
**Main verification requirement**: Component-level tests plus one working end-to-end create flow in a pilot module.

### Prompt 18
**Title**: Write-UI framework rollout — Stock and Procurement
**Primary scope**: Apply the Prompt 17 pattern to Stock movement/transfer/adjustment forms and Procurement's sourcing/bid/evaluation/award screens.
**Feature groups targeted**: STOCK-010/012/013/014, PROC-010/012.
**Dependencies**: Prompt 17.
**Expected implementation outcome**: A user can create a stock movement, complete a transfer, and run a sourcing event through the actual product UI.
**Main verification requirement**: UI-level tests for each new form.

### Prompt 19
**Title**: Write-UI framework rollout — remaining 7 modules
**Primary scope**: Apply the Prompt 17 pattern to Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll's core create/edit/action surfaces.
**Feature groups targeted**: All UI-blocked rows in those modules' matrix sections.
**Dependencies**: Prompt 17.
**Expected implementation outcome**: Every module's real backend logic becomes reachable by a normal user, not just by direct API call.
**Main verification requirement**: At least one create/edit/action UI test per module.

### Prompt 20
**Title**: Reporting foundation — chart library and report builder groundwork
**Primary scope**: No chart/visualization library exists anywhere in the dependency tree (SHARED-041); no report builder or scheduling exists (SHARED-038/039).
**Feature groups targeted**: SHARED-038, SHARED-039, SHARED-041.
**Dependencies**: None.
**Expected implementation outcome**: A chosen, installed chart library; a minimal generic report-definition scaffold usable by later module-reporting prompts.
**Main verification requirement**: One real chart rendering on an existing dashboard as proof of integration.

### Prompt 21
**Title**: Integration foundation — API keys and OAuth completion
**Primary scope**: Tenant-issued API keys (SHARED-047) don't exist; OAuth state/PKCE is real but token exchange is missing (SHARED-046).
**Feature groups targeted**: SHARED-046, SHARED-047.
**Dependencies**: None.
**Expected implementation outcome**: A tenant can issue/revoke a scoped API key; an OAuth connection can complete a real token exchange.
**Main verification requirement**: API-key auth integration test; OAuth token-exchange test against a sandbox/mock provider.

### Prompt 22
**Title**: Data management foundation — generalize the CRM pattern
**Primary scope**: Import/export/bulk-update/duplicate-management today exist only for CRM + 6 master-data resources (SHARED-068/069/070/071). Build the generic pattern once.
**Feature groups targeted**: SHARED-068, SHARED-069, SHARED-070, SHARED-071.
**Dependencies**: Prompt 17–19.
**Expected implementation outcome**: A reusable import/export/bulk-update/duplicate framework other modules' completion prompts can plug into.
**Main verification requirement**: One additional module (e.g., Sales) demonstrably gains import/export through the new framework.

---

## Module campaigns (23–76)

### Prompt 23
**Title**: CRM — automation trigger completion and permission-bug regression test
**Primary scope**: Close CRM-012's remaining trigger gap alongside the shared automation work from Prompt 15; add regression coverage for the CRM-017 permission fix from Prompt 12.
**Feature groups targeted**: CRM-012, CRM-017.
**Dependencies**: Prompts 12, 15.
**Expected implementation outcome**: CRM automation UI no longer offers dead trigger types.
**Main verification requirement**: `crm-record-scope.test.mjs`-style regression test for the permission fix; automation trigger test.

### Prompt 24
**Title**: CRM — polish and rate-limit closure
**Primary scope**: Close the still-open public lead-capture rate-limiting gap (CRM-016) first flagged in Prompt 1 and reconfirmed in Prompt 11.
**Feature groups targeted**: CRM-016.
**Dependencies**: None.
**Expected implementation outcome**: Public capture endpoint rate-limited like the other 8 auth-adjacent routes.
**Main verification requirement**: Rate-limit integration test.

### Prompt 25
**Title**: Sales — real Stock reservation wiring
**Primary scope**: `reserveSalesOrderLines` currently only writes Sales-local bookkeeping; wire it to `tenant.stock_reservations`.
**Feature groups targeted**: SALES-009.
**Dependencies**: Prompt 33–38 (Stock's own reservation engine must exist first — sequence accordingly if Stock campaign runs later; otherwise build the Stock-side minimal reservation write here).
**Expected implementation outcome**: A confirmed sales order line genuinely reduces available-to-promise stock.
**Main verification requirement**: Cross-module integration test (Sales confirm → Stock reservation row).

### Prompt 26
**Title**: Sales — fulfillment creates real stock movements
**Primary scope**: `completeFulfillmentRequest` currently never creates a `stock_movements` row (SALES-010).
**Feature groups targeted**: SALES-010.
**Dependencies**: Prompt 25.
**Expected implementation outcome**: Fulfilling a sales order line genuinely deducts inventory.
**Main verification requirement**: Integration test verifying `stock_movements` insert on fulfillment completion.

### Prompt 27
**Title**: Sales — returns consumer (Accounting credit note + Stock receipt)
**Primary scope**: `sales_return_requests` currently has zero consumer anywhere (SALES-014); bridge it to a real Accounting credit note and Stock receipt, and add the missing UI control.
**Feature groups targeted**: SALES-014, SALES-015.
**Dependencies**: Prompt 26.
**Expected implementation outcome**: A sales return produces a real credit note and restocks inventory; reachable from the order detail page.
**Main verification requirement**: End-to-end test: create return → credit note exists → stock increases.

### Prompt 28
**Title**: Sales — hold-release UI fix and backorder/drop-ship/recurring evaluation
**Primary scope**: Fix the permanently-disabled "Release from hold" button (SALES-007, a confirmed dead control with a real backend). Evaluate backorders/make-to-order/drop-ship/recurring orders (SALES-011/012/013) as P2/P3 scope decisions rather than building them all.
**Feature groups targeted**: SALES-007, SALES-011, SALES-012, SALES-013.
**Dependencies**: None.
**Expected implementation outcome**: Hold release works from the UI; a documented scope decision on which of backorder/MTO/drop-ship/recurring (if any) get built this campaign vs. deferred.
**Main verification requirement**: UI test clicking "Release from hold" and confirming the order transitions.

### Prompt 29
**Title**: Procurement — sourcing UI (bids, invitations, evaluations, award)
**Primary scope**: `awardSourcingEvent` is genuinely sophisticated backend logic reachable today only via a raw `window.prompt()` for a bid UUID nobody can see (PROC-010/012).
**Feature groups targeted**: PROC-010, PROC-012.
**Dependencies**: Prompt 18.
**Expected implementation outcome**: A buyer can invite suppliers, record bids/evaluations, and award through real forms.
**Main verification requirement**: UI test for the full sourcing-event-to-award flow.

### Prompt 30
**Title**: Procurement — budget checks and catalogue UI
**Primary scope**: No budget ceiling check exists at all (PROC-007); catalogue/catalog-request UI is missing (PROC-008).
**Feature groups targeted**: PROC-007, PROC-008.
**Dependencies**: None.
**Expected implementation outcome**: Requisitions can be checked against a budget; catalogue browsing/requesting is usable.
**Main verification requirement**: Budget-block integration test.

### Prompt 31
**Title**: Procurement — receiving writes through to Stock
**Primary scope**: `applyReceiptToOrder` never touches `stock_movements`/`stock_balances` today (PROC-019) — a purchase-order receipt has no effect on physical inventory.
**Feature groups targeted**: PROC-019, PROC-020 (quality-inspection linkage's `inspectionAccepted` dead field).
**Dependencies**: Prompt 12 (canonical `postStockMovement` fix).
**Expected implementation outcome**: Receiving a PO genuinely increases on-hand inventory; four-way match's inspection-acceptance check becomes real.
**Main verification requirement**: Integration test: receive PO → stock balance increases; four-way match with a real inspection result.

### Prompt 32
**Title**: Procurement — supplier portal foundation and drop-ship evaluation
**Primary scope**: `procurement_portal_users` table exists with zero UI/auth surface (PROC-005); evaluate drop-ship (PROC-015) as a scope decision.
**Feature groups targeted**: PROC-005, PROC-015.
**Dependencies**: None.
**Expected implementation outcome**: A minimal supplier-facing portal login/view; a documented decision on drop-ship scope.
**Main verification requirement**: Supplier portal auth test.

### Prompt 33
**Title**: Stock — write UI for movements, transfers, adjustments
**Primary scope**: `postStockMovement`, `createStockTransfer`, `completeStockTransfer` are all real and unreachable via any UI (STOCK-010/012/013/014/027).
**Feature groups targeted**: STOCK-010, STOCK-012, STOCK-013, STOCK-014, STOCK-027.
**Dependencies**: Prompt 18.
**Expected implementation outcome**: A warehouse user can record a movement, adjustment, opening balance, or transfer through the product.
**Main verification requirement**: UI tests for each form.

### Prompt 34
**Title**: Stock — lots, serials, expiry
**Primary scope**: `stock_batches`/`stock_serials` tables are permanently empty (STOCK-005/006/007) — no code anywhere writes to them.
**Feature groups targeted**: STOCK-005, STOCK-006, STOCK-007.
**Dependencies**: Prompt 33.
**Expected implementation outcome**: Batch/serial capture on receipt; expiry-based alerts/FEFO logic.
**Main verification requirement**: Batch-tracked item receive-and-issue test.

### Prompt 35
**Title**: Stock — reservations engine
**Primary scope**: `stock_reservations` has no write path in the Stock module itself (STOCK-011); build the real reservation engine Sales (Prompt 25) and POS/Manufacturing can depend on.
**Feature groups targeted**: STOCK-011.
**Dependencies**: Prompt 33.
**Expected implementation outcome**: A genuine reserve/release API and UI.
**Main verification requirement**: Reservation lifecycle test.

### Prompt 36
**Title**: Stock — WMS operations (put-away, picking, packing, dispatch, cross-dock, kitting)
**Primary scope**: None of these are modeled beyond raw movement primitives (STOCK-015).
**Feature groups targeted**: STOCK-015, STOCK-009 (zone/aisle/rack/bin usage beyond a flat FK).
**Dependencies**: Prompt 33.
**Expected implementation outcome**: A genuine warehouse-operations flow from receipt to dispatch.
**Main verification requirement**: End-to-end WMS flow test.

### Prompt 37
**Title**: Stock — planning (reorder, EOQ, ATP/CTP, cycle count, ABC/XYZ)
**Primary scope**: `stock_reorder_rules` has no UI; no EOQ/demand/ATP/CTP/cycle-count/classification logic exists (STOCK-016/017/018/019).
**Feature groups targeted**: STOCK-016, STOCK-017, STOCK-018, STOCK-019.
**Dependencies**: Prompt 33.
**Expected implementation outcome**: Reorder rules manageable via UI; a real ATP calculation; a cycle-count workflow.
**Main verification requirement**: Reorder-trigger and cycle-count-variance tests.

### Prompt 38
**Title**: Stock — valuation completion (FIFO, landed cost, valuation-layer reporting)
**Primary scope**: `costing_method='fifo'` silently falls back to moving-average (STOCK-020, a correctness risk); landed cost doesn't exist (STOCK-021); `stock_valuation_layers` is written but never read (STOCK-022).
**Feature groups targeted**: STOCK-020, STOCK-021, STOCK-022, STOCK-023 (analytics depth).
**Dependencies**: Prompt 33.
**Expected implementation outcome**: FIFO genuinely computes FIFO; landed cost allocable; a valuation report consumes the layers table.
**Main verification requirement**: FIFO-vs-moving-average calculation test with a known expected result.

### Prompt 39
**Title**: Manufacturing — write UI for BOM and work orders
**Primary scope**: `createBillOfMaterial`, `createWorkOrder`, `releaseWorkOrder`, `startWorkOrder` are all real, API-only (MFG-002/007).
**Feature groups targeted**: MFG-002, MFG-007.
**Dependencies**: Prompt 19.
**Expected implementation outcome**: A planner can create/activate a BOM and release/start a work order through the product.
**Main verification requirement**: UI test for BOM creation and WO release.

### Prompt 40
**Title**: Manufacturing — fix the permanently-blocking operation-completion gate
**Primary scope**: No code ever transitions a work-order operation to `completed`, which makes `postProduction`'s completion gate unusable for any WO with a routing (MFG-008) — a real, active bug, not just a gap.
**Feature groups targeted**: MFG-008.
**Dependencies**: Prompt 39.
**Expected implementation outcome**: Shop-floor operation status transitions are real; production posting is unblocked for routed work orders.
**Main verification requirement**: End-to-end test: start operation → complete operation → post production succeeds.

### Prompt 41
**Title**: Manufacturing — routing and work-center management
**Primary scope**: `manufacturing.routing.manage` is a granted permission with zero backing implementation (MFG-004); work-center capacity columns are never read (MFG-005).
**Feature groups targeted**: MFG-004, MFG-005.
**Dependencies**: Prompt 39.
**Expected implementation outcome**: Routings and work centers are genuinely creatable/editable; capacity is computable.
**Main verification requirement**: Routing CRUD test; capacity-vs-load calculation test.

### Prompt 42
**Title**: Manufacturing — MRP foundation and run
**Primary scope**: `manufacturing_planning_runs`/`material_requirements` are pure dead schema (MFG-006) — this needs ground-up domain work, not incremental extension, per the research agent's explicit judgment.
**Feature groups targeted**: MFG-006.
**Dependencies**: Prompt 41.
**Expected implementation outcome**: A real netting engine (gross requirement → on-hand → on-order → net requirement → planned order).
**Main verification requirement**: MRP run test with a known expected planned-order output.

### Prompt 43
**Title**: Manufacturing — costing engine
**Primary scope**: `manufacturing_cost_snapshots` is pure dead schema (MFG-014) — no costing computation exists anywhere.
**Feature groups targeted**: MFG-014, MFG-015 (variance analysis).
**Dependencies**: Prompt 42.
**Expected implementation outcome**: Real material/labor/overhead cost roll-up per work order with variance reporting.
**Main verification requirement**: Costing calculation test against a known BOM/routing.

### Prompt 44
**Title**: Manufacturing — scrap, backflush, multi-level BOM
**Primary scope**: `quantity_scrapped` never written (MFG-010); `backflush_materials` setting never read (MFG-009); no multi-level BOM explosion (MFG-003).
**Feature groups targeted**: MFG-003, MFG-009, MFG-010.
**Dependencies**: Prompt 39.
**Expected implementation outcome**: Scrap posting works; backflush toggle is honored; nested BOMs explode correctly.
**Main verification requirement**: Scrap-posting and BOM-explosion tests.

### Prompt 45
**Title**: Manufacturing — subcontracting
**Primary scope**: `subcontracted` flag exists, is never set or read (MFG-017).
**Feature groups targeted**: MFG-017.
**Dependencies**: Prompt 29–32 (Procurement sourcing UI, for the subcontract-PO leg).
**Expected implementation outcome**: A real subcontract PO/receipt flow.
**Main verification requirement**: Subcontract flow integration test.

### Prompt 46
**Title**: Manufacturing — Quality and Assets/maintenance linkage
**Primary scope**: No FK/reference from Manufacturing to Quality (MFG-012) or to Assets/maintenance (MFG-013).
**Feature groups targeted**: MFG-012, MFG-013.
**Dependencies**: Prompt 62–65 (Quality hold-gating), 52–56 (Assets).
**Expected implementation outcome**: Manufacturing can trigger a quality inspection and reference equipment maintenance state.
**Main verification requirement**: Cross-module integration test.

### Prompt 47
**Title**: Projects — write UI for projects and tasks
**Primary scope**: `createProject`, `createProjectTask` are real, API-only (PROJ-001/003); `approveTimeEntry` is implemented but has zero routes (PROJ-007).
**Feature groups targeted**: PROJ-001, PROJ-003, PROJ-007.
**Dependencies**: Prompt 19.
**Expected implementation outcome**: A PM can create a project/task and approve time entries through the product.
**Main verification requirement**: UI tests for project/task creation and time-entry approval.

### Prompt 48
**Title**: Projects — milestones and task dependencies
**Primary scope**: `createMilestone` doesn't exist despite full schema and dashboard copy claiming the capability (PROJ-002); `project_task_dependencies` is a dead table (PROJ-004).
**Feature groups targeted**: PROJ-002, PROJ-004.
**Dependencies**: Prompt 47.
**Expected implementation outcome**: Milestones and dependencies are genuinely creatable.
**Main verification requirement**: Milestone and dependency-graph tests.

### Prompt 49
**Title**: Projects — expenses
**Primary scope**: `createExpense` doesn't exist despite full schema and two granted permissions (PROJ-008).
**Feature groups targeted**: PROJ-008.
**Dependencies**: Prompt 47.
**Expected implementation outcome**: Project expenses can be entered and approved.
**Main verification requirement**: Expense create/approve test.

### Prompt 50
**Title**: Projects — budgets and resource allocation
**Primary scope**: `project_budgets` has no create/approve function (PROJ-010); resource allocation beyond the PM auto-assignment side effect doesn't exist (PROJ-005).
**Feature groups targeted**: PROJ-005, PROJ-010.
**Dependencies**: Prompt 47.
**Expected implementation outcome**: Budgets and team allocation are manageable.
**Main verification requirement**: Budget versioning/approval test.

### Prompt 51
**Title**: Projects — billing-milestone integration to Accounting
**Primary scope**: `project_billing_milestones` has FK columns anticipating a real Sales/Accounting handoff that no code populates (PROJ-009) — this makes the profitability calculation's revenue input structurally starved.
**Feature groups targeted**: PROJ-009, PROJ-013 (unblocks the existing correct-but-starved profitability math), PROJ-011 (collaboration — evaluate scope), PROJ-014, PROJ-015.
**Dependencies**: Prompt 49, 50.
**Expected implementation outcome**: A billing milestone can create a real Accounting invoice; profitability numbers become meaningful.
**Main verification requirement**: End-to-end test: milestone → invoice → profitability reflects real revenue.

### Prompt 52
**Title**: Assets — write UI for register, capitalization, assignment, disposal
**Primary scope**: `createManagedAsset`, `capitalizeManagedAsset`, `assignAsset`, `disposeManagedAsset` are all real, API-only (ASSET-001/003/004/013).
**Feature groups targeted**: ASSET-001, ASSET-003, ASSET-004, ASSET-013.
**Dependencies**: Prompt 19.
**Expected implementation outcome**: An asset manager can perform the full lifecycle through the product.
**Main verification requirement**: UI tests for each lifecycle action.

### Prompt 53
**Title**: Assets — transfers (from zero, not "read-only")
**Primary scope**: `asset_transfers` has no write function whatsoever, worse than the prior "read-only" characterization (ASSET-005).
**Feature groups targeted**: ASSET-005, ASSET-012 (standalone allocation workflow).
**Dependencies**: Prompt 52.
**Expected implementation outcome**: A real transfer create/approve flow.
**Main verification requirement**: Transfer lifecycle test.

### Prompt 54
**Title**: Assets — inspections and calibration
**Primary scope**: `asset_inspections` has no create function at all (ASSET-010/011) — cannot seed a single record today.
**Feature groups targeted**: ASSET-010, ASSET-011.
**Dependencies**: Prompt 52.
**Expected implementation outcome**: A real inspection/calibration workflow.
**Main verification requirement**: Inspection create/complete test.

### Prompt 55
**Title**: Assets — depreciation engine and Accounting GL handoff
**Primary scope**: The operational Assets module's depreciation tables are pure dead schema (ASSET-006); `disposeManagedAsset` never posts to Accounting despite a dedicated permission and FK columns (ASSET-015).
**Feature groups targeted**: ASSET-006, ASSET-015, ACC-043 (fix the float-vs-BigInt inconsistency when connecting).
**Dependencies**: Prompt 77–79 (Accounting fixes should land first or in lockstep).
**Expected implementation outcome**: Real depreciation runs; disposal/capitalization post real journal entries.
**Main verification requirement**: Depreciation-schedule test; GL-posting integration test.

### Prompt 56
**Title**: Assets — maintenance completion and Stock parts integration
**Primary scope**: `completeMaintenanceOrder` exists but has no route (ASSET-007); `asset_maintenance_parts` is completely orphaned despite a Stock FK (ASSET-008); preventive-maintenance scheduling has no write path (ASSET-009).
**Feature groups targeted**: ASSET-007, ASSET-008, ASSET-009.
**Dependencies**: Prompt 33–38 (Stock).
**Expected implementation outcome**: Maintenance orders can be closed through the UI; parts consumption really deducts Stock; preventive plans are schedulable.
**Main verification requirement**: End-to-end maintenance-order-to-stock-deduction test.

### Prompt 57
**Title**: POS — checkout UI (the module's single biggest gap)
**Primary scope**: `completePointOfSale` is real, atomic, and completely unreachable — the checkout page literally instructs the user to call the API directly (POS-001/002).
**Feature groups targeted**: POS-001, POS-002, POS-004.
**Dependencies**: Prompt 19.
**Expected implementation outcome**: A cashier can actually ring up a sale through the product.
**Main verification requirement**: End-to-end checkout UI test.

### Prompt 58
**Title**: POS — shifts, registers, cash management UI
**Primary scope**: `openShift`/`closeShift`/`createTerminal` are real, API-only (POS-006/007/008).
**Feature groups targeted**: POS-006, POS-007, POS-008.
**Dependencies**: Prompt 57.
**Expected implementation outcome**: Shift open/close and terminal setup usable through the product.
**Main verification requirement**: UI test for shift lifecycle.

### Prompt 59
**Title**: POS — products/catalog, promotions, loyalty
**Primary scope**: No POS-specific catalog layer exists (POS-003); promotions and loyalty are entirely unmodeled (POS-011/012).
**Feature groups targeted**: POS-003, POS-011, POS-012.
**Dependencies**: Prompt 57.
**Expected implementation outcome**: A real POS catalog with promotional pricing and a basic loyalty mechanism.
**Main verification requirement**: Discount/promotion application test.

### Prompt 60
**Title**: POS — receipts and hardware integration
**Primary scope**: No receipt document generation exists (POS-005); no barcode/printer/scanner integration exists (POS-013); offline behavior is absent (POS-014).
**Feature groups targeted**: POS-005, POS-013, POS-014.
**Dependencies**: Prompt 57.
**Expected implementation outcome**: Real receipt documents; basic hardware/barcode support; a documented offline-support scope decision (P2/P3).
**Main verification requirement**: Receipt-generation test.

### Prompt 61
**Title**: POS — return stock reversal and Accounting posting
**Primary scope**: POS returns record intent but never actually reverse stock (POS-019); POS sales create zero GL postings (POS-017, mirrors ACC-041).
**Feature groups targeted**: POS-009, POS-017, POS-019.
**Dependencies**: Prompt 12 (canonical stock-posting fix), 77–79 (Accounting).
**Expected implementation outcome**: Returns genuinely restock inventory; sales post real journal entries.
**Main verification requirement**: End-to-end return-to-stock and sale-to-GL tests.

### Prompt 62
**Title**: Quality — write UI for inspections and NCR
**Primary scope**: `createInspection`/`completeInspection`/`createNonconformance` are real, API-only (QUAL-002/003).
**Feature groups targeted**: QUAL-002, QUAL-003.
**Dependencies**: Prompt 19.
**Expected implementation outcome**: A quality inspector can create/complete inspections and NCRs through the product.
**Main verification requirement**: UI test for inspection and NCR creation.

### Prompt 63
**Title**: Quality — wire CAPA and Audits (functions exist, routes don't)
**Primary scope**: `createCapa` is real, tested-quality code with zero callers anywhere (QUAL-004/005); `quality_audits` has full schema and a dashboard link but no create function at all (QUAL-008) — genuinely the cheapest fix in this entire plan, since the CAPA logic already exists.
**Feature groups targeted**: QUAL-004, QUAL-005, QUAL-008.
**Dependencies**: Prompt 62.
**Expected implementation outcome**: CAPA and Audits become reachable and usable.
**Main verification requirement**: CAPA-creation-through-route test; audit-creation test.

### Prompt 64
**Title**: Quality — supplier quality write path and settings management
**Primary scope**: `quality_supplier_records` is pure orphaned schema despite a dashboard link (QUAL-006); `quality_settings` can never be updated after tenant provisioning (QUAL-001).
**Feature groups targeted**: QUAL-001, QUAL-006, QUAL-007 (customer complaint distinct workflow), QUAL-010 (calibration).
**Dependencies**: Prompt 62.
**Expected implementation outcome**: Supplier scorecards can populate; quality policy is editable.
**Main verification requirement**: Supplier-quality write test.

### Prompt 65
**Title**: Quality — real hold-gating in Stock/Procurement/Manufacturing
**Primary scope**: Quality holds are confirmed pure record-keeping today — they never block movement anywhere outside the Quality module itself, and there is no release function (QUAL-009). This is a P0-adjacent finding: a held batch can still ship, receive, or be consumed.
**Feature groups targeted**: QUAL-009.
**Dependencies**: Prompts 33–38 (Stock), 29–32 (Procurement), 39–46 (Manufacturing).
**Expected implementation outcome**: A quality hold genuinely blocks the relevant movement in Stock/Procurement/Manufacturing until released.
**Main verification requirement**: Cross-module test: held batch cannot ship/receive/be consumed until release.

### Prompt 66
**Title**: Support — write UI for tickets and communications
**Primary scope**: `createSupportTicket`, `addSupportCommunication`, `transitionSupportTicket` are all real, API-only (SUP-001/005).
**Feature groups targeted**: SUP-001, SUP-005.
**Dependencies**: Prompt 19.
**Expected implementation outcome**: A support agent can create tickets and transition status through the product.
**Main verification requirement**: UI test for ticket creation and status transition.

### Prompt 67
**Title**: Support — real escalation engine
**Primary scope**: No function anywhere — manual or automatic — creates an escalation today, worse than "auto-trigger not wired" (SUP-007). Also fix `pause_on_pending_customer`/`business_hours_only` SLA flags that are stored but never applied (SUP-006).
**Feature groups targeted**: SUP-006, SUP-007.
**Dependencies**: Prompt 16 (scheduler).
**Expected implementation outcome**: Escalations are genuinely creatable, manually and on a schedule; SLA due-dates respect business hours and pending-customer pauses.
**Main verification requirement**: Escalation-creation test; SLA-pause calculation test.

### Prompt 68
**Title**: Support — channel integrations (email/chat)
**Primary scope**: `channel` is a stored label with zero live integration (SUP-004).
**Feature groups targeted**: SUP-004.
**Dependencies**: Prompt 14 (webhook/email delivery foundation).
**Expected implementation outcome**: At least email-channel ticket creation/reply is real.
**Main verification requirement**: Inbound-email-to-ticket integration test.

### Prompt 69
**Title**: Support — portal, knowledge base linking, CSAT, canned responses
**Primary scope**: No customer-facing portal exists (SUP-008); `satisfaction_score` is a dead column (SUP-011); canned responses don't exist (SUP-010); knowledge-article linking/feedback is unwired (SUP-009).
**Feature groups targeted**: SUP-008, SUP-009, SUP-010, SUP-011.
**Dependencies**: Prompt 66.
**Expected implementation outcome**: A minimal customer portal; CSAT capture; canned responses; article linking/feedback.
**Main verification requirement**: CSAT-capture test; portal-access test.

### Prompt 70
**Title**: HR & Payroll — P0 payroll-correctness fix (MUST come before any new statutory feature)
**Primary scope**: The payroll calculation engine is confirmed non-functional today: `deductions`/`employer` are hardcoded to `0`, and employee compensation can never be assigned through the app at all, so gross pay resolves to `0` for every real run (HR-010, HR-012). Per the research agent's explicit judgment, this must be fixed before extending statutory features, not alongside.
**Feature groups targeted**: HR-010, HR-012.
**Dependencies**: None — highest priority in the HR campaign.
**Expected implementation outcome**: Compensation can be assigned; gross pay is a real, non-zero, correctly computed number; deductions/employer contributions are computed, not hardcoded.
**Main verification requirement**: A payroll-run test asserting a known compensation input produces a correct, non-zero gross/net result.

### Prompt 71
**Title**: HR & Payroll — statutory calculation engine (PF/ESI/PT/TDS)
**Primary scope**: `hr_statutory_components` is a well-designed, entirely unused rates/slabs table (HR-014).
**Feature groups targeted**: HR-014.
**Dependencies**: Prompt 70.
**Expected implementation outcome**: Real slab-based statutory deduction calculation feeding into payslips.
**Main verification requirement**: Statutory-calculation test against known rate slabs.

### Prompt 72
**Title**: HR & Payroll — write UI for employee records, org structure, attendance
**Primary scope**: `createEmployee` has no update path at all (HR-001); departments/designations have no create/update function (HR-002); `hr_attendance` has zero capture mechanism despite being read by payroll (HR-005).
**Feature groups targeted**: HR-001, HR-002, HR-005, HR-006 (shifts).
**Dependencies**: Prompt 19.
**Expected implementation outcome**: Employee records are editable; org structure is manageable; attendance can actually be captured (making HR-005's payroll dependency real for the first time).
**Main verification requirement**: UI tests for employee edit, department create, attendance entry.

### Prompt 73
**Title**: HR & Payroll — recruitment and onboarding
**Primary scope**: Recruitment/candidates has zero schema or code (HR-003); onboarding columns exist but nothing transitions them (HR-004).
**Feature groups targeted**: HR-003, HR-004.
**Dependencies**: Prompt 72.
**Expected implementation outcome**: A basic recruitment pipeline and a real onboarding-status workflow.
**Main verification requirement**: Candidate/onboarding lifecycle test.

### Prompt 74
**Title**: HR & Payroll — talent management (performance/goals/appraisal/learning)
**Primary scope**: Zero schema or code exists for any of these (HR-017) — the largest single MISSING cluster in the module.
**Feature groups targeted**: HR-017.
**Dependencies**: Prompt 72.
**Expected implementation outcome**: A minimal goals/appraisal cycle; scope decision on learning/talent depth (likely P2/P3).
**Main verification requirement**: Appraisal-cycle test.

### Prompt 75
**Title**: HR & Payroll — separation/offboarding and ESS/MSS
**Primary scope**: Nothing ever sets `separation_date` despite a dashboard KPI counting it (HR-018); no employee/manager self-service scoped views exist (HR-015/016).
**Feature groups targeted**: HR-015, HR-016, HR-018, HR-019 (expenses — no create function exists).
**Dependencies**: Prompt 72.
**Expected implementation outcome**: Real separation workflow with access-revocation linkage; ESS "my profile/payslip/leave" views; MSS team-scoped approval.
**Main verification requirement**: Separation-to-access-revocation test.

### Prompt 76
**Title**: HR & Payroll — GL posting integration to Accounting
**Primary scope**: `transitionPayrollRun`'s `post` action only stores an opaque caller-supplied string today — no real journal entry is ever created (HR-021, mirrors ACC-042).
**Feature groups targeted**: HR-021.
**Dependencies**: Prompt 70, 77–79 (Accounting).
**Expected implementation outcome**: Posting a payroll run creates a real, balanced Accounting journal entry.
**Main verification requirement**: End-to-end test: post payroll run → journal entry exists and balances.

---

## Accounting targeted fixes (77–79)

### Prompt 77
**Title**: Accounting — depreciation and tax-ledger correctness fixes
**Primary scope**: `generateDepreciationSchedule` silently substitutes straight-line math when a user selects `units_of_production` (ACC-035, a real calculation bug); tax-ledger-to-journal-line pairing relies on array index order rather than a stable key (ACC-016, fragile).
**Feature groups targeted**: ACC-016, ACC-035.
**Dependencies**: None.
**Expected implementation outcome**: Units-of-production depreciation computes correctly or fails loudly instead of silently defaulting; tax-ledger pairing uses a stable reference.
**Main verification requirement**: Depreciation-method test covering all three methods including units-of-production.

### Prompt 78
**Title**: Accounting — TDS section-rate master, TCS calculation, consolidation eliminations
**Primary scope**: TDS is tracked but has no section-rate master or certificate generation (ACC-034); TCS exists only as an enum value with no calculation (ACC-040); consolidation eliminations are manual-only (ACC-025).
**Feature groups targeted**: ACC-025, ACC-034, ACC-040.
**Dependencies**: None.
**Expected implementation outcome**: Real TDS section-rate lookup; real TCS threshold calculation; automatic intercompany-balance elimination detection.
**Main verification requirement**: TDS/TCS calculation tests against known rates/thresholds.

### Prompt 79
**Title**: Accounting — e-invoice/e-way bill provider integration and cross-module GL wiring
**Primary scope**: E-invoice/e-way bill have real request-tracking scaffolding but zero actual GSTN/IRP integration (ACC-038/039, BLOCKED on external provider credentials); POS, HR & Payroll, and the Assets module are all still fully isolated from Accounting's GL (ACC-041/042/043, mirrors POS-017/HR-021/ASSET-015).
**Feature groups targeted**: ACC-038, ACC-039, ACC-041, ACC-042, ACC-043.
**Dependencies**: Prompts 55, 61, 76 (the module-side halves of each integration).
**Expected implementation outcome**: A real GSTN/IRP connector behind the existing scaffolding (external credentials required — flag as BLOCKED until available); real journal postings from POS/Payroll/Assets.
**Main verification requirement**: GL-posting integration tests for all three source modules; e-invoice sandbox test if credentials are available, otherwise a documented BLOCKED status.

---

## Shared platform remaining gaps (80–86)

### Prompt 80
**Title**: Security — real MFA enrollment flow
**Primary scope**: MFA has been schema-ready-but-not-enrollable since Prompt 1, reconfirmed unchanged in Prompt 11 (SHARED-017).
**Feature groups targeted**: SHARED-017.
**Dependencies**: None.
**Expected implementation outcome**: A user can actually enroll in and use MFA.
**Main verification requirement**: MFA enrollment and login-challenge test.

### Prompt 81
**Title**: Workspace Settings — organization branding/white-label
**Primary scope**: Confirmed fully absent since Prompt 10 (SHARED-010) — no logo/brand-color/custom-domain fields exist anywhere.
**Feature groups targeted**: SHARED-010.
**Dependencies**: None.
**Expected implementation outcome**: Real, persisted, applied org branding.
**Main verification requirement**: Branding-persistence test.

### Prompt 82
**Title**: Approval delegation
**Primary scope**: Newly confirmed gap — zero delegation/out-of-office reassignment capability exists anywhere (SHARED-029).
**Feature groups targeted**: SHARED-029.
**Dependencies**: None.
**Expected implementation outcome**: A user can delegate approval authority for a bounded period.
**Main verification requirement**: Delegation-and-approval-as-delegate test.

### Prompt 83
**Title**: SSO and SMS/WhatsApp provider integration
**Primary scope**: Both confirmed absent (SHARED-051, SHARED-049) — SMS/WhatsApp consent tracking exists but no provider is wired.
**Feature groups targeted**: SHARED-049, SHARED-051.
**Dependencies**: Prompt 21.
**Expected implementation outcome**: A real SSO provider connection; a real SMS/WhatsApp send capability (external credentials required).
**Main verification requirement**: SSO login test; SMS-send test against a sandbox provider, or documented BLOCKED status if credentials are unavailable.

### Prompt 84
**Title**: UX polish — dark mode, accessibility, mobile-web audit
**Primary scope**: Confirmed light-only theme (SHARED-066); accessibility relies on lint-time guardrails only, no verified audit (SHARED-063); responsive breadth not independently verified (SHARED-062).
**Feature groups targeted**: SHARED-062, SHARED-063, SHARED-066.
**Dependencies**: None.
**Expected implementation outcome**: A working dark-mode toggle; a documented, verified accessibility baseline; a documented responsive/mobile-web baseline.
**Main verification requirement**: Automated contrast-check pass; manual mobile-viewport walkthrough of every module.

### Prompt 85
**Title**: Data management breadth — remaining 8 modules
**Primary scope**: Extend Prompt 22's generic import/export/bulk-update/duplicate framework to Accounting, Procurement, Stock, Manufacturing, Assets, POS, Quality, Support, HR & Payroll (whichever remain uncovered after module campaigns).
**Feature groups targeted**: SHARED-068, SHARED-069, SHARED-070, SHARED-071 (breadth completion).
**Dependencies**: Prompt 22, all module campaigns.
**Expected implementation outcome**: Data management coverage extends materially past the current 2-of-12 modules.
**Main verification requirement**: Import/export tests per newly-covered module.

### Prompt 86
**Title**: Data governance — retention breadth and DR posture verification
**Primary scope**: Retention config is CRM-only today (SHARED-072); backup/restore/DR posture could not be confirmed from application code alone (SHARED-077).
**Feature groups targeted**: SHARED-072, SHARED-077.
**Dependencies**: Prompt 93 (may need to run alongside/after the dedicated DR prompt).
**Expected implementation outcome**: Retention policy configurable per module; a verified, documented DR/backup posture (even if the answer is "this is infra-layer, here is the runbook").
**Main verification requirement**: Retention-policy test; DR runbook review.

---

## Final hardening reserve (87–102)

### Prompt 87
**Title**: Cross-module end-to-end journey verification
**Primary scope**: Re-run the 10 critical journeys identified in `ERP_FEATURE_RECONCILIATION_011.md` Section 22 (tenant/security, CRM→Sales, Sales fulfillment, Procurement, Manufacturing, Support, HR/Payroll, Projects, POS, Quality) now that the module campaigns have closed most of the cross-module gaps that broke them in Prompt 11.
**Feature groups targeted**: All cross-module integration rows across the matrix.
**Dependencies**: All module campaigns (23–79).
**Expected implementation outcome**: A documented pass/fail for every journey with any remaining breaks fixed or explicitly deferred.
**Main verification requirement**: A real E2E test suite covering all 10 journeys.

### Prompt 88
**Title**: Landing Playwright e2e stabilization
**Primary scope**: The `apps/landing` e2e suite has shown intermittent instability across Prompts 4–10 (connection-reset/timeout errors, mobile-chromium visual-review screenshots) — confirmed pre-existing and unrelated to the ERP application each time, never root-caused.
**Feature groups targeted**: n/a (landing infrastructure, not a feature-matrix row).
**Dependencies**: None.
**Expected implementation outcome**: A stable, reliably-passing landing e2e suite.
**Main verification requirement**: `pnpm test:landing:e2e` passing consistently across repeated runs.

### Prompt 89
**Title**: Performance hardening
**Primary scope**: Areas flagged as performance-risk: large lists, reports, audit logs, global search, inventory ledger, accounting reports, payroll, manufacturing MRP.
**Feature groups targeted**: n/a (cross-cutting).
**Dependencies**: Module campaigns that build these features for real (33–46, 70–76, 98).
**Expected implementation outcome**: Measured, acceptable response times under realistic data volume for the highest-risk pages.
**Main verification requirement**: Load/performance test suite with defined thresholds.

### Prompt 90
**Title**: Security review pass #2
**Primary scope**: Adversarial re-review of all new surface area introduced by prompts 12–89, matching the rigor of Prompt 3's original hardening pass.
**Feature groups targeted**: n/a (cross-cutting).
**Dependencies**: Prompts 12–89.
**Expected implementation outcome**: A documented review with any newly-introduced gaps closed.
**Main verification requirement**: A written adversarial review report plus regression tests for anything found.

### Prompt 91
**Title**: Migration and schema consolidation
**Primary scope**: Dead-schema cleanup review (this reconciliation found many: `workflow_definitions`, `manufacturing_cost_snapshots`/`planning_runs` before Prompt 42-43, `asset_transfers`/`inspections` before Prompt 53-54, etc. — verify all have been addressed or intentionally retired); the pre-existing duplicate migration-prefix warning (`039_*`).
**Feature groups targeted**: SHARED-035, SHARED-078.
**Dependencies**: All prior prompts.
**Expected implementation outcome**: No orphaned schema remains undocumented; migration numbering is clean.
**Main verification requirement**: `pnpm verify:db` plus a manual schema-vs-code cross-reference pass.

### Prompt 92
**Title**: Observability foundation
**Primary scope**: Logging/metrics/tracing maturity was not independently audited in Prompt 11 — establish a real baseline.
**Feature groups targeted**: n/a (cross-cutting, infra).
**Dependencies**: None.
**Expected implementation outcome**: Structured logging, basic metrics, and error tracking wired across the application.
**Main verification requirement**: A dashboard/alert proving a real signal is captured end-to-end.

### Prompt 93
**Title**: Disaster recovery / backup runbook
**Primary scope**: SHARED-077 — could not be confirmed from application code; verify and document the real posture.
**Feature groups targeted**: SHARED-077.
**Dependencies**: None.
**Expected implementation outcome**: A tested backup/restore procedure and a written runbook.
**Main verification requirement**: A real restore-from-backup drill.

### Prompt 94
**Title**: Final accessibility (WCAG AA) audit
**Primary scope**: Verify the baseline established in Prompt 84 holds across every module after all campaign work.
**Feature groups targeted**: SHARED-063.
**Dependencies**: Prompt 84, all module campaigns.
**Expected implementation outcome**: A documented WCAG AA pass across the full application.
**Main verification requirement**: Automated + manual accessibility audit report.

### Prompt 95
**Title**: Final responsive/mobile-web audit
**Primary scope**: Verify the baseline established in Prompt 84 holds across every module after all campaign work, including the many new write-UI forms added in 17-19/33-76.
**Feature groups targeted**: SHARED-062.
**Dependencies**: Prompt 84, all module campaigns.
**Expected implementation outcome**: A documented responsive/mobile-web pass across the full application.
**Main verification requirement**: Manual mobile-viewport walkthrough of every new form.

### Prompt 96
**Title**: Notification scheduling completion
**Primary scope**: Complete the digest/scheduled-notification capability started in Prompt 16.
**Feature groups targeted**: SHARED-058.
**Dependencies**: Prompt 16.
**Expected implementation outcome**: Users can receive scheduled digests, not just real-time notifications.
**Main verification requirement**: Scheduled-digest delivery test.

### Prompt 97
**Title**: KPI framework and cross-module analytics/BI
**Primary scope**: Build a real, reusable KPI/metric-definition abstraction and cross-module analytics on top of Prompt 20's chart-library foundation.
**Feature groups targeted**: SHARED-040, SHARED-042.
**Dependencies**: Prompt 20.
**Expected implementation outcome**: At least one genuine cross-module analytics view (e.g., a company-wide operations summary spanning Sales/Stock/Manufacturing/Accounting).
**Main verification requirement**: Cross-module analytics query correctness test.

### Prompt 98
**Title**: Reports & Analytics completion — remaining 8 modules
**Primary scope**: Only CRM/Sales/Procurement/Accounting have real report implementations today (SHARED-037); build real reports for Stock, Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll.
**Feature groups targeted**: SHARED-037.
**Dependencies**: Prompt 20, corresponding module campaigns.
**Expected implementation outcome**: `/reports` genuinely covers all 12 modules.
**Main verification requirement**: A report test per newly-covered module.

### Prompt 99
**Title**: Automation completion — cross-module
**Primary scope**: Automation remains CRM-only (SHARED-033); extend the rule-engine pattern to at least Sales and Support using the Prompt 13-16 scheduler foundation.
**Feature groups targeted**: SHARED-033.
**Dependencies**: Prompts 13-16.
**Expected implementation outcome**: At least one non-CRM module has a real, working automation rule engine.
**Main verification requirement**: Cross-module automation execution test.

### Prompt 100
**Title**: Integration completion — marketplace/e-commerce/live bank feed
**Primary scope**: E-commerce/marketplace connectors and a live bank-feed connector are both confirmed absent (SHARED-050 and the Banking UI-verification gap from ACC-014).
**Feature groups targeted**: SHARED-050.
**Dependencies**: Prompts 21, 83.
**Expected implementation outcome**: At least one real e-commerce/marketplace connector; a live (not CSV-import-only) bank feed.
**Main verification requirement**: Connector integration test against a sandbox provider.

### Prompt 101
**Title**: Full regression and UAT-readiness re-verification
**Primary scope**: Re-run `ERP_TEAM_UAT_SCOPE_011.md` against the final state of the application after all 89 prior prompts, updating every feature's UAT status.
**Feature groups targeted**: All.
**Dependencies**: All prior prompts.
**Expected implementation outcome**: An updated, accurate UAT scope document reflecting genuinely higher READY/LIMITED counts and a near-zero NOT_READY count for P0/P1 features.
**Main verification requirement**: `pnpm release:verify` full green run; UAT scope document refresh.

### Prompt 102
**Title**: Final feature-catalogue reconciliation and launch readiness sign-off
**Primary scope**: Re-run this entire Prompt 11 reconciliation methodology (the same 7-agent evidence-based inventory approach) against the finished application state, producing a final honest completion picture and a go/no-go launch recommendation.
**Feature groups targeted**: All.
**Dependencies**: All prior prompts.
**Expected implementation outcome**: A final `ERP_FEATURE_RECONCILIATION_FINAL.md` with updated statistics, a closed-loop comparison against Prompt 11's baseline, and an explicit launch-readiness recommendation.
**Main verification requirement**: Full `pnpm release:verify` green; final adversarial review; sign-off checklist complete.
