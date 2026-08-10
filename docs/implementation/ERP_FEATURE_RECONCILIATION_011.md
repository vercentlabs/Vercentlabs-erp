# ERP Feature Reconciliation (Prompt 11 of 102)

Reconciliation date: 2026-08-10
Scope: full 1,039-feature historical baseline (945 module-specific across the original 11 modules + 94 shared platform) plus a separate Accounting reconciliation. No product code was modified to produce this document — see Section 33.

## 1. Executive Summary

Vercentlabs ERP is materially more built-out than a route/table/permission count alone would suggest, and materially less *usable* than its backend code alone would suggest. The single largest, most consistent finding across all twelve module-reconciliation passes: **eight of the twelve modules (Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll, and most of Stock) have real, often well-engineered backend business logic that is completely unreachable through the actual product UI.** Every one of those modules' list pages is a read-only table; every create/edit/action function exists only as a directly-callable API route. This is a different — and in some ways more actionable — finding than Prompt 1's original "thinner, but not stubs" characterization: the code is not thin, it is disconnected from the UI layer.

Three genuinely critical, currently-live findings emerged from this reconciliation, none of which were previously documented:

1. **A confirmed, live, production-breaking bug**: `crm.records.view_all` — the permission that lets a manager see their team's CRM records, added by Prompt 3's security hardening — was never inserted into the `permissions` table by any migration. It is referenced by 7 role templates. `role_permissions.permission_key` has a hard foreign key to `permissions(key)`. Verified live against the running database: 0 rows in `permissions`, 0 rows in `role_permissions`, for this key. `seedOrganizationFoundation` runs inside a single `transaction()` with no per-insert error handling. **New organization onboarding is broken today** for the code path that seeds any of those 7 roles. See Section 23.
2. **A confirmed cross-module data-integrity bug**: Manufacturing and Point of Sale each independently forked their own local `postStockMovement`-equivalent instead of calling Stock's canonical function, and both insert into `stock_movements` while never updating `stock_balances`. Production postings and POS sales therefore silently desynchronize the on-hand quantity that Stock's own dashboard and reorder logic reads. See Section 23.
3. **A confirmed payroll-correctness defect, not merely a gap**: HR & Payroll's calculation engine hardcodes `deductions` and `employer` contributions to `0`, and there is no way to assign employee compensation through the application at all — so gross pay resolves to `0` for every real payroll run today. See Section 19.

Balanced against this: Accounting is genuinely the strongest module in the repository (33 of 43 real functional areas assessed as COMPLETE, with a hard-enforced double-entry engine, a real BigInt decimal system, and genuinely tested close/consolidation/FX logic), CRM remains the most mature and complete module by a wide margin (an estimated 78% of its stated 74-feature baseline is genuinely COMPLETE), and the shared-platform work from Prompts 6–10 (command palette, Quick Create, My Work, Favourites, Recent, Audit Logs, Compliance, Automation, Reports, Integrations, Data Management, Security) turned out to be real, evidence-backed, and honestly self-documenting — every one of those workspaces states its own limitations in its own UI copy rather than implying completeness it doesn't have. No production-facing fake/mock/placeholder implementation was found anywhere across all twelve modules and the shared platform in this pass — every gap found is an honest absence, not a disguised one.

## 2. Scope and Counting Rules

The historical baseline used for this reconciliation is exactly as specified by the calling program:

```
945 module-specific (CRM 74, Sales 76, Procurement 79, Stock 90, HR & Payroll 108,
    Support 75, Quality 77, Point of Sale 89, Assets 73, Projects 86, Manufacturing 118)
+ 94 shared platform (SaaS 14, Security & Governance 15, Workflow & Automation 12,
    Reporting & Analytics 13, Integration 13, UX 15, Data Governance 12)
= 1,039 historical baseline
```

Accounting is reconciled **separately** in Section 8 / Section 21 and `ERP_ACCOUNTING_MATRIX_011.csv`. Its 43 assessed functional areas are **never added to the 1,039 denominator**, and no new combined total (e.g. "1,039 + Accounting") is reported anywhere in this document, per the calling program's explicit rule.

## 3. Source-of-Truth Hierarchy

Feature identity/wording: the calling program's own stated baseline (module and category names/counts above) is treated as historical fact. Implementation status: the current repository, verified by direct code inspection, not by any document. Supporting evidence: source files, routes, services, SQL, migrations, permissions, tests, and Prompts 1–10's own reports, cross-checked against current code rather than trusted at face value (several Prompt 1 findings were confirmed stale in this pass — see Section 20). Where documents and code disagree, current code wins. Where code contains a capability absent from any catalogue, it is recorded as an `ADDITIONAL_IMPLEMENTED_CAPABILITY` (Section 25) rather than silently folded into the 1,039 count.

## 4. Classification Method — and the CRITICAL SOURCE CHECK finding

Before classification began, this reconciliation searched the repository exhaustively for the exact, row-level, individually-named 1,039-feature master register the calling program's instructions describe. **It does not exist in this repository.** The only candidate document, `docs/VERCENTLABS_ERP_12_MODULE_FEATURE_REGISTER.md`, is a different, smaller, auto-generated static scan (236 capabilities, generated 2026-08-05, matched primarily against `apps/landing` marketing-page text rather than the authenticated application) that CLAUDE.md itself already flags as unreliable for verifying capability existence. Its own module counts (e.g. CRM 18, Sales 18) do not reconcile with the stated baseline (CRM 74, Sales 76) at all — it is not a subset or an earlier draft of the 1,039 catalogue, it is an unrelated document. Grepping the entire repository for "1,039", "945 module", "94 shared", "feature master register", "master feature catalogue", and "handoff" turned up no other candidate.

Per the calling program's own explicit fallback instruction for exactly this situation ("do not invent missing feature names... do NOT claim an exact 1,039-row reconciliation"), this reconciliation did **not** fabricate 1,039 named feature rows. Instead, it performed the maximum repository-side architecture inventory possible: **seven parallel, evidence-based research passes** (one covering CRM+Sales, one covering Procurement+Stock, one covering Manufacturing+Projects+Assets, one covering POS+Quality+Support, one covering HR & Payroll, one covering Shared Platform's 94-item breakdown, one covering Accounting separately), each required to inspect real routes, services, database tables, permissions, and tests — never to infer completion from any one of those alone (Parts 4–8 of the calling prompt) — and each required to actively search for fake/mock/placeholder implementation.

This conclusion is independently corroborated by `packages/landing-content/src/capability-registry.js`, discovered via `pnpm verify`'s own passing test suite ("capability registry sums to exactly 1,039... matching the settled CLAUDE.md total"): that file's own header comment states explicitly that "no such list exists anywhere in the repository" and that it deliberately operates at a coarser capability-group granularity (20 groups — 14 read live from each module's `capabilityGroups`, plus 6 shared-platform groups) each carrying an honest `requirementCount` allocation that sums to 945 and 94 respectively, rather than claiming 1,039 individually named rows. That file's platform decomposition (Tenant/RBAC/Approvals/Audit/Reporting-Document-Localization/Mobile-Billing) is a different, marketing-oriented cut than this reconciliation's engineering-oriented 7-category one (SaaS/Security/Workflow/Reporting/Integration/UX/Data-Governance) — both are valid decompositions of the same settled 94, and neither is the row-level register this prompt searched for.

`ERP_FEATURE_MATRIX_011.csv` therefore contains **288 real, evidence-backed functional-area rows** (not 1,039 fabricated named rows), each with a `feature_id`, module, status, UAT status, evidence, gap, blocker type, and recommended future-prompt cluster. Where a research pass gave a proportional estimate of how its real findings would map onto the *given* per-module baseline count (e.g., "roughly 78% of CRM's stated 74 would be COMPLETE"), that estimate is reported explicitly as an estimate in Section 5/6, never presented as a verified row-by-row count.

## 5. Overall 1,039 Statistics (estimated distribution, not a verified row-by-row count)

Each of the seven research passes gave a reasoned, evidence-weighted proportional estimate of how its real functional-area findings would distribute across the *given* per-module baseline counts. Aggregating those seven estimates against the full 1,039 denominator:

| Status | Count | Percentage |
|---|---:|---:|
| COMPLETE | 270 | 26.0% |
| PARTIAL | 187 | 18.0% |
| FOUNDATION_ONLY | 211 | 20.3% |
| UI_ONLY | 21 | 2.0% |
| MISSING | 349 | 33.6% |
| UNVERIFIED | 1 | 0.1% |
| **Total** | **1,039** | **100%** |

**Fully complete** (COMPLETE / 1,039) = **26.0%**. **At least partially implemented** ((COMPLETE + PARTIAL) / 1,039) = **44.0%**. These two numbers are never merged into a single misleading "X% complete" figure, per the calling program's own instruction.

## 6. Module Completion Matrix (estimated distribution against the stated baseline count)

| Module | Total | Complete | Partial | Foundation | UI Only | Missing | Unverified |
|---|---:|---:|---:|---:|---:|---:|---:|
| CRM | 74 | 58 | 10 | 4 | 1 | 1 | 0 |
| Sales | 76 | 34 | 10 | 14 | 2 | 16 | 0 |
| Procurement | 79 | 28 | 18 | 16 | 2 | 15 | 0 |
| Stock | 90 | 14 | 20 | 22 | 2 | 32 | 0 |
| Manufacturing | 118 | 10 | 25 | 35 | 0 | 48 | 0 |
| Projects | 86 | 8 | 15 | 20 | 0 | 43 | 0 |
| Assets | 73 | 10 | 12 | 8 | 0 | 43 | 0 |
| Point of Sale | 89 | 20 | 18 | 13 | 9 | 29 | 0 |
| Quality | 77 | 15 | 12 | 23 | 4 | 23 | 0 |
| Support | 75 | 19 | 11 | 15 | 0 | 30 | 0 |
| HR & Payroll | 108 | 10 | 15 | 35 | 1 | 47 | 0 |
| Shared platform | 94 | 44 | 21 | 6 | 0 | 22 | 1 |
| **Total** | **1,039** | **270** | **187** | **211** | **21** | **349** | **1** |

(UAT readiness by module is in Section 27; full per-area detail is in `ERP_FEATURE_MATRIX_011.csv`.)

## 7. Shared Platform Completion Matrix (94)

| Category | Total | Complete | Partial | Foundation | Missing | Unverified |
|---|---:|---:|---:|---:|---:|---:|
| SaaS platform | 14 | 10 | 2 | 1 | 1 | 0 |
| Security & governance | 15 | 9 | 4 | 2 | 0 | 0 |
| Workflow & automation | 12 | 4 | 4 | 0 | 4 | 0 |
| Reporting & analytics | 13 | 3 | 2 | 0 | 8 | 0 |
| Integration | 13 | 3 | 1 | 3 | 6 | 0 |
| UX | 15 | 11 | 2 | 0 | 2 | 0 |
| Data governance | 12 | 4 | 6 | 0 | 1 | 1 |
| **Total** | **94** | **44** | **21** | **6** | **22** | **1** |

Full narrative per category is in Section 20.

## 8. Accounting Separate Matrix

Reconciled independently against a standard ERP accounting domain checklist (not against a repository-sourced named catalogue — none exists for Accounting either). 43 functional areas assessed, one row each in `ERP_ACCOUNTING_MATRIX_011.csv`.

| Status | Count |
|---|---:|
| COMPLETE | 33 |
| PARTIAL | 4 |
| FOUNDATION_ONLY | 3 |
| UI_ONLY | 0 |
| MISSING | 3 |
| UNVERIFIED | 0 |
| **Total** | **43** |

**This total is not part of the 1,039 denominator anywhere in this document.**

## 9. CRM Findings

Estimated ~78% COMPLETE against its stated 74-feature baseline — the most mature module in the repository, matching and in some areas exceeding Prompt 1's characterization. All of accounts, contacts, leads, opportunities/pipeline, forecasting, activities, campaigns/journeys/segments, communications, conversation intelligence, customer success, partner engagement, privacy/consent, and 14 real report types are genuinely COMPLETE with typed relational schema, real state machines, and real ownership scoping. Two real findings: (1) the automation rule engine only fires 3 of its 7 defined trigger event types — the other 4 are configurable in the UI but never invoked by any code path; (2) `crm.records.view_all`, the permission underpinning "manager sees the whole team's records," is a confirmed live bug (Section 23) — the feature it gates is real and well-tested (`crm-record-scope.test.mjs`, 290 lines) but currently unusable by any role that isn't `organization_owner`. Lead scoring and the "AI-intelligence" features are confirmed deterministic rule-based/template systems, not real ML — this should never be marketed as AI.

## 10. Sales Findings

Estimated ~45% COMPLETE against its stated 76-feature baseline. The quote-to-order-to-invoice-request core (quotations with versioning, public accept/reject, the 9-action order lifecycle, genuinely real credit-limit enforcement, amendments) is real and well-engineered. But Sales' two most important physical-goods workflows terminate in module-local bookkeeping with no real downstream effect: `reserveSalesOrderLines` never touches Stock's actual `stock_reservations` table, and `completeFulfillmentRequest` never creates a `stock_movements` row. Sales returns (`createSalesReturnRequest`) are fully validated and idempotent but have zero consumer anywhere — no Accounting credit note, no Stock receipt, and no UI to trigger them at all. One confirmed dead UI control: the "Release from hold" button is permanently `disabled` with no `onClick` handler, even though the backing service function (`releaseOrderHold`) is fully implemented and routed. Backorders, make-to-order, drop-ship, recurring/subscription orders, exchange/refund, and marketplace/omnichannel are all confirmed entirely unmodeled. The Sales→Accounting invoice handoff, by contrast, is a genuine, validated cross-module integration (not just a link) — manual-pull rather than automatic, but real.

## 11. Procurement Findings

Estimated ~35% COMPLETE against its stated 79-feature baseline, but the module's actual business-logic maturity is materially stronger than Prompt 1's "weakest core module, generic CRUD dispatcher" framing suggested — see the architecture decision in Section 28. The core procure-to-pay spine (supplier lifecycle, requisitions, purchase orders with real amendment/rollback, receiving with over-receipt prevention, invoice matching with configurable tolerance and duplicate protection, and a genuinely sophisticated governance/control-tower dashboard) is solid, real, and independently tested. The RFQ/sourcing pipeline is the clearest gap: `awardSourcingEvent` is real, well-guarded backend logic reachable today only through a raw `window.prompt("Selected bid ID")` — bids and evaluations are never rendered in any UI at all. Two real cross-module gaps: receiving never updates Stock (`applyReceiptToOrder` has zero references to `stock_movements`/`stock_balances`), and the `inspectionAccepted` field checked by four-way invoice matching is never set by anything, so four-way matching mode is permanently broken. Budget checks, catalogue browsing, drop-ship, and a supplier portal are all confirmed absent.

## 12. Stock Findings

Estimated ~16% COMPLETE against its stated 90-feature baseline — the widest gap between "real code exists" and "usable feature" of any module reconciled. The item/UOM/warehouse/location foundation is genuinely well-typed (not jsonb), and the single real algorithm — moving-average cost recalculation with row-level locking — is correct. But it is bypassed by two other modules (see Section 23's cross-module bug), and there is no UI anywhere in the product to invoke a movement, adjustment, or transfer even though the backend routes exist. Lots, serials, and reservations are pure dead schema (zero INSERTs anywhere). FIFO is a selectable costing-method setting that silently still runs moving-average math. WMS operations (put-away, pick, pack, dispatch, cross-dock, kitting), planning (EOQ, demand, ATP/CTP, cycle count, ABC/XYZ), and landed cost are all entirely unmodeled.

## 13. Manufacturing Findings

Estimated ~8% COMPLETE against its stated 118-feature baseline — the largest historical module and the lowest completion estimate of the twelve. The BOM→work-order→release→start→production-posting pipeline is real, transactional, and idempotent, and its Stock integration is the strongest cross-module path found in any of the three "engineering" modules (Manufacturing/Projects/Assets) — though it inherits the Section 23 balance-desync bug. A genuinely serious, previously-undocumented active bug: no code anywhere ever transitions a work-order operation to `completed`, which makes the production-posting completion gate **permanently blocking** for any work order that has a routing attached. Routing/work-center management, MRP, and costing are all pure dead schema — real, well-designed tables with permissions granted (`manufacturing.routing.manage`, `manufacturing.planning.run`, `manufacturing.costing.view`) and zero backing implementation. Per the research pass's explicit judgment, MRP and capacity planning need ground-up domain foundation work, not incremental extension, while scrap/backflush/subcontracting are incremental additions to the existing, working posting transaction pattern.

## 14. Projects Findings

Estimated ~9% COMPLETE against its stated 86-feature baseline. Only 3 of the module's 8 exported service functions are creates at all (`createProject`, `createProjectTask`, `createTimeEntry`) — milestones, expenses, budgets, billing-milestones, procurement-links, and task dependencies all have full schema, granted permissions, and **zero write path**. The dashboard's own copy claims a "governed request into Sales and Accounting" billing capability that has no backing implementation whatsoever. The profitability calculation (`getProjectProfitability`) is genuinely correct math, but its expense and billed-revenue inputs are structurally unreachable since neither can be created through any code path today — a real, well-written calculation starved of real data. One orphaned-at-the-route-layer finding: `approveTimeEntry` is implemented and self-approval-blocked in the service but has zero routes anywhere in `apps/web`.

## 15. Assets Findings

Estimated ~14% COMPLETE against its stated 73-feature baseline. What exists (create, capitalize, assign, create/complete maintenance order, dispose) is the best-governed subset of any of the three "engineering" modules — capitalize and dispose both have genuine, tested self-approval blocks. But three of the module's named functional areas — transfers, inspections, and depreciation — have **zero write implementation at all**, not partial, despite complete schema, granted permissions, and (for transfers/inspections) worse than the prior audit's "read-only" characterization. `asset_maintenance_parts`, despite a real Stock FK, is the single most orphaned table found across the entire reconciliation — zero references anywhere in the codebase. Assets→Accounting is confirmed fully isolated: `disposeManagedAsset` never posts a GL entry despite a dedicated `assets.accounting.handoff` permission and dedicated FK columns that are permanently null.

## 16. POS Findings

Estimated ~22% COMPLETE against its stated 89-feature baseline. The transactional core — checkout, shift open/close, cash reconciliation, store/terminal setup — is real, atomic, and correctly locked. But the module's own checkout page literally instructs the user to "use the secured POS API" directly — there is no UI to ring up a sale at all, a finding severe enough to warrant a dedicated `UI_ONLY` classification distinct from the rest of the "real backend, no UI" pattern found elsewhere. Returns record intent but never actually reverse stock (`stock_movement_id` is never populated). No products/catalog layer, no promotions, no loyalty, no hardware/barcode integration, and no offline behavior exist. POS→Accounting is confirmed fully isolated — no journal entry is ever created on sale completion, contradicting the dashboard's own copy claiming "Accounting evidence stays aligned."

## 17. Quality Findings

Estimated ~19% COMPLETE against its stated 77-feature baseline. This module shows the clearest instance of a distinct, specific failure pattern: **real, working, even tested-quality code with zero route wiring.** `createCapa` is a real function that is never called from any route anywhere in `apps/web` — CAPA cannot be created through the product despite the logic existing. `quality_audits` has full schema and a dashboard link but literally no create function exists. The most consequential finding: quality holds are confirmed **pure advisory record-keeping** — zero references to `quality_hold` exist anywhere in Stock, Procurement, or Manufacturing, and there is no release function either. A held batch can still ship, receive, or be consumed; this is a P0-adjacent governance gap, not merely a missing feature.

## 18. Support Findings

Estimated ~25% COMPLETE against its stated 75-feature baseline. The ticket lifecycle state machine, SLA due-date computation, manual assignment, and — notably — the private-note field-level access control are all genuinely well-built and security-conscious. But escalation is confirmed to have **no creation function at all, manual or automatic** — a stronger finding than the prior audit's "auto-trigger not wired," since there is no trigger of any kind. SLA `pause_on_pending_customer`/`business_hours_only` flags are stored and read but never applied in the actual due-date math. CSAT's `satisfaction_score` column exists with a real CHECK constraint and is never read or written by any code. No customer portal, canned responses, or live channel integrations (email/chat) exist.

## 19. HR & Payroll Findings

Estimated ~9% COMPLETE against its stated 108-feature baseline — the largest module by feature count after Manufacturing, and the one carrying the single most severe correctness defect found in this entire reconciliation. The payroll calculation engine (`calculatePayrollRun`) hardcodes `deductions = 0` and `employer = 0` as literal values presented as computed results, applies none of the rich, well-designed salary-structure/statutory-rate schema that exists, and — critically — **there is no code path anywhere that lets an employee's compensation be assigned**, so `gross_pay` resolves to `0`/`null` for every real payroll run today. This must be fixed before any additional statutory feature (PF/ESI/PT/TDS calculation) is built on top of it, per the research pass's explicit judgment (Section 29). Leave request/approval is the one genuinely complete, well-governed workflow in the module (real self-approval block, real balance decrement). The Prompt 1-documented "dead sensitive-permission" finding is now **stale** — `hr_payroll.sensitive.view` was correctly fixed in Prompt 3's security hardening and is now genuinely enforced with test coverage. Payroll→Accounting GL posting remains confirmed missing (only an opaque caller-supplied string is stored).

## 20. Shared Platform Findings

Materially stronger than Prompt 1's original assessment across most categories, because Prompts 6–10 (not fully reflected in the calling program's background brief) closed most of the originally-identified gaps: command palette, Quick Create, favourites, recent records, My Work, Audit Logs, and Compliance are all now genuinely real and were confirmed unchanged/still-real in this pass. **Security & Governance is stronger than assumed**: Prompt 3's hardening pass, not fully summarized in this program's own background context, already fixed the three "dead" field-level permissions and added real CRM record-ownership scoping with a dedicated 290-line regression suite. Workflow & Automation, Reporting & Analytics, and Integration all show the same recurring pattern — **a real, honest management UI sitting on top of a missing worker/delivery process** (CRM automation's dead trigger types, webhook subscriptions with no delivery worker, telephony jobs with no processing worker, an outbox table that is written to and never drained) — this is the single highest-leverage shared blocker identified (Section 24). MFA remains schema-only with no enrollment flow, exactly as documented in Prompt 1. `workflow_definitions` remains confirmed dead schema. No soft-delete columns exist anywhere, which the codebase's own `/compliance/data-governance` page explicitly and correctly reframes as a deliberate status-based-lifecycle design choice rather than an oversight. Data Management/Governance shows a consistent "real but narrow" pattern: every import/export/bulk-update/duplicate-detection/retention capability genuinely works, none of them cover more than 2–6 of the 12 modules, and every workspace page says so honestly in its own copy.

## 21. Accounting Findings

Genuinely the strongest module in the repository: 33 of 43 assessed functional areas are COMPLETE, including a hard-enforced (twice — build-time and DB-re-verified at submit) double-entry engine, a real BigInt fixed-point decimal system used consistently, a genuinely correct bank-reconciliation matcher, a real probability-weighted cash-forecast engine, a real governed multi-task close-run process, and real FX/intercompany/consolidation logic. Test coverage, while still thin relative to 10,761 lines of business logic, has genuinely improved since Prompt 1 (3 real passing test files, up from effectively zero). Two concrete correctness bugs were found, not just gaps: `generateDepreciationSchedule` silently substitutes straight-line math when a user selects the valid, selectable `units_of_production` depreciation method — a real user-facing calculation error, not a missing feature; and tax-ledger-to-journal-line pairing relies on fragile array-index order rather than a stable key. Cross-module GL posting is confirmed real-but-manual for Sales and Procurement (a genuine, validated, idempotent request/import flow, just not automatic), and confirmed **fully isolated** for POS, HR & Payroll, and the separate operational Assets module — three real, currently-missing integrations, not aspirational ones. India-statutory GST handling is correctly done (versioned, DB-driven rates); TDS/TCS/e-invoice/e-way bill have real tracking scaffolding with zero actual government-portal integration behind them.

## 22. Cross-Module Journey Findings

Of the 10 critical end-to-end journeys specified by the calling program:

- **Tenant/security** (create org → assign user/role → company/branch scope → module entitlement → use module): **BROKEN** as of this reconciliation — the `crm.records.view_all` FK bug (Section 23) can abort the onboarding transaction itself for any new organization.
- **CRM → Sales** (Lead → Opportunity → Quotation): **fully working** — opportunity line items genuinely prefill quotation lines.
- **Sales fulfillment** (Quotation → Order → Stock/Fulfillment → Billing/Accounting): **partially broken** — order confirmation and invoicing work; the Stock leg does not (SALES-009/010).
- **Procurement** (Requisition → RFQ → PO → Receipt → Supplier invoice/accounting): **partially broken** — everything through invoice matching works; receiving never updates Stock (PROC-019); RFQ has no usable UI (PROC-010/012).
- **Manufacturing** (BOM → Production → Material issue → Finished stock → Cost): **partially broken** — production posting works and updates `stock_movements`, but never `stock_balances` (Section 23); costing is entirely unbuilt (MFG-014).
- **Support** (Ticket → assignment → SLA → resolution): **working at the backend**, **NOT_READY for UAT** — no UI exists to create a ticket at all.
- **HR/Payroll** (Employee → attendance/leave → payroll → payslip → accounting/statutory): **broken** — attendance can never be captured, compensation can never be assigned, payroll produces `0`/`null` gross pay, and there is no GL posting (Section 19).
- **Projects** (Project → task → time/expense → financial impact): **broken** — expenses and billing milestones have no write path at all; profitability math is correct but starved of real inputs.
- **POS** (Sale → payment → stock movement → accounting): **broken** — no checkout UI exists at all; stock deducts (with the Section 23 balance bug) but never posts to Accounting.
- **Quality** (Inspection → non-conformance → CAPA → release/closure): **broken** — CAPA logic exists but is unreachable; quality holds do not gate anything outside the Quality module.

**Fully working: 1 of 10. Partially working: 4 of 10. Broken: 5 of 10.**

## 23. Top Shared Blockers

Ranked by how many downstream features they unlock and how many modules depend on them:

1. **`crm.records.view_all` missing from the `permissions` table** — confirmed live P0, breaks new-org onboarding. Blocks: the CRM record-scoping feature entirely, and potentially all new-organization signups. Fix scope: one migration (Prompt 12).
2. **No worker/scheduler process anywhere** — blocks webhook delivery, CRM automation's 4 remaining trigger types, telephony job processing, outbox draining, escalation automation, notification digests, scheduled reports. Highest-leverage shared build in this plan (Prompts 13–16).
3. **Universal write-UI gap across 8 modules** — Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll, and most of Stock have real backend logic with zero product UI to invoke it. Single highest-leverage UX fix in the whole plan; unlocks dozens of otherwise-"COMPLETE (backend)" rows into real UAT-READY status (Prompts 17–19).
4. **Manufacturing/POS `stock_balances` desync bug** — confirmed live data-integrity defect affecting three modules at once (Prompt 12).
5. **Quality holds are advisory-only everywhere outside Quality** — a held batch can ship/receive/be consumed; affects Stock, Procurement, and Manufacturing (Prompt 65).
6. **No chart/visualization library anywhere in the dependency tree** — blocks any real dashboard/report visualization, cross-module BI, and KPI framework (Prompt 20).
7. **HR & Payroll's broken calculation core** — blocks every future statutory-calculation feature from producing a correct number (Prompt 70).
8. **No tenant API-key system / incomplete OAuth token exchange** — blocks the entire developer/integration surface (Prompt 21).
9. **Reports & Analytics real coverage is 4 of 12 modules** — blocks a genuinely unified reporting story (Prompt 98).
10. **Data Management/Governance real coverage is 2 of 12 modules** (CRM + master data) — blocks safe bulk operations everywhere else (Prompts 22, 85).

## 24. Top 25 Broken Journeys

1. New-org onboarding transaction (P0 live bug) — `crm.records.view_all` FK violation. **Prompt 12.**
2. Manufacturing production posting never updates `stock_balances`. **Prompt 12.**
3. POS sale completion never updates `stock_balances`. **Prompt 12.**
4. Payroll run always produces `0`/`null` gross pay (no compensation-assignment path). **Prompt 70.**
5. Manufacturing work-order operations can never reach `completed`, permanently blocking production posting on routed WOs. **Prompt 40.**
6. Quality CAPA — real function, zero route, unreachable. **Prompt 63.**
7. Quality holds don't gate Stock/Procurement/Manufacturing movement. **Prompt 65.**
8. POS checkout has no UI at all. **Prompt 57.**
9. Sales stock reservation never touches real Stock inventory. **Prompt 25.**
10. Sales fulfillment never creates a stock movement. **Prompt 26.**
11. Sales returns have zero consumer (no credit note, no stock receipt, no UI). **Prompt 27.**
12. Sales "Release from hold" button is permanently disabled with no handler. **Prompt 28.**
13. Procurement receiving never updates Stock. **Prompt 31.**
14. Procurement RFQ award reachable only via a raw `window.prompt()` for a bid UUID. **Prompt 29.**
15. Procurement four-way invoice matching permanently flags exceptions (`inspectionAccepted` never set). **Prompt 31.**
16. Projects milestones/expenses/budgets have zero write path despite full schema and granted permissions. **Prompts 48–50.**
17. Projects profitability math is correct but structurally starved of real expense/revenue inputs. **Prompt 51.**
18. Assets transfers/inspections have zero write implementation (worse than "read-only"). **Prompts 53–54.**
19. Assets disposal never posts to Accounting despite a dedicated permission and FK columns. **Prompt 55.**
20. Assets maintenance-parts consumption is completely orphaned despite a real Stock FK. **Prompt 56.**
21. POS returns record intent but never actually restock inventory. **Prompt 61.**
22. POS sales create zero Accounting GL postings. **Prompt 61 / 79.**
23. Support escalation has no creation function at all, manual or automatic. **Prompt 67.**
24. HR & Payroll attendance has zero capture mechanism despite being read by payroll calculation. **Prompt 72.**
25. HR & Payroll separation/offboarding never sets `separation_date`, despite a dashboard KPI counting it. **Prompt 75.**

## 25. Additional Implemented Capabilities

Real, working capabilities found in the current repository that do not map cleanly to any named category above:

- **CRM Conversation Intelligence consent/access-governance layer** — a dedicated, working consent-controlled recording-access gate (`api/crm/conversation-intelligence/recordings/{id}/access`) distinct from CRM's general privacy/retention system.
- **CRM partner/reseller engagement suite** — deal registration, MDF, incentives, and gamification/conflict-evaluation logic (`crm/partner-engagement.js`, 507 lines) — a genuinely deep capability not obviously implied by any of the 74-item baseline's likely named rows.
- **Accounting's governance/exception layer** — health scoring, saved views, exception-case workflow, and audit timelines across AR/AP/Banking/Tax (~4,400 lines) — deeper than a typical "reports" or "compliance" bucket would suggest.
- **CRM offline mobile sync with real conflict resolution** (`crm/offline-sync.js`).
- **Procurement's control-tower governance dashboard** (942 lines) — readiness/risk-band/blocker computation across the entire procure-to-pay chain.
- **The adversarial self-review practice documented in `ERP_SECURITY_HARDENING_003.md`** — not a product feature, but a real, evidenced engineering-process capability (it caught a real regression before shipping) that materially raises confidence in this reconciliation's own findings for the areas that pass already covered.

## 26. Dead/Unreachable Infrastructure

**Dead schema** (tables/columns with zero runtime consumer): `workflow_definitions` (control-plane); `manufacturing_planning_runs`, `manufacturing_material_requirements`, `manufacturing_cost_snapshots` (before Prompt 42–43); `stock_batches`, `stock_serials` (before Prompt 34); `project_milestones`, `project_budgets`, `project_expenses`, `project_billing_milestones`, `project_task_dependencies` (before Prompts 48–50); `asset_transfers`, `asset_inspections`, `asset_depreciation_schedules`/`asset_depreciation_runs` (before Prompts 53–55); `quality_supplier_records`, `quality_audits` (before Prompt 64/63); `support_escalations`, `support_tickets.satisfaction_score` (before Prompt 67/69); `hr_employee_compensation`, `hr_statutory_components` (before Prompt 70/71); `pos_sales.accounting_invoice_id`/`sales_order_id` (before Prompt 61/79); `stock_valuation_layers` (written, never read — before Prompt 38); `asset_maintenance_parts` (the single most orphaned table found, despite a real Stock FK — before Prompt 56).

**Implemented-but-unreachable** (real service function, zero route): `createCapa` (Quality); `approveTimeEntry` (Projects); `completeMaintenanceOrder` (Assets). These are the cheapest fixes in the entire execution plan — no new business logic needs to be written, only wiring.

**UI-without-backend**: `procurement/settings/page.tsx` renders six hardcoded "Governed" badges not backed by any query (cosmetically misleading, not a fake-data finding). POS's checkout page literally instructs the user to call the API directly rather than offering any control.

## 27. UAT Readiness

| Status | Count (estimated, against 1,039) |
|---|---:|
| READY | 189 |
| LIMITED | 221 |
| NOT_READY | 575 |
| BLOCKED | 54 |

The NOT_READY count is dominated by the universal write-UI gap (Section 23, #3) — a large share of what is genuinely COMPLETE at the backend level is NOT_READY for a normal tester today simply because no UI exists to reach it. Closing Prompts 17–19 (the write-UI framework) is expected to move a substantial share of NOT_READY rows to READY/LIMITED without any new business-logic work at all.

## 28. Module Priority Ranking

Ranked for Prompts 12–102 allocation, considering missing-feature volume, architectural weakness, business value, dependency position, cross-module importance, financial/security criticality, and migration risk — not simply by feature count:

1. **Shared blockers first** (scheduler, write-UI framework, reporting/integration foundations) — unlock the most downstream value per prompt.
2. **HR & Payroll payroll-correctness fix** — financial correctness takes priority over any other module's feature completion, per the calling program's own instruction to hold payroll/statutory logic to a higher standard than CRUD.
3. **Stock** — nearly every other physical-goods module (Sales, Procurement, Manufacturing, POS, Assets) depends on Stock actually working; currently the lowest-completion "core-adjacent" module.
4. **Manufacturing** — largest historical module, lowest completion estimate, but has the most valuable existing foundation (production-posting pipeline) to build on.
5. **Sales / Procurement** — both have strong cores; the highest-leverage fixes (Stock integration, RFQ UI) are narrow and high-value.
6. **POS / Quality / Support** — all three have the "real backend, no UI, disconnected functions" pattern; fixing is largely wiring, not new logic.
7. **Projects / Assets** — smallest write-surface gaps proportionally, but Assets→Accounting and Projects→Accounting/Sales integration work is genuinely valuable.
8. **CRM** — already the most mature; only narrow, well-defined gaps remain.
9. **Accounting** — already the strongest; targeted correctness fixes and cross-module GL wiring only, explicitly not a rebuild campaign (Section 21).

## 29. Procurement Architecture Decision

**KEEP AND EVOLVE.** The research pass's evidence-based conclusion, reversing the tone (though not fully the substance) of Prompt 1's "weakest core module" framing: nothing found in this reconciliation is blocked by the `data jsonb` storage model itself. Every gap identified (missing bid/evaluation UI, no Stock write-through on receiving, no budget checks, no drop-ship, the dead `inspectionAccepted` field) is missing *application logic or UI*, not a schema limitation — the generic document dispatcher already supports arbitrary typed validation and arbitrary promoted/FK-validated columns where a real relational need exists. Normalizing now would require re-implementing optimistic concurrency, idempotency, event logging, and outbox emission independently across 12+ resource types — exactly the kind of fragmentation that already caused the Section 23 Manufacturing/POS stock-balance bug when those modules built their own local copies of shared logic instead of reusing it. Migration risk is HIGH (a live audit-trail table's content-hash and event/outbox payloads are shaped around the jsonb representation) and backward-compatibility risk is HIGH, for a payoff (query performance, stricter typing) that isn't the actual bottleneck. Affected future prompts: none of 29–32 require normalization; all are additive business-logic/UI work on the current architecture.

## 30. Prompts 12–102 Allocation

See `docs/implementation/ERP_EXECUTION_PLAN_012_102.md` for the full 91-entry plan. Summary: 1 prompt of emergency P0 fixes (12), 10 prompts of shared-platform blockers (13–22), 54 prompts of module completion campaigns (23–76), 3 prompts of targeted Accounting fixes (77–79), 7 prompts closing remaining shared-platform gaps (80–86), and 16 prompts of final hardening/release reserve (87–102). Every prompt number 12–102 appears exactly once, validated programmatically by `scripts/validation/verify-feature-matrix.mjs`.

## 31. Production Readiness Matrix

| Area | Product complete? | Tested? | Production ready? | Main blocker |
|---|---|---|---|---|
| Platform (shared) | Mostly | Weak-Moderate | Not yet | No scheduler/worker; MFA schema-only; onboarding P0 bug |
| CRM | Mostly | Weak | Close | `records.view_all` fix; automation trigger completion |
| Sales | Partially | None | No | Stock/Accounting integration gaps; hold-release UI bug |
| Accounting | Mostly | Weak-Moderate | Close | 2 correctness bugs; 3 isolated integrations |
| Procurement | Partially | None | No | RFQ UI; Stock write-through |
| Stock | No | None | No | No write UI; balance-desync bug; core WMS/planning missing |
| Manufacturing | No | None | No | Operation-completion gate bug; MRP/costing/routing all dead schema |
| Projects | No | None | No | Milestones/expenses/budgets have zero write path |
| Assets | No | None | No | Transfers/inspections/depreciation have zero write path |
| POS | No | None | No | No checkout UI at all; no Accounting posting |
| Quality | No | None | No | CAPA/audits unreachable; holds don't gate anything |
| Support | No | None | No | No escalation engine; no ticket-creation UI |
| HR & Payroll | No | Weak | No | Payroll produces incorrect (zero) numbers; correctness fix required first |

## 32. Remaining Risks

**P0 (must fix before anything else, confirmed live):**
- `crm.records.view_all` missing from `permissions` table — breaks new-org onboarding (Section 23, item 1).
- Manufacturing/POS never update `stock_balances` — silent inventory data-integrity corruption (Section 23, item 2).
- HR & Payroll payroll calculation is confirmed incorrect (hardcoded zero deductions, unobtainable gross pay) — must not be extended with more statutory features until fixed (Section 19).

**P1 (core operational capability, high value, currently broken or unreachable):**
- Universal write-UI gap across 8 modules — most valuable single unlock in this plan.
- No worker/scheduler process anywhere — blocks webhook/telephony/outbox delivery and automation completion.
- Quality holds don't gate anything outside Quality.
- Manufacturing's operation-completion gate is permanently blocking on any routed work order.

**P2 (advanced/competitive functionality, real gaps but not launch-blocking):**
- MRP, routing/capacity, and costing engines in Manufacturing (ground-up domain work, not incremental).
- Report builder, scheduled reports, cross-module BI/charts — no chart library exists at all.
- SSO, tenant API keys, SMS/WhatsApp, e-commerce/marketplace connectors.
- POS catalog/promotions/loyalty/hardware/offline.

**P3 (optimization, advanced intelligence, rare enterprise edge):**
- Dark mode, verified accessibility/mobile-web audits.
- Advanced sourcing (multi-round/auction), landed cost, ABC/XYZ classification.
- Consolidation auto-elimination, UOP depreciation edge case, Manufacturing IoT/APS.
- Landing e2e Playwright instability (pre-existing since Prompt 4, unrelated to the ERP application, reserved for Prompt 88).

## 33. Verification

This prompt made **no product code changes** — only documentation/matrix/validation-script artifacts under `docs/implementation/` and `scripts/validation/`, per Part 82's explicit restriction. `pnpm verify` was re-run to confirm the existing Prompt 10 baseline is unaffected; results are reported exactly in the final response (see "Verification" section of the delivered Prompt 11 Result). The new validator script (`scripts/validation/verify-feature-matrix.mjs`) checks: valid status/UAT enums across both CSVs, every incomplete module row has a recommended prompt mapping, every prompt-cluster reference falls within 12–102, and the execution plan covers 12–102 exactly once with no gaps or duplicates — confirmed PASS.
