# Vercentlabs ERP — Team UAT Scope (Prompt 11 of 102)

This document tells the Vercentlabs team what can genuinely be tested in the product **today**. It intentionally excludes every feature classified MISSING, NOT_READY, or BLOCKED in `ERP_FEATURE_RECONCILIATION_011.md` — sending those to testers would waste their time and produce noise, not signal. Full status detail for everything (including what's excluded and why) lives in `ERP_FEATURE_MATRIX_011.csv` / `ERP_ACCOUNTING_MATRIX_011.csv`.

**Read this first — the single most important limitation across this entire scope**: eight modules (Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll, and most of Stock) have real backend logic that is **not reachable through the product UI today** — only through a direct API call. A normal tester using the application cannot exercise these, no matter how "complete" the backend is. Those areas are therefore excluded from this checklist even where the reconciliation found genuinely correct backend code, and are called out explicitly per module below so the team understands *why* a module they know has real code isn't listed.

## Security personas (real roles only — no invented roles)

Use these existing role slugs from `apps/web/src/lib/access-control.ts` when assigning UAT testers:

| Persona | Slug | Use for |
|---|---|---|
| Organization Owner | `organization_owner` | Full-scope smoke testing, tenant/security journey |
| System Administrator | `system_administrator` | Cross-company administration |
| Company Administrator | `company_administrator` | Company-scoped administration |
| Auditor | `auditor` | Read-only governance/compliance/audit-log testing |
| Read-only user | `read_only` | Negative-path testing (confirm no mutation is possible) |
| CRM Administrator | `crm_administrator` | CRM configuration + `automation.view` |
| Sales Head / Sales Manager / Sales Representative | `sales_head` / `sales_manager` / `sales_representative` | Sales workflow + scope-restriction negative tests |
| Sales Operations | `sales_operations` | Sales settings/reporting |
| Finance Manager / Accountant / AR Executive / AP Executive / Treasury Executive / Tax Compliance Accountant | `finance_manager` / `accountant` / `accounts_receivable_executive` / `accounts_payable_executive` / `treasury_executive` / `tax_compliance_accountant` | Accounting — use the narrowest role that covers the workflow under test |
| Purchase Manager / Buyer / Purchase Requester / Purchase Approver / Goods Receipt User / Supplier Manager | Procurement roles | Procurement workflow + scope tests |
| Inventory Manager | `inventory_manager` | Stock (API-only currently — see Stock section) |
| Manufacturing Manager | `manufacturing_manager` | Manufacturing (API-only currently) |
| Project Manager | `project_manager` | Projects (API-only currently) |
| Asset Manager | `asset_manager` | Assets (API-only currently) |
| POS Manager | `pos_manager` | POS (API-only currently) |
| Quality Manager | `quality_manager` | Quality (API-only currently) |
| Support Manager | `support_manager` | Support (API-only currently) |
| HR Manager | `hr_manager` | HR & Payroll — **do not test payroll calculation as if correct, see HR section** |

## UAT data requirements (setup)

Before UAT begins, seed: **two organizations** (to test cross-tenant isolation negatives), each with **at least two companies** and **two branches**, a **CRM-restricted user** (holds only `crm.leads.manage`, no `crm.records.view_all` — note this permission is currently broken, see Platform section) alongside a **CRM manager-equivalent user**, a **supplier** and a **customer** master record, **at least 5 stock items** with distinct UOMs, **one warehouse** with at least one location, a **populated chart of accounts** (already seeded by default), and **at least 3 employees** in HR (create-only is testable; edits are not — see HR section).

## Negative/security tests (run alongside every area below)

For every area marked READY below, also verify: direct URL access is denied for a user without the required permission; the equivalent API call returns 403/401 for the same user; a cross-company record is not visible/editable; a cross-branch record is not visible/editable where branch scope applies; a disabled/not-entitled module's routes 404 or redirect, not silently render; an invalid state transition is rejected server-side (not just hidden client-side); a duplicate submission (double-click) does not create a duplicate record where idempotency is claimed.

---

## Platform

**Known limitation to disclose to every tester before starting**: `crm.records.view_all` (the "manager sees the whole team's CRM records" permission) is currently broken — see Reconciliation Section 23. New-organization onboarding may fail if it seeds a role holding this permission. **Recommend testing with existing seeded organizations only until this is fixed (Prompt 12), not by creating new ones.**

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Login, session, logout | any | seeded user | Session created/revoked correctly | — | READY |
| Company/branch context switch | `organization_owner` | 2 companies, 2 branches seeded | Switching updates visible data and triggers a real page refresh | — | READY |
| Global search | any | seeded records | Real cross-resource results, permission-scoped | Accounting/Sales/Stock not covered by search yet | LIMITED |
| Command palette / Quick Create | any | — | Real overlay, real record creation shortcuts | — | READY |
| Favourites / Recent records | any | — | Real, persisted per-user | — | READY |
| My Work (tasks/follow-ups/exceptions) | any | seeded activities across modules | Real cross-module aggregation | Stock exceptions explicitly not included (documented on the page) | READY |
| Notifications | any | trigger an event (e.g. approval request) | Real, real "mark read" | Real-time only, no scheduled digest yet | LIMITED |
| Roles & permissions administration | `organization_owner` | — | Real create/assign, grant-ceiling enforced | — | READY |
| Sessions / personal security page | any | — | Real password change, real session revocation list | MFA not enrollable yet (schema-only) | LIMITED |
| Security — org-wide overview | `auditor` | — | Real active-session/role counts, real field/record-access inventory | — | READY |
| Audit Logs (Activity/History/Security) | `auditor` | trigger any mutation first | Real, immutable, redacted where sensitive | — | READY |
| Compliance / Data Governance inventory | `auditor` | — | Real DB-backed status per capability | Explicitly not a certification claim | READY |
| Automation (CRM rule engine) | `crm_administrator` | seed a lead-created rule | Real rule executes, real execution history shown | Only 3 of 7 defined trigger types actually fire (page discloses this) | LIMITED |
| Reports & Analytics catalogue | any with module access | — | Real links into CRM/Sales/Procurement/Accounting reports | Only 4 of 12 modules represented (page discloses this) | LIMITED |
| Integrations (Razorpay, webhooks, email) | `organization_owner` | — | Real payment/billing status; webhook subscriptions creatable | Webhook delivery worker doesn't exist yet — subscriptions won't actually deliver | LIMITED |
| Data Management (import/export/bulk-update) | varies by resource | — | Real for CRM + master data + CRM/Sales bulk update | Only CRM + master data + Sales bulk update covered (page discloses this) | LIMITED |
| Billing / subscription management | `organization_owner` | — | Real Razorpay checkout/verify/cancel | — | READY |

## CRM

**Excluded from this section**: none of significant note — CRM is the most UI-complete module in the product.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Lead create/edit/convert | `crm_administrator` or `sales_representative` | — | Real persistence, real conversion to opportunity | — | READY |
| Duplicate detection/merge | `crm_administrator` | 2 similar leads | Real duplicate flagging and merge | — | READY |
| Opportunity/pipeline stage transitions | `sales_manager` | — | Real stage-history, playbook-gated transitions | — | READY |
| Activities/calls/meetings | any CRM role | — | Real create/complete | — | READY |
| Campaigns/segments/journeys | `marketing_manager` | — | Real create/execute | — | READY |
| Forecasting report | `sales_head` | seeded pipeline data | Real owner-scoped forecast | — | READY |
| Public lead-capture form | n/a (external) | a real capture key | Real HMAC-verified submission | No rate limiting yet — do not load-test against a shared org's key | LIMITED |
| **Record ownership scoping ("my records" vs "my team's records")** | `sales_representative` vs `sales_head` | — | A rep should see only assigned records; a manager holding `crm.records.view_all` should see the whole team's | **Currently broken — see Platform section. Test the rep-restriction half only; do not test the manager-visibility half until Prompt 12 lands.** | LIMITED |
| CRM automation execution history | `crm_administrator` | trigger a lead-created rule | Real, redacted execution log | — | READY |

## Sales

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Quotation create/revise/approve | `sales_manager` | catalogue item + price list seeded | Real versioning, real approval | — | READY |
| Public quote accept/reject | n/a (external) | a sent quote token | Real customer-facing decision capture | — | READY |
| Sales order create/confirm | `sales_manager` | — | Real 9-action lifecycle | — | READY |
| Credit-limit blocking | `sales_representative` | customer with a low credit limit | Order confirmation blocked with `SALES_CREDIT_BLOCK` unless overridden | — | READY |
| Order hold placement | `sales_manager` | — | Real hold placed | **Hold release is broken — the UI button is permanently disabled.** Do not test hold release; log it as a known defect if a tester finds it independently. | LIMITED |
| Order amendment/revision | `sales_manager` | — | Real amendment with approval | — | READY |
| Sales → Accounting invoice request/import | `finance_manager` | a confirmed order | Real invoice created in Accounting | Manual two-step (request, then import) — not automatic | LIMITED |
| Sales dashboards/reports | `sales_head` | — | Real margin/profitability data | — | READY |

**Excluded**: stock reservation, fulfillment, returns, backorders, drop-ship, recurring orders — all confirmed non-functional or absent, see Reconciliation Section 10.

## Accounting

Accounting is the most UI-complete, best-tested module in the product — nearly everything below is genuinely READY.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Chart of accounts / journal entry create-approve-post | `accountant` | — | Real double-entry enforcement (rejects unbalanced entries) | — | READY |
| AR: customer invoice, receipt, allocation, ageing | `accounts_receivable_executive` | a customer seeded | Real, correct ageing buckets | — | READY |
| AP: vendor bill, payment, allocation, ageing | `accounts_payable_executive` | a supplier seeded | Real, correct ageing buckets | — | READY |
| Bank statement import + reconciliation | `treasury_executive` | a sample CSV | Real match suggestions, real reconciliation | Match confidence is a simple binary score, not fuzzy matching | LIMITED |
| Fixed asset capitalize/transfer/impair/dispose | `accountant` | — | Real GL journal posted on every transition | — | READY |
| Depreciation schedule generation | `accountant` | an asset with straight-line or declining-balance method | Correct schedule | **Do not test `units_of_production` method — it silently computes straight-line instead (known bug, Prompt 77 fix pending).** | LIMITED |
| Budget create/approve/activate + variance report | `finance_manager` | — | Real dimension-aware variance | — | READY |
| Cash forecast | `treasury_executive` | open AR/AP seeded | Real probability-weighted forecast | — | READY |
| Period close run | `finance_manager` | — | Real multi-task governed close | Year-end close type not independently verified beyond the same engine | LIMITED |
| Financial statements (P&L, Balance Sheet, Cash Flow) | `finance_manager` | posted journals | Real computed statements, not static | — | READY |
| Consolidation | `finance_manager` | 2+ companies with ownership % set | Real FX-translated roll-up | Eliminations are manual-entry only | LIMITED |
| GST tax ledger | `tax_compliance_accountant` | — | Real per-component (CGST/SGST/IGST) posting | — | READY |
| Recurring journal templates / dunning | `accountant` | — | Real scheduled-template execution / dunning action records | Dunning likely records actions only — do not expect a real email/SMS to send | LIMITED |

**Excluded**: e-invoice/e-way bill (real tracking shell, no actual GSTN/IRP integration — do not attempt to generate a real IRN), TCS calculation (not implemented), POS/HR-Payroll/Assets GL postings (confirmed not to exist yet).

## Procurement

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Supplier create/lifecycle (submit→qualify→activate→suspend) | `supplier_manager` | — | Real state machine, version-locked | — | READY |
| Requisition create/approve | `purchase_requester` / `purchase_approver` | — | Real approval chain | — | READY |
| Purchase order create/approve/dispatch/receive | `purchase_manager` | a requisition | Real state machine | — | READY |
| PO amendment | `purchase_manager` | an active PO | Real amendment with rollback on rejection | — | READY |
| Goods receipt (GRN) | `goods_receipt_user` | an approved PO | Real over-receipt prevention | **Receiving does not update Stock inventory — confirm the receipt is recorded, do not expect a stock-balance change.** | LIMITED |
| 2-way/3-way invoice matching | `finance_manager` | a receipt + vendor bill | Real tolerance-based matching | 4-way mode is broken (inspection-acceptance field never set) — test 2-way/3-way only | LIMITED |
| Matched invoice → Accounting vendor bill import | `accounts_payable_executive` | a resolved match | Real vendor bill created | Manual trigger only | LIMITED |
| Procurement analytics/reports | `purchase_manager` | — | Real, 12 report types | — | READY |
| Governance/control-tower dashboard | `purchase_manager` | — | Real readiness/risk scoring | — | READY |

**Excluded**: RFQ/sourcing bid-evaluation-award (backend real, reachable today only via a raw browser prompt — not fit for normal UAT), budget checks, catalogue browsing, supplier portal, drop-ship — all confirmed absent.

## Stock

**This module is almost entirely excluded from UAT today** — the reconciliation found real, correct backend logic (movement posting with row-locking, moving-average costing, atomic transfers) but confirmed **zero UI anywhere in the product** to invoke it. Master data (items, UOM, warehouses, locations) is the one genuinely UI-testable part.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Item master create/edit | `inventory_manager` | — | Real CRUD via master-data pages | — | READY |
| UOM / UOM conversions | `inventory_manager` | — | Real CRUD | — | READY |
| Warehouse / location create | `inventory_manager` | — | Real CRUD | — | READY |
| Stock dashboard | `inventory_manager` | seeded items/movements | Real live counts | Only 4 metrics, no drill-down | LIMITED |

**Excluded (backend real, no UI to reach it)**: movements, adjustments, transfers, reservations, lots/serials, cycle counts, reorder planning, FIFO valuation, WMS operations.

## Manufacturing

**Almost entirely excluded from UAT today** for the same reason as Stock — real backend, zero UI.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Manufacturing dashboard | `manufacturing_manager` | seeded work orders | Real WO-count/shortage aggregation | Only 4 KPI tiles | LIMITED |

**Excluded**: BOM/work-order create/release/start/post (API-only), routing/work-center management (permission exists, zero implementation), MRP (dead schema), costing (dead schema), scrap/backflush (dead), subcontracting (dead). Do not attempt to test a full BOM-to-production flow through the UI — it does not exist.

## Projects

**Almost entirely excluded from UAT today.**

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Projects portfolio dashboard | `project_manager` | seeded projects | Real aggregation | Single view, no cross-project rollup | LIMITED |

**Excluded**: project/task create (API-only), time-entry approval (implemented, zero UI route), milestones/expenses/budgets/billing-milestones (zero write path at all — do not test, they cannot be created through any interface).

## Assets

**Excluded from UAT entirely today** — no UI exists for any create/edit/action, and three of the module's core capabilities (transfers, inspections, depreciation) have zero backend write path either.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Assets dashboard | `asset_manager` | seeded assets | Real aggregation | Single view | LIMITED |

## Point of Sale

**Excluded from UAT entirely today** — the checkout page itself instructs the user to call the API directly; there is no sell flow to test.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| POS dashboard | `pos_manager` | seeded sales | Real live counts | 4 metrics only | LIMITED |

## Quality

**Excluded from UAT entirely today** — inspections/NCR are API-only, CAPA and Audits are unreachable even via API from the product's own route set.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Quality dashboard | `quality_manager` | seeded inspections | Real live counts | No drill-down | LIMITED |

**Important disclosure for testers**: do not assume a "quality hold" blocks anything — it is confirmed advisory-only and does not prevent shipment, receipt, or consumption anywhere in Stock, Procurement, or Manufacturing today.

## Support

**Mostly excluded from UAT today** — ticket creation/transition/communication are all API-only.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Support dashboard | `support_manager` | seeded tickets | Real SLA-breach counts | No drill-down | LIMITED |

**Important disclosure for testers**: do not test escalation — no escalation can be created today, manually or automatically, despite what the nav link and dashboard counter might suggest.

## HR & Payroll

**Critical disclosure — read before any HR/Payroll testing**: **do not run a real payroll cycle expecting a correct number.** The calculation engine is confirmed broken: employee compensation cannot be assigned through the app, so gross pay resolves to `0`/`null`, and deductions/employer contributions are hardcoded to `0` regardless of input. Payroll-run testing should be limited to verifying the *workflow* (state transitions, maker-checker), never the *numbers*, until Prompt 70 lands.

| What to test | Role | Setup | Expected result | Limitation | UAT status |
|---|---|---|---|---|---|
| Employee create | `hr_manager` | — | Real record created | **No edit path exists — do not attempt to update an employee record.** | LIMITED |
| Leave request + approval | `hr_manager` + employee | — | Real self-approval block, real balance decrement | The one genuinely complete workflow in this module | READY |
| Payroll run creation/state transitions | `hr_manager` | — | Real maker-checker state machine | **Do not evaluate the resulting numbers — see disclosure above.** | LIMITED |
| Sensitive employee field masking | `hr_manager` without `hr_payroll.sensitive.view` vs. one with it | — | Restricted user should not see masked fields | — | READY |

**Excluded**: attendance capture, org-structure management, salary-structure management, statutory calculation, recruitment, onboarding, performance/learning/talent, separation, ESS/MSS, payroll GL posting — all confirmed absent or non-functional.

---

## Critical UAT journeys — status summary

See `ERP_FEATURE_RECONCILIATION_011.md` Section 22 for the full per-journey breakdown. Only **CRM → Sales (Lead → Opportunity → Quotation)** is fully working end-to-end today. Every other named journey (tenant/security, Sales fulfillment, Procurement, Manufacturing, Support, HR/Payroll, Projects, POS, Quality) is either partially broken or fully broken — do not schedule a full end-to-end UAT pass for any of them until the corresponding prompts in `ERP_EXECUTION_PLAN_012_102.md` close the gaps.
