# ERP Exact Feature Reconciliation (Prompt 15 of 102)

Reconciliation date: 2026-08-11
Scope: exact, individually-numbered 1,039-feature historical baseline (945 module-specific across the original 11 modules + 94 shared platform), recovered externally and parsed deterministically, plus a separately-reconciled Accounting update. No product code was modified to produce this document — see Section 33.

## 1. Executive Summary

Prompt 11 could not find the exact, row-level 1,039-feature master register anywhere in the repository and, per its own governing fallback instruction, built a defensible 288-row functional-area matrix with an estimated extrapolation instead of fabricating named rows. That register has since been recovered externally (`vercentlabs-erp-feature-sidebar-handoff.md`, Appendix A) and copied verbatim into this repository at `docs/product/VERCENTLABS_ERP_EXACT_1039_MASTER_REGISTER.md`. Prompt 15 parses it deterministically (no manual transcription), classifies every one of its 1,039 individually-named requirements against the current repository, and rebuilds the remaining 87-prompt execution plan against exact requirement IDs instead of an estimate.

**The exact result is materially harsher than Prompt 11's estimate.** Prompt 11 estimated 26.0% of the 1,039 baseline COMPLETE (270 rows). The exact count is **12.8% COMPLETE (133 of 1,039)**. This is not a contradiction — Prompt 11's own estimate was explicitly labeled an estimate, built by proportionally extrapolating 288 coarse functional-area findings onto individual requirement counts. Splitting those functional areas into their real, individually-worded exact requirements exposes materially more partial credit than the coarse estimate could see: a functional area like CRM's "lead management" that Prompt 11 scored as mostly complete in fact contains 13 individually-worded requirements, several of which (round-robin/workload assignment strategies, email-to-lead conversion, pipeline velocity) are separately MISSING or PARTIAL once checked against their own exact wording rather than the category's overall impression.

Three previously-reported P0 findings remain confirmed and are reflected in the exact rows below: the `crm.records.view_all` permission-catalogue gap (fixed in Prompt 12), the Manufacturing/POS `stock_balances` desync (fixed in Prompt 12), and HR & Payroll's payroll-calculation defect (still open, independently re-verified line-by-line in this reconciliation with new specifics beyond Prompt 11's report — see Section 22). **Two new P0 financial-correctness findings were made in this reconciliation, not present in Prompt 11's report**: Stock's costing-method selector (FIFO/standard) has zero effect on the actual cost calculation, which always runs moving-average regardless (Section 15); and Procurement's goods-receipt approval never posts to Stock's ledger, a distinct cross-module gap from the Manufacturing/POS bug Prompt 12 already fixed (Section 14).

CRM remains the most mature module by a wide margin (50 of 74 exact requirements COMPLETE, 67.6%) and its Prompt 14 authorization-context fix is reflected across every affected exact row. Every other module sits materially lower once measured against individually-worded exact requirements rather than functional-area impressions — HR & Payroll, Quality, Assets, Projects, Manufacturing, and Support all show **zero** exact requirements fully COMPLETE.

## 2. Why Prompt 15 Was Required

Prompt 11's own Section 4 stated the fallback rule explicitly: "do not invent missing feature names... do NOT claim an exact 1,039-row reconciliation" when the source register cannot be found. That rule was followed correctly. Prompt 15's trigger is new information, not a correction of Prompt 11's judgment: the exact register exists, was located outside the repository (the user's local filesystem, not previously supplied), and is now durably preserved inside the repository so this class of gap cannot recur.

## 3. Recovered Source

Source file: `vercentlabs-erp-feature-sidebar-handoff.md`, Appendix A ("Exact original 1,039-feature master catalogue"). Canonical repository copy: `docs/product/VERCENTLABS_ERP_EXACT_1039_MASTER_REGISTER.md` — an exact, byte-for-byte copy (`diff` confirmed identical), not a paraphrase or re-transcription. The source's own "Validation totals" section states: "Numbered module entries: 945. Numbered shared-platform entries: 94. Validated overall total: 1039," and explicitly notes Accounting was not in the supplied 11-module list and must not be added to this total.

## 4. Counting Methodology

A deterministic parser (`scripts/validation/parse-exact-master-register.mjs`) extracts every requirement mechanically from the canonical document's own markdown structure (`## N. ModuleName — NNN features` module headers, `### Category — N` category headers, `- [ ] **N.** Feature text` checklist items for modules; `## Area — N features` continuous-numbered headers for the Shared section). No feature name, number, or count was manually transcribed. The parser self-validates against the source's own declared per-category and per-module counts and throws if any mismatch is found — it did not need to throw; every declared count matched exactly on the first parse.

## 5. Accounting Treatment

Accounting is never added to the 1,039 denominator anywhere in this document. Its own exact wording does not exist in the recovered source (only a sidebar navigation tree, not a numbered checklist, per the source's own Section 6) — it remains reconciled against `ERP_ACCOUNTING_MATRIX_015.csv`'s existing 43-functional-area structure (carried forward from Prompt 11, updated with fresh cross-module evidence — see Section 24), exactly as Prompt 11 established.

## 6. Exact 1,039 Validation

```
Historical rows: 1039
Module-specific: 945
Shared: 94
Accounting in historical matrix: 0
Duplicate IDs: 0
Invalid statuses: 0
Incomplete rows without primary_gap: 0
Incomplete rows without future-prompt mapping: 0
```

Every one of the 11 module counts and all 7 Shared-area counts matched the source's own declared tables exactly (CRM 74, Sales 76, Procurement 79, Stock 90, HR & Payroll 108, Support 75, Quality 77, POS 89, Assets 73, Projects 86, Manufacturing 118; SaaS platform 14, Security & governance 15, Workflow & automation 12, Reporting & analytics 13, Integration 13, UX 15, Data governance 12). See `scripts/validation/verify-exact-feature-matrix.mjs`'s PASS output for the full check list.

## 7. Classification Method

Seven parallel, evidence-based classification passes (CRM+Sales; Procurement+Stock; Manufacturing; HR & Payroll; Projects+Assets; POS+Quality; Support+Shared Platform), each required to inspect real routes, services, database migrations, permissions, and tests for every individually-assigned exact requirement — never to infer a status from a coarser Prompt 11 functional-area conclusion alone. Prompt 11's `ERP_FEATURE_MATRIX_011.csv` was used as a starting evidence index (grep by module prefix) in every pass, but each exact requirement's specific wording was independently re-verified; several Prompt 11 functional-area conclusions were split into multiple exact rows with different individual statuses once checked this way (worked examples in Section 27). Every pass was instructed, in identical terms, to apply this program's standing anti-fabrication rules: no "AI" claim without a genuine model/provider/inference pipeline (none exists anywhere in the monorepo's dependency tree — confirmed independently by every pass via `package.json` grep), no COMPLETE without genuine end-to-end usable behavior, no invented file paths.

## 8. Overall Exact Status

| Status | Count | Percentage |
|---|---:|---:|
| COMPLETE | 133 | 12.8% |
| PARTIAL | 241 | 23.2% |
| FOUNDATION_ONLY | 114 | 11.0% |
| UI_ONLY | 1 | 0.1% |
| MISSING | 548 | 52.7% |
| UNVERIFIED | 2 | 0.2% |
| **Total** | **1,039** | **100%** |

**Fully complete** (COMPLETE / 1,039) = **12.8%**. **At least partially implemented** ((COMPLETE + PARTIAL) / 1,039) = **36.0%**. These are never merged into one misleading figure, per this program's own standing instruction.

## 9. Exact UAT Status

| Status | Count | Percentage |
|---|---:|---:|
| READY | 124 | 11.9% |
| LIMITED | 149 | 14.3% |
| NOT_READY | 662 | 63.7% |
| BLOCKED | 104 | 10.0% |
| **Total** | **1,039** | **100%** |

## 10. Module Matrix

| Module | Total | Complete | Partial | Foundation | UI Only | Missing | Unverified | UAT Ready |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CRM | 74 | 50 | 8 | 8 | 0 | 8 | 0 | 47 |
| Sales | 76 | 27 | 9 | 4 | 0 | 36 | 0 | 27 |
| Procurement | 79 | 23 | 29 | 9 | 0 | 18 | 0 | 23 |
| Stock | 90 | 5 | 23 | 4 | 0 | 58 | 0 | 5 |
| HR & Payroll | 108 | 0 | 17 | 9 | 0 | 82 | 0 | 0 |
| Support | 75 | 2 | 18 | 7 | 0 | 48 | 0 | 0 |
| Quality | 77 | 0 | 17 | 22 | 1 | 37 | 0 | 0 |
| POS | 89 | 2 | 20 | 10 | 0 | 57 | 0 | 0 |
| Assets | 73 | 0 | 23 | 11 | 0 | 39 | 0 | 0 |
| Projects | 86 | 0 | 18 | 13 | 0 | 55 | 0 | 0 |
| Manufacturing | 118 | 0 | 16 | 16 | 0 | 86 | 0 | 0 |
| Shared | 94 | 24 | 33 | 1 | 0 | 24 | 2 | — |
| **Total** | **1,039** | **133** | **241** | **114** | **1** | **548** | **2** | — |

(UAT-Ready counts above are READY only; module-level LIMITED/NOT_READY/BLOCKED breakdowns are in each module's section below. Shared platform's UAT-Ready figure is folded into the overall total in Section 9 rather than repeated here, since Shared rows don't map to a single "team role" the way module rows do.)

## 11. Shared 94 Matrix

| Shared Area | Total | Complete | Partial | Foundation | Missing | Unverified |
|---|---:|---:|---:|---:|---:|---:|
| SaaS platform | 14 | 7 | 5 | 0 | 1 | 1 |
| Security and governance | 15 | 6 | 5 | 1 | 2 | 1 |
| Workflow and automation | 12 | 0 | 9 | 0 | 3 | 0 |
| Reporting and analytics | 13 | 1 | 4 | 0 | 8 | 0 |
| Integration | 13 | 1 | 6 | 0 | 6 | 0 |
| User experience | 15 | 5 | 8 | 0 | 2 | 0 |
| Data governance | 12 | 4 | 6 | 0 | 2 | 0 |
| **Total** | **94** | **24** | **43** | **1** | **24** | **2** |

Materially stronger than any other module-scale group in this reconciliation (25.5% COMPLETE, highest of any group except itself is compared against modules, not fair to compare directly, but notably close to CRM's rate) — direct evidence of Prompts 3–14's real, cumulative shared-platform investment (security hardening, canonical authorization, module enforcement, navigation, command palette/search, shared workspace, governance, administration, the P0 permission-catalogue fix, the worker/scheduler/webhook-delivery foundation, and the CRM authorization-context fix all land here).

## 12. CRM

67.6% COMPLETE (50/74) — unchanged in kind from Prompt 11's ~78% estimate but recalibrated downward against exact wording, still by far the strongest module. All of accounts/contacts, opportunity/pipeline, forecasting, most activities, campaigns, communications, conversation intelligence, customer success, privacy/consent, and 14 real report types are genuinely COMPLETE with typed schema, real state machines, and — since Prompt 14 — genuinely working elevated-visibility record scoping. Real findings from splitting Prompt 11's category-level view into exact requirements: **CRM-017** (lead assignment "by territory, product, workload or round-robin") is PARTIAL — only `fixed` and `round_robin` modes are implemented, `territory` silently no-ops and `workload` balancing doesn't exist. **CRM-050** (automated follow-up sequences) is FOUNDATION_ONLY — real schema/CRUD exists but no worker anywhere advances `next_run_at`. **CRM-049** (drip campaigns) is PARTIAL — `processMarketingCampaignRun()` marks deliveries sent/delivered without ever calling a real channel provider. Every literally "AI"-labeled item (065–067, 069, 071) is FOUNDATION_ONLY — confirmed deterministic/template-fill code with no model SDK anywhere, never COMPLETE regardless of sophistication. CRM-070 (conversation intelligence) is a genuine COMPLETE-but-BLOCKED case: the code is real and code-complete, but testing requires a live telephony/transcription provider this environment doesn't have.

## 13. Sales

35.5% COMPLETE (27/76). The quote-to-order-to-invoice-request core (real credit-limit enforcement — the module's sole P0, SALES-032, COMPLETE) remains solid. Confirmed unchanged from Prompt 11 and independently re-verified: zero product-variant, bundle/kit, contract, commission, delivery-note, shipment-tracking, or revenue-recognition modeling exists anywhere in the schema; Sales-Stock integration is completely absent at every touchpoint (availability checking, reservation, fulfillment all stay Sales-local); SALES-043's "Release from hold" UI control remains a confirmed dead button (`disabled`, no handler) despite a fully-implemented backing service function. SALES-024 (electronic acceptance) and SALES-025 (e-signature) are correctly split: the former is real and COMPLETE, the latter (a DocuSign-class provider) is MISSING.

## 14. Procurement

29.1% COMPLETE (23/79) — Prompt 11's "KEEP AND EVOLVE" architecture conclusion holds; nothing found in this pass is blocked by the `jsonb` document-dispatcher model itself. The procure-to-pay spine (PO/requisition/matching/AP-integration) is genuinely solid, contributing 8 of the module's 15 P0-priority rows as COMPLETE (supplier tax/banking info, invoice recording, two/three-way matching, variance handling, duplicate detection, AP integration). **New P0 finding, not in Prompt 11's report**: PROC-047 (goods receipt notes) is PARTIAL, P0 — approving a GRN never posts to Stock's `stock_movements`/`stock_balances`, a real cross-module data-integrity gap distinct from the Manufacturing/POS bug Prompt 12 fixed (Procurement receiving was never part of that fix's scope). PROC-053 (quality inspection integration in four-way matching) is confirmed dead logic — `inspectionAccepted` is read but never assigned by anything, so four-way matching permanently flags an exception. PROC-031/032 (sourcing award/RFQ-to-PO) downgraded to PARTIAL — the backend is sophisticated and correct, the only UI trigger is a raw `window.prompt()`.

## 15. Stock

5.6% COMPLETE (5/90) — the widest gap between "real code exists" and "usable feature" of any module, matching Prompt 11's directional finding but with a materially lower exact rate once measured requirement-by-requirement. The core transactional engine (`postStockMovement`, transfers, and the new Prompt-12 `diagnoseStockBalanceDrift` diagnostic) is genuinely correct and tested. **New P0 finding, not in Prompt 11's report**: STOCK-011/063/065 — selecting FIFO or standard costing on an item has zero effect on the actual cost calculation; `postStockMovement()` always computes moving-average regardless, a real financial-correctness bug independent of and distinct from the Prompt 12 balance-desync fix. Lot/serial/batch tracking (STOCK-005/006/007) is FOUNDATION_ONLY — tables exist, nothing ever inserts a row. No UI exists anywhere to directly invoke a movement, transfer, or adjustment (STOCK-021/022, both P0 given their role as the write-UI framework's chosen anchor features in Prompt 19). Zero COGS/GL integration into Accounting exists (STOCK-071, P0).

## 16. Manufacturing

0.0% COMPLETE (0/118) — the largest historical module and the only one, alongside HR & Payroll, Quality, Assets, Projects, and Support, with zero exact requirements reaching genuine end-to-end COMPLETE status. The BOM→work-order→material-issue→finished-goods pipeline is real, transactional, and (since Prompt 12) correctly posts to Stock's canonical ledger — but Prompt 12 fixed exactly that one posting step, not the surrounding planning/routing/costing surface, and this reconciliation independently confirms that caution was warranted: routing/work-center management (MFG-009–012), MRP (MFG-019–023), and the entire Costing category (MFG-083–094) are pure dead schema — real, permission-gated tables with zero backing implementation. MFG-001 (bills of materials) is FOUNDATION_ONLY, not PARTIAL — `createBillOfMaterial` is real and transactional but reachable only via direct API call, no product UI exists (this is why STOCK/MFG anchor features were chosen for the Prompt 19 write-UI framework). Advanced (MFG-108–118: APS/MES/IoT/AI/digital-twin/computer-vision/energy-monitoring/Kanban) is uniformly MISSING — no hardware/model/protocol integration exists anywhere.

## 17. Projects

0.0% COMPLETE (0/86). Only a handful of exported service functions are genuine creates (`createProject`, `createProjectTask`, `createTimeEntry`); milestones, expenses, budgets, billing-milestones, and task dependencies all have full schema, granted permissions, and zero write path — consistent with, and independently re-confirmed beyond, Prompt 11's finding. The profitability calculation (`getProjectProfitability`) is genuinely correct math but structurally starved of real inputs, since neither its expense nor billed-revenue inputs can be created through any code path.

## 18. Assets

0.0% COMPLETE (0/73). The best-governed subset of the three "engineering" modules (capitalize/dispose both have genuine, tested self-approval blocks), but transfers, inspections, and depreciation have zero write implementation despite complete schema. ASSET-028 (general-ledger integration) is confirmed MISSING, P0 — no GL-posting integration exists between Assets and Accounting for either disposals or depreciation, matching Prompt 11's finding that this is a real, currently-missing integration, not an aspirational one. Distinguished carefully per this prompt's own instruction: Assets-module depreciation (ASSET-016–023) is its own separate, currently-thin implementation, NOT credited from Accounting's own, materially stronger fixed-assets subsystem (ACC-017/035) — the two are architecturally separate systems that happen to share vocabulary.

## 19. POS

2.2% COMPLETE (2/89) — the two COMPLETE rows are both directly attributable to Prompt 12's real fix (automatic stock deduction and serial/lot tracking through checkout, POS-044/045), covered by real tests. Everything else in the module remains overwhelmingly MISSING/PARTIAL: no checkout UI exists (confirmed again — POS-001 is the module's own chosen write-UI-framework anchor in Prompt 19), no payment gateway is wired to any POS payment method (card/UPI/wallet are recorded as "captured" with no real processor call — Razorpay exists only for subscription billing, never referenced from POS code), no loyalty/promotions/hardware/offline support exists. Per this prompt's own explicit caution, the Prompt 12 backend fix was not allowed to inflate any unrelated POS row — it affected exactly the two rows it directly touches.

## 20. Quality

0.0% COMPLETE (0/77). **The most consequential cross-module finding in this entire reconciliation, independently re-confirmed**: quality holds are genuinely, automatically created on inspection failure (`completeInspection`, real, governed by `quality_settings.auto_hold_on_failure`) but zero references to `quality_hold` exist anywhere in Stock's, Procurement's, or Manufacturing's own posting/receiving/issue code — a held batch/serial/item can still be issued, received, or consumed by any other module. No release-hold function exists either. This is fixed once, centrally, in Prompt 16 rather than separately in three modules. CAPA (`createCapa`) remains a real, fully-implemented function with zero route wiring — unreachable from the product, confirmed unchanged from Prompt 11.

## 21. Support

2.7% COMPLETE (2/75) — the two COMPLETE rows are both SLA due-date computation (response/resolution). Every write operation (create ticket, assign, transition, add communication, create queue/SLA-policy/KB article) has a real, correct backend service and API route, but zero UI ever calls any of it — confirmed unchanged from Prompt 11, and the primary driver of this module's PARTIAL-heavy distribution (18 PARTIAL, blocker_type `MISSING_UI`) rather than outright MISSING. Escalation has no creation function at all, manual or automatic — dead schema, confirmed unchanged.

## 22. HR & Payroll

0.0% COMPLETE (0/108) — zero exact requirements reached genuine COMPLETE status, the most severe result of any module. Independently re-verified line-by-line (`services/api/src/hr-payroll/index.js`, `calculatePayrollRun`, lines 405-406): `deductions = 0` and `employer = 0` are literal hardcoded constants, not computed values, on every run. `hr_salary_structures`/`hr_salary_components` (a rich, well-designed fixed/percentage/formula/statutory schema) are never queried by the calculation engine at all. **New findings beyond Prompt 11's report**: the proration formula does not account for mid-period joining/separation dates at all (HR-045, P0); `overtime_minutes` is aggregated and stored but never priced into any earning line, a dead metric (HR-033); the payroll "post to Accounting" transition stores only an opaque caller-supplied string with zero real journal-entry creation (HR-055, P0); no test file anywhere tests `calculatePayrollRun`'s actual math. All 27 Payroll + India-statutory exact requirements (HR-042 through HR-068) are `uat_status: NOT_READY` regardless of individual status level, per this prompt's own explicit financial-correctness caution. HR-039 (leave approval workflow), the one item Prompt 11 called COMPLETE/READY, was downgraded to PARTIAL/LIMITED after independently confirming no UI anywhere renders a leave-request form or an approve/reject control — the backend is real and genuinely self-approval-blocked, but nothing in the product can trigger it.

## 23. Shared Platform

25.5% COMPLETE (24/94) — see Section 11 for the full breakdown. Materially strengthened since Prompt 11 by direct evidence of this program's own recent work: the Prompt 13 worker/scheduler moved scheduled automation (SHARED-035) and webhooks (SHARED-038/056) from Prompt 11's MISSING to PARTIAL — real, tested, SSRF-hardened, but narrow (one CRM workload, no signing, a documented multi-subscription fan-out limitation). Record-level access (SHARED-016/086) is explicitly flagged PARTIAL with the Prompt-14-discovered nuance preserved: CRM's `crmContext()` propagation bug is fixed and live-verified, but whether any other module's own context-construction function shares the same class of defect remains an open, unaudited question — carried forward as Prompt 23's explicit audit task rather than asserted either way. Confirmed absent via direct grep, not merely cited: SSO, IP restrictions, any chart/pivot/BI library, OpenAPI docs, a custom report builder, scheduled reports, dark mode, in-product help, tenant API keys, and shipping/e-commerce integrations.

## 24. Accounting Separate

Reconciled independently in `ERP_ACCOUNTING_MATRIX_015.csv` — never added to the 1,039 denominator anywhere in this document.

| Status | Count |
|---|---:|
| COMPLETE | 33 |
| PARTIAL | 4 |
| FOUNDATION_ONLY | 3 |
| UI_ONLY | 0 |
| MISSING | 3 |
| UNVERIFIED | 0 |
| **Total** | **43** |

Unchanged in substance from Prompt 11 (76.7% COMPLETE — genuinely the strongest module-scale group in the repository). Cross-checked against Prompts 12–14 for adjacent-evidence changes and found materially unaffected: `services/api/src/point-of-sale/index.js` and `services/api/src/manufacturing/index.js` were both re-grepped for any journal/ledger/GL/accounting reference in this reconciliation and returned zero hits, confirming ACC-041 (POS→Accounting) remains genuinely MISSING and that Prompt 12's stock-posting fix added no accounting-adjacent capability. ACC-036/037 (Sales/Procurement→Accounting) are re-annotated to note that the Prompt 13 worker foundation now exists and could be extended to auto-drain these two already-real, already-idempotent request queues — a real, low-risk future addition (Prompt 85), not something Prompt 13 did by itself (it was out of that prompt's declared scope).

## 25. Cross-Module Journeys

Re-evaluated using exact requirement IDs, updating Prompt 11's 10-journey assessment:

- **Tenant/security** (create org → assign role → module entitlement → use module): **FIXED, now WORKING** — the `crm.records.view_all` FK bug (Prompt 12) and the CRM context-propagation bug (Prompt 14) are both closed; SHARED-015/019/020/025 (RBAC/maker-checker/SoD/audit) are COMPLETE.
- **CRM → Sales** (Lead → Opportunity → Quotation): **fully working**, unchanged — CRM-021 (lead conversion), Sales' quotation core are COMPLETE.
- **Sales fulfillment** (Quotation → Order → Stock/Fulfillment → Billing/Accounting): **still partially broken** — SALES-030/031/034/045 (availability/reservation/fulfillment) remain PARTIAL/MISSING; the Stock leg genuinely does not exist.
- **Procurement** (Requisition → RFQ → PO → Receipt → Supplier invoice/accounting): **still partially broken, with a newly-precise cause** — everything through invoice matching works (PROC-055–060 mostly COMPLETE); PROC-047 (goods receipt) is now precisely identified as PARTIAL/P0 for never updating Stock; RFQ (PROC-025–032) remains PARTIAL, UI-blocked.
- **Manufacturing** (BOM → Production → Material issue → Finished stock → Cost): **still partially broken** — material-issue/finished-goods posting works and correctly updates `stock_balances` (Prompt 12); the entire Costing category (MFG-083–094) is confirmed dead schema, not merely thin.
- **Support** (Ticket → assignment → SLA → resolution): **still working at the backend, NOT_READY for UAT** — unchanged, no UI exists to create a ticket.
- **HR/Payroll** (Employee → attendance/leave → payroll → payslip → accounting/statutory): **still broken, with new specific detail** — attendance can never be captured (HR-031, P0), compensation can never be assigned (HR-042, P0), payroll produces `0`/`null` gross pay (HR-043, P0), no GL posting occurs (HR-055/ACC-042, P0).
- **Projects** (Project → task → time/expense → financial impact): **still broken**, unchanged — expenses and billing milestones have no write path.
- **POS** (Sale → payment → stock movement → accounting): **partially fixed** — stock deduction now genuinely works and is correctly tested (Prompt 12); no checkout UI still exists; no Accounting posting still exists (ACC-041).
- **Quality** (Inspection → non-conformance → CAPA → release/closure): **still broken, now precisely characterized** — CAPA logic exists but is unreachable (unchanged); quality holds are confirmed to genuinely record but never enforce anything outside Quality itself (QUAL-023–030/075, the subject of Prompt 16).

**Fully working: 2 of 10** (Tenant/security newly fixed; CRM→Sales unchanged). **Partially working: 4 of 10. Broken: 4 of 10.** Improved from Prompt 11's "1 fully working / 4 partial / 5 broken" by the confirmed closure of the tenant/security journey.

## 26. Top Shared Blockers

Recomputed from scratch against exact evidence — Prompt 11's list is not reused blindly. Closed items removed entirely (not listed as "closed" — simply absent, since they no longer block anything):

1. **Quality holds are advisory-only everywhere outside Quality** — confirmed independently in this pass, affects Stock, Procurement, and Manufacturing simultaneously (Prompt 16).
2. **HR & Payroll's calculation core is fundamentally broken** — hardcoded zero deductions/employer contributions, unobtainable compensation, broken proration; blocks every downstream statutory feature (Prompt 17).
3. **Stock's costing-method selector has no effect on actual cost calculation** — a new P0 financial-correctness finding, affects every module that reads Stock's valuation (Prompt 18).
4. **Universal write-UI gap, now affecting more exact requirements than Prompt 11 could see** — eight modules, real backend, zero UI; the single highest-leverage unlock in this plan (Prompt 19).
5. **No chart/visualization library anywhere in the dependency tree** — confirmed still true, blocks any real dashboard/report visualization (Prompt 20).
6. **No tenant API-key system / incomplete OAuth token exchange** — confirmed still true, blocks the developer/integration surface (Prompt 21).
7. **Record-level access remains CRM-only** — every other module is company/branch scope only; whether other modules share CRM's Prompt-14-class context bug is an open, unaudited question (Prompt 23).
8. **Procurement goods-receipt never updates Stock** — a newly-precise, distinct cross-module gap from the Manufacturing/POS bug Prompt 12 already closed (Prompt 32).
9. **Manufacturing's Costing category is entirely dead schema** — zero backing implementation for standard/actual cost, labour/machine overhead, cost roll-up, or variance (Prompts 45–46).
10. **POS has no real payment-gateway integration for any payment method** — card/UPI/wallet are recorded, never processed (Prompt 60).
11. **Reports & Analytics real coverage remains narrow** — 1 COMPLETE of 13 Shared reporting rows; most modules have no real reporting beyond generic list/export (Prompt 98).
12. **Data Management/Governance real coverage remains CRM-only** — duplicate detection, archiving, ownership, and master-data approval are all real but scoped to one module (Prompt 22).
13. **MFA remains schema-only** — no enrollment flow exists, unchanged since Prompt 1 (Prompt 23).
14. **Worker module-gating gap remains open by design** — background jobs still don't check module enablement before running, deliberately deferred again per Part 34 (Prompt 99).
15. **Webhook signing and multi-subscription fan-out remain open by design** — deliberately deferred again per Part 66 (Prompt 99).

Closed since Prompt 11 (confirmed, not re-listed above): the `crm.records.view_all` onboarding-breaking permission gap (Prompt 12); the Manufacturing/POS `stock_balances` desync (Prompt 12); the complete absence of any worker/scheduler process (Prompt 13); the CRM `crmContext()` permission/roleSlug propagation defect (Prompt 14).

## 27. Prompt 11 Estimate vs Exact Result

**What changed because the exact register was recovered:**

- **Largest downward revision**: overall COMPLETE moved from Prompt 11's estimated 26.0% to the exact 12.8% — not because anything regressed, but because Prompt 11's proportional-extrapolation method could not see requirement-level partial credit the way exact classification can. A functional area Prompt 11 scored as "mostly complete" (e.g., CRM lead management) in fact bundles 13 individually-worded requirements with materially different individual statuses.
- **Requirements Prompt 11 bundled too broadly**: CRM-017 ("lead assignment by territory, product, workload or round-robin") — Prompt 11's coarser "lead assignment exists" finding did not distinguish which of the four named strategies actually work (only 2 of 4 do). MFG-001 ("bills of materials") — Prompt 11's functional-area view did not separately flag that the real, working BOM-creation service function has zero UI wiring, a FOUNDATION_ONLY-defining fact only visible once the exact wording ("Bills of materials" as a complete, usable capability) is tested against actual reachability.
- **Requirements Prompt 11 overstated**: HR-039 (leave approval) was Prompt 11's one COMPLETE/READY row in HR & Payroll; independently re-verified in this pass and downgraded to PARTIAL/LIMITED — no UI anywhere can trigger the real, correctly-implemented backend.
- **Requirements Prompt 11 understated or missed entirely**: the Stock costing-method bug (Section 15) and Procurement's goods-receipt-never-updates-Stock gap (Section 14) are both new P0 findings not present in Prompt 11's report at all — found only because exact-requirement-level classification forced a fresh, individual re-check of every claim rather than reusing a coarser prior conclusion.
- **Priority changes**: HR & Payroll's payroll-correctness defect and Quality's hold-enforcement gap both remain P0/P1 as Prompt 11 assessed; two NEW P0 items (Stock costing, Procurement GRN) were added that Prompt 11's estimate could not surface.
- **Roadmap changes**: the execution plan is completely rebuilt against exact IDs (Section 29) rather than adjusted from Prompt 11's plan, because the underlying unit of work (an exact requirement) did not exist as a schedulable unit in Prompt 11's plan at all.

## 28. Prompts 12–14 Impact

- **Prompt 12 exact rows affected**: the `crm.records.view_all` fix is reflected across every CRM record-ownership-adjacent exact row (already correctly scoped pre-Prompt-14 for restricted users; Prompt 14 completed the elevated-visibility half). The Manufacturing/POS stock-posting fix is reflected in exactly the rows it touches — MFG material-issue/finished-goods-receipt posting correctness, POS-044/045 (both COMPLETE) — and was explicitly NOT allowed to inflate any other Manufacturing or POS row, per this prompt's own caution, independently honored by both classification passes.
- **Prompt 13 exact rows affected**: SHARED-035 (scheduled automation) and SHARED-038/056 (webhooks) moved from Prompt 11's MISSING to PARTIAL. CRM-050 (automated follow-up sequences) remains FOUNDATION_ONLY, not upgraded, because the worker drains a different workload (activity.overdue automation) than sequence enrollment's `next_run_at` advancement — a precise, evidence-based distinction Prompt 11 could not have made.
- **Prompt 14 exact rows affected**: every CRM record-ownership/elevated-visibility exact requirement now correctly reflects genuinely-working manager/owner visibility, live-database-verified. SHARED-016/086 (record-level access) carries forward Prompt 14's own honest caveat that other modules were not audited for the same defect class.

## 29. Prompts 16–102 Allocation

See `docs/implementation/ERP_EXECUTION_PLAN_016_102.md` for the full 87-entry plan. Summary: 8 prompts of shared-platform blockers (16–23, sequenced first because they unlock or de-risk the module campaigns that follow — quality-hold enforcement, payroll correctness, stock costing correctness, and the write-UI framework specifically precede or run alongside the modules they most affect), 61 prompts of module completion campaigns (24–84, sequenced CRM→Sales→Procurement→Stock→Manufacturing→Projects→Assets→POS→Quality→Support→HR & Payroll→Shared-remaining, roughly most-mature-first then largest-gap/highest-dependency modules), 2 prompts of targeted Accounting fixes (85–86), and 16 prompts of final hardening/release reserve (87–102). Every prompt number 16–102 appears exactly once, and every one of the 906 incomplete exact rows plus the 10 incomplete Accounting rows maps to exactly one prompt — both validated programmatically.

## 30. UAT Readiness

124 requirements are READY for normal team UAT today (11.9% of 1,039) — dominated by CRM (47 of the 124) and Procurement (23). A further 149 are LIMITED (a meaningful subset testable with a stated caveat). The remaining 787 (662 NOT_READY + 104 BLOCKED, together 75.7% of the baseline) cannot be meaningfully tested by a normal team member today — the majority of that gap, as in Prompt 11's finding, is the universal write-UI problem: real, correct backend logic that simply has no product surface to reach it. `ERP_TEAM_UAT_SCOPE_015.md` lists every READY/LIMITED exact requirement individually, replacing Prompt 11's estimated scope document.

## 31. Production Readiness

CRM and Accounting are the only two module-scale groups close to production-ready on their own (67.6% and 76.7% exact-COMPLETE respectively), consistent with Prompt 11's assessment. Shared platform, while not customer-facing on its own, is materially strengthened and no longer carries a P0-severity onboarding-breaking bug. Every other module remains genuinely far from production-ready by exact count — most critically HR & Payroll, whose payroll-calculation defect (Section 22) must not be allowed to process real compensation for real employees until Prompt 17 closes it.

## 32. Remaining Risks

**P0 (39 exact rows, must-fix financial/data/security correctness):**
- HR & Payroll's payroll calculation is confirmed incorrect at the source-code level (hardcoded zero deductions/employer contributions, unobtainable compensation, broken proration, no real GL posting) — the single most severe finding in this reconciliation, unchanged in severity from Prompt 11 but now with additional specifics. Must not be extended with more statutory features (Prompt 78) until Prompt 17 closes it.
- Stock's costing-method selector (FIFO/standard) has zero effect on the actual calculation — a new finding, real financial-correctness risk for any organization relying on a non-moving-average valuation method today.
- Procurement's goods-receipt approval never updates Stock's ledger — a new, distinct cross-module data-integrity gap from the already-fixed Manufacturing/POS bug.
- Quality holds do not gate Stock/Procurement/Manufacturing movement — a held batch can still ship, receive, or be consumed; re-confirmed independently, unchanged in severity from Prompt 11's P1 assessment but arguably P0-adjacent given the compliance/safety implication for regulated goods.

**P1 (core operational capability, high value, currently broken or unreachable):**
- Universal write-UI gap across 8 modules — the most valuable single unlock in this plan, now backed by an exact count (906 incomplete rows, a large share MISSING_UI specifically) rather than an estimate.
- Record-level access remains CRM-only, and whether the Prompt-14-class context-propagation bug exists unaudited in other modules is an explicitly open question (Prompt 23).
- Manufacturing's entire Costing category is dead schema — no standard/actual cost, overhead, roll-up, or variance calculation exists.
- Reports & Analytics and Data Management/Governance both remain narrow (1/13 and CRM-only respectively).

**P2 (advanced/competitive functionality, real gaps but not launch-blocking):**
- MRP, routing/capacity planning in Manufacturing (ground-up domain work).
- Report builder, scheduled reports, cross-module BI/charts — still no chart library exists at all.
- SSO, tenant API keys, WhatsApp/SMS, e-commerce/marketplace connectors.
- POS payment-gateway integration, catalog/promotions/loyalty/hardware/offline.

**P3 (optimization, advanced intelligence, rare enterprise edge):**
- Every literally "AI"-labeled requirement across all 12 modules (confirmed: zero AI/ML SDK dependency exists anywhere in the monorepo) — 162 P3-priority rows total.
- Landing e2e Playwright instability (pre-existing, unrelated to the ERP application, reserved for Prompt 92).
- IoT/RFID/digital-twin/computer-vision items across Stock, Manufacturing, Assets, and Quality.

## 33. Verification

This prompt made no product code changes — only documentation, matrix, and validation-script artifacts under `docs/product/`, `docs/implementation/`, and `scripts/validation/`. `pnpm verify` was re-run to confirm the existing Prompt 14 baseline is unaffected (see the final response's "Verification" section for the exact PASS/FAIL result of this run). `scripts/validation/verify-exact-feature-matrix.mjs` checks: exactly 1,039 rows; exact module and Shared-area counts matching the source; zero Accounting rows in the historical matrix; zero duplicate IDs; valid status/UAT/priority enums on every row; every incomplete row has a `primary_gap` and a `recommended_prompt` in range 16–102; and exact source order is preserved via a monotonic, gap-free `historical_index`. Confirmed PASS on the final run — see the delivered Prompt 15 Result's Verification section.
