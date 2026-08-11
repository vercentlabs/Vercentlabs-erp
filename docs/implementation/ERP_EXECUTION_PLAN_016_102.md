# Vercentlabs ERP — Execution Plan, Prompts 16–102

Rebuilt from scratch by Prompt 15's exact reconciliation (`ERP_EXACT_FEATURE_RECONCILIATION_015.md`), replacing Prompt 11's estimated `ERP_EXECUTION_PLAN_012_102.md` for everything from Prompt 16 onward. Allocates the 87 remaining prompts against the **exact** 906 incomplete rows of the 1,039-feature historical register (`ERP_EXACT_FEATURE_MATRIX_015.csv`) plus the 10 incomplete Accounting rows (`ERP_ACCOUNTING_MATRIX_015.csv`, separate scope). Every prompt number 16–102 appears exactly once and every incomplete exact feature maps to exactly one prompt — both validated programmatically by `scripts/validation/verify-exact-feature-matrix.mjs` and the assignment-generation script's own internal checks (`scripts/validation/.generated/build-prompt-assignments.mjs`).

No product implementation occurred in Prompt 15; this is a plan only.

## Why this plan differs from Prompt 11's

Prompt 11 planned Prompts 12–102 against an **estimated** distribution over 288 evidence-backed functional areas, extrapolated onto the 1,039 baseline. Prompts 12–14 then executed real work (P0 fixes, the worker/scheduler, CRM auth-context correctness) that closed several of Prompt 11's top blockers. Prompt 15 recovered the exact, individually-numbered 1,039-feature register and re-classified every single row against current code — producing a materially different, more granular picture (906 incomplete exact rows, not an estimated percentage). This plan is built directly from that exact data, not adjusted from Prompt 11's plan.

## Structure

- **Prompts 16–23** (8): shared/cross-cutting blockers — closed first because they unlock or de-risk many module-specific prompts that follow (Part 41).
- **Prompts 24–84** (61): module completion campaigns, one module at a time, in the priority order justified in `ERP_EXACT_FEATURE_RECONCILIATION_015.md` Section 29 (roughly: highest-value/most-blocking first, largest-module-with-most-existing-foundation next, smaller-gap modules last).
- **Prompts 85–86** (2): targeted Accounting fixes (Accounting's 10 incomplete functional areas — separate from the 1,039 denominator throughout).
- **Prompts 87–102** (16): hardening/release reserve — cross-module E2E, security, performance, accessibility, observability, backup/DR, migration safety, and final reconciliation (Part 43).

## Summary table

| Prompt range | Area | Feature count | Primary goal |
|---|---|---:|---|
| 16 | Shared hardening: UI/UX, design-system, responsive-web, and accessibility overhaul (Landing + ERP Web) | — (not an exact-feature-matrix prompt — see `ERP_UI_UX_BUG_REGISTER_016.csv` and `ERP_UI_UX_RESPONSIVE_016.md`) | Systematic product-design correction, not cosmetic: real bug register (44 findings, 26 fixed/18 deferred-with-reason), a P0 topbar/context-switcher horizontal-overflow fix affecting every authenticated page at tablet/mobile, a P0 landing Grid-component mobile-overflow fix affecting the primary conversion route, a real collapsed desktop sidebar rail, a real mobile drawer + bottom nav, a real command-palette focus trap, and a first pass of accessibility fixes. Displaced the originally-planned Quality-hold enforcement prompt to 17 — see "Why Prompt 16 changed" below. |
| 17 | Shared blocker: Quality-hold cross-module enforcement | 7 | Make quality holds actually block Stock/Procurement/Manufacturing movement, and add a real release-hold function |
| 18 | Shared blocker: HR payroll correctness foundation | 12 | Real employee-compensation assignment + a real (non-hardcoded-zero) payroll calculation engine, before any statutory feature is built on top |
| 19 | Shared blocker: Stock costing-method correctness | 5 | Make FIFO/standard-cost selections actually change the cost calculation (currently always moving-average); add a real period-close lock |
| 20 | Shared blocker: universal write-UI framework | 8 | A reusable create/edit/action form pattern, proven on one anchor feature per module, that every module campaign below builds on |
| 21 | Shared blocker: reporting/chart-library foundation | 9 | First chart/pivot library in the dependency tree + report builder + scheduled reports scaffold |
| 22 | Shared blocker: integration/API-key/OAuth foundation | 6 | Tenant API keys, OAuth 2.0 completion, WhatsApp/SMS provider wiring, API docs |
| 23 | Shared blocker: data management breadth + SSO/MFA/IP restrictions/record-level access audit | 8 | Generalize CRM-only duplicate/archiving/ownership/master-data-approval patterns to other modules; real MFA enrollment, SSO, IP allowlisting; audit whether CRM's Prompt 14 context-propagation defect class exists in other modules. Merged from two originally-separate 4-feature blocker prompts to absorb Prompt 16's UI/UX prompt without cascading a +1 renumber through the rest of the plan — see "Why Prompt 16 changed" below. |
| 24–25 | CRM completion | 24 | Close CRM's remaining gaps (already the most mature module) |
| 26–29 | Sales completion | 49 | Product/quotation/order/fulfilment/billing/analytics/advanced gaps, especially the confirmed Sales↔Stock disconnection |
| 30–33 | Procurement completion | 56 | Supplier/requisition/sourcing/PO/receiving gaps, especially RFQ UI and receiving→Stock write-through |
| 34–39 | Stock completion | 85 | Warehouse structure, transactions, operations, planning, traceability, advanced (largest non-Manufacturing gap) |
| 40–47 | Manufacturing completion | 118 | Product engineering, planning, execution, shop floor, traceability, quality/maintenance integration, costing, analytics, advanced (largest module) |
| 48–53 | Projects completion | 86 | Setup, planning, resources, time/expense, financials, collaboration, analytics, advanced |
| 54–58 | Assets completion | 73 | Register, acquisition/accounting, maintenance, inspection/calibration, allocation, analytics, advanced |
| 59–64 | POS completion | 87 | Operations, payments, retail ops, inventory/fulfilment, customer engagement, hardware, analytics, advanced |
| 65–69 | Quality completion | 70 (77 minus 7 claimed by Prompt 17) | Setup, inspections, non-conformance, CAPA, supplier/customer quality, compliance, analytics, advanced |
| 70–74 | Support completion | 73 | Tickets, assignment/workflow, SLA, customer service, knowledge, analytics, advanced |
| 75–81 | HR & Payroll completion | 96 (108 minus 12 claimed by Prompt 18) | Core HR, recruitment, attendance/leave, statutory payroll, self-service, performance/talent, analytics, advanced |
| 82–84 | Shared platform remaining | 47 (94 minus 47 claimed by Prompts 17/21/22/23) | SaaS platform ops, security/governance remainder, workflow/automation remainder, reporting remainder, integration remainder, UX remainder, data governance remainder |
| 85–86 | Accounting targeted fixes | 10 | TDS section-rates, depreciation UOP bug, Sales/Procurement auto-drain, e-invoice/e-way-bill/TCS providers, POS/HR/Assets GL wiring |
| 87 | Cross-module E2E | — | Re-test all 9 critical journeys from Section 25 against the finished state |
| 88 | Security review #2 | — | Adversarial review of all new surface area from 16–86 |
| 89 | Performance hardening | — | Large lists, reports, ledgers, MRP, warehouse operations |
| 90 | Accessibility audit | — | WCAG AA verification across all modules and the new write-UI framework |
| 91 | Responsive/mobile-web audit | — | Verification across all modules |
| 92 | Landing e2e stabilization | — | Pre-existing, unrelated Playwright instability, deferred again |
| 93 | Observability | — | Logging/metrics/tracing audit and foundation |
| 94 | Backup/DR runbook | — | Verify and document real backup/restore posture (SHARED-010 was UNVERIFIED) |
| 95 | Migration/schema consolidation | — | Dead-schema cleanup review, fix the duplicate 039 migration-prefix warning from `verify:db` |
| 96 | Notification scheduling | — | Digest/scheduled notifications, building on the Prompt 13 worker foundation |
| 97 | KPI framework + cross-module BI | — | Deeper build on Prompt 21's chart/reporting foundation |
| 98 | Reports & Analytics completion | — | Real reports for any module still thin after 24–86 |
| 99 | Automation completion | — | Cross-module automation using the scheduler foundation (worker module-gating fix folded in here) |
| 100 | Integration completion | — | Marketplace/e-commerce/live bank feed, building on Prompts 21/83 |
| 101 | Full regression + UAT re-verification | — | Re-run `ERP_TEAM_UAT_SCOPE_015.md` against the finished state |
| 102 | Final reconciliation + launch sign-off | — | Re-run this entire Prompt 15 methodology against the finished state |

---

## Why Prompt 16 changed

Prompt 15 (this plan's own author) placed "Shared blocker — Quality-hold cross-module enforcement" at Prompt 16 in its own numbering, since Prompt 15 had no way to know Prompt 16 would actually be issued as a full UI/UX, design-system, responsive-web, and accessibility overhaul instead. That UI/UX prompt has now run as Prompt 16 (see `ERP_UI_UX_BUG_REGISTER_016.csv` and `ERP_UI_UX_RESPONSIVE_016.md` for its own deliverables) and does not claim any row from the 1,039-feature exact matrix — it is a shared cross-cutting hardening pass, not a feature-completion prompt, so it sits outside the normal 87-prompt/906-row apportionment entirely.

Rather than cascade a blind "+1" through every one of the remaining 86 prompts (which would force renumbering all of 24–102 as well, invalidating every cross-reference in this document and in `ERP_TEAM_UAT_SCOPE_015.md`), the 8 shared-blocker prompts that previously occupied 16–23 are renumbered 17–23 (7 slots, one fewer) by merging the two smallest, thematically-adjacent blockers — "data management breadth" (4 features) and "SSO/MFA/IP restrictions + record-level-access audit" (4 features), both shared-platform-hardening concerns — into a single combined Prompt 23 (8 features). This keeps Prompt 24 (CRM completion) and everything after it at its original number, so only Prompts 16–23 and their handful of direct cross-references (listed below) needed updating.

## Shared blockers (17–23)

### Prompt 17
**Title**: Shared blocker — Quality-hold cross-module enforcement
**Targets**: QUAL-023, QUAL-026, QUAL-027, QUAL-028, QUAL-029, QUAL-030, QUAL-075
**Reason**: Independently re-confirmed by Prompt 15's own research (not merely carried forward from Prompt 11): `completeInspection` genuinely inserts a real `quality_holds` row on failure, but zero references to `quality_hold` exist anywhere in Stock's `postStockMovement`, Manufacturing's material-issue path, or Procurement's receiving — a held batch/serial/item can still be issued, received, or consumed. No release-hold function exists either (`releaseInspection` updates `quality_inspections`, not `quality_holds`). Affects three other modules' own correctness, so it is fixed once, centrally, rather than three times.
**Dependencies**: None.

### Prompt 18
**Title**: Shared blocker — HR payroll correctness foundation
**Targets**: HR-042, HR-043, HR-044, HR-045, HR-046, HR-047, HR-048, HR-049, HR-050, HR-051, HR-053, HR-055
**Reason**: The single most severe correctness defect in the whole reconciliation, independently re-verified line-by-line in this prompt: `calculatePayrollRun` hardcodes `deductions = 0` and `employer = 0`, no code path anywhere lets an employee's compensation be assigned, `hr_salary_structures`/`hr_salary_components` are never queried at all, proration doesn't account for mid-period joining/separation, and the "post to Accounting" transition stores an opaque caller-supplied string instead of creating a real journal entry. Must be fixed before any statutory feature (Prompt 78) is built on top of it, per Prompt 11's own explicit judgment, reaffirmed here.
**Dependencies**: None — do this before 75–81.

### Prompt 19
**Title**: Shared blocker — Stock costing-method correctness
**Targets**: STOCK-011, STOCK-063, STOCK-065, STOCK-066, STOCK-072
**Reason**: A newly-confirmed P0 financial-correctness bug (not in Prompt 11's report): selecting FIFO or standard costing on an item has zero effect — `postStockMovement()` always computes moving-average regardless. Affects every downstream valuation/COGS/reporting figure. A real period-close lock is bundled in since it's the same "can I trust last period's stock valuation" concern.
**Dependencies**: None — should land before Stock's own broader campaign (34–39) and before Manufacturing/POS costing work that reads Stock's valuation.

### Prompt 20
**Title**: Shared blocker — universal write-UI framework
**Targets**: STOCK-021, STOCK-022, SUP-001, POS-001, QUAL-011, ASSET-013, PROJ-011, MFG-033
**Reason**: The single highest-leverage finding across both Prompt 11 and this reconciliation: eight modules have real, often well-engineered backend logic reachable only via direct API call, because every list page is read-only and every create/edit/action function has zero UI. Rather than building bespoke forms per module, this prompt builds ONE reusable pattern and proves it on one representative, high-value anchor feature per affected module (goods receipt/issue for Stock, first ticket-creation for Support, first product-search/sale for POS, first inspection for Quality, first asset-from-receipt for Assets, first WBS for Projects, first manufacturing order for Manufacturing). Every module campaign below (26–84) then reuses this pattern instead of re-inventing form infrastructure per module.
**Dependencies**: None — the highest-priority infrastructure prompt in this plan; module campaigns 26–84 depend on it for their own MISSING_UI items even though not every one of those items lists it as a formal dependency below (to avoid a 60-entry "depends on 20" repetition, it's stated once here).

### Prompt 21
**Title**: Shared blocker — reporting/chart-library foundation
**Targets**: SHARED-044, SHARED-045, SHARED-046, SHARED-047, SHARED-048, SHARED-049, SHARED-051, SHARED-052, SHARED-054
**Reason**: No chart/visualization library exists anywhere in the dependency tree (confirmed again in this reconciliation), blocking any real dashboard visualization, cross-module BI, or a genuine report builder. This is infrastructure Prompts 98 and 97 build further on.
**Dependencies**: None.

### Prompt 22
**Title**: Shared blocker — integration/API-key/OAuth foundation
**Targets**: SHARED-055, SHARED-057, SHARED-058, SHARED-059, SHARED-063, SHARED-066
**Reason**: No tenant API-key system and an incomplete OAuth token-exchange step block the entire third-party developer/integration surface — confirmed still true. Bundles WhatsApp/SMS provider wiring and identity-provider integration since they share the same "external provider credential" infrastructure need.
**Dependencies**: None.

### Prompt 23
**Title**: Shared blocker — data management breadth + SSO/MFA/IP restrictions + record-level-access audit
**Targets**: SHARED-084, SHARED-086, SHARED-089, SHARED-093, SHARED-021, SHARED-022, SHARED-024, SHARED-016
**Reason**: Merged from two originally-separate prompts (see "Why Prompt 16 changed" above) that share a "shared-platform hardening, no cross-dependency between them" character. Every import/export/bulk-update/duplicate-detection/retention capability genuinely works but is scoped to CRM (and master data) only — confirmed again; generalizes the pattern rather than re-implementing it per module. Separately: MFA remains schema-only with no enrollment flow (unchanged since Prompt 1); SSO and IP restrictions are confirmed absent. Bundled with an explicit audit task (not a fix — see Part 34/Section 26 of `ERP_EXACT_FEATURE_RECONCILIATION_015.md`): confirm whether the class of bug Prompt 14 found and fixed in CRM's `crmContext()` (real session data never reaching a permission check) exists in any other module's own context-construction function, since Prompt 14 only audited CRM. SHARED-016 (record-level access) reflects that this audit is still open.
**Dependencies**: 20 (reuses the write-UI framework for any new admin surface the data-management-breadth half of this prompt needs).

---

## Module completion campaigns (24–84)

### Prompt 24
**Title**: CRM — Customer and account management + 4 more

**Targets** (12 features: 6 PARTIAL, 4 MISSING, 2 FOUNDATION_ONLY): CRM-004, CRM-007, CRM-010, CRM-014, CRM-017, CRM-034, CRM-038, CRM-041, CRM-042, CRM-043, CRM-044, CRM-049

**Categories covered**: Customer and account management; Lead management; Opportunity and pipeline management; Activities and communication; Campaigns and automation

---

### Prompt 25
**Title**: CRM — Campaigns and automation + 2 more

**Targets** (12 features: 6 FOUNDATION_ONLY, 2 PARTIAL, 4 MISSING): CRM-050, CRM-053, CRM-054, CRM-061, CRM-062, CRM-064, CRM-065, CRM-066, CRM-067, CRM-069, CRM-071, CRM-073

**Categories covered**: Campaigns and automation; CRM analytics; Advanced

---

### Prompt 26
**Title**: Sales — Product and commercial setup + 2 more

**Targets** (13 features: 9 MISSING, 3 PARTIAL, 1 FOUNDATION_ONLY): SALES-002, SALES-007, SALES-008, SALES-012, SALES-013, SALES-015, SALES-016, SALES-017, SALES-018, SALES-025, SALES-026, SALES-030, SALES-031

**Categories covered**: Product and commercial setup; Quotation management; Sales order management

---

### Prompt 27
**Title**: Sales — Sales order management + Fulfilment and billing

**Targets** (13 features: 3 PARTIAL, 10 MISSING): SALES-034, SALES-036, SALES-037, SALES-038, SALES-039, SALES-042, SALES-043, SALES-045, SALES-046, SALES-047, SALES-049, SALES-050, SALES-051

**Categories covered**: Sales order management; Fulfilment and billing

---

### Prompt 28
**Title**: Sales — Fulfilment and billing + Sales analytics

**Targets** (13 features: 2 PARTIAL, 2 FOUNDATION_ONLY, 9 MISSING): SALES-052, SALES-053, SALES-054, SALES-055, SALES-056, SALES-057, SALES-058, SALES-059, SALES-061, SALES-063, SALES-064, SALES-065, SALES-066

**Categories covered**: Fulfilment and billing; Sales analytics

---

### Prompt 29
**Title**: Sales — Sales analytics + Advanced

**Targets** (10 features: 8 MISSING, 1 PARTIAL, 1 FOUNDATION_ONLY): SALES-067, SALES-068, SALES-069, SALES-070, SALES-071, SALES-072, SALES-073, SALES-074, SALES-075, SALES-076

**Categories covered**: Sales analytics; Advanced

---

### Prompt 30
**Title**: Procurement — Supplier management + Purchase requisitions

**Targets** (14 features: 9 PARTIAL, 3 FOUNDATION_ONLY, 2 MISSING): PROC-002, PROC-003, PROC-004, PROC-005, PROC-006, PROC-008, PROC-009, PROC-010, PROC-011, PROC-012, PROC-016, PROC-017, PROC-018, PROC-019

**Categories covered**: Supplier management; Purchase requisitions

---

### Prompt 31
**Title**: Procurement — Purchase requisitions + 2 more

**Targets** (14 features: 3 MISSING, 8 PARTIAL, 3 FOUNDATION_ONLY): PROC-020, PROC-021, PROC-023, PROC-025, PROC-026, PROC-027, PROC-028, PROC-029, PROC-030, PROC-031, PROC-032, PROC-035, PROC-036, PROC-037

**Categories covered**: Purchase requisitions; Sourcing and RFQ; Purchase orders

---

### Prompt 32
**Title**: Procurement — Purchase orders + Receiving and invoicing

**Targets** (14 features: 8 PARTIAL, 6 MISSING): PROC-038, PROC-039, PROC-042, PROC-043, PROC-044, PROC-046, PROC-047, PROC-048, PROC-050, PROC-051, PROC-052, PROC-053, PROC-054, PROC-059

**Categories covered**: Purchase orders; Receiving and invoicing

---

### Prompt 33
**Title**: Procurement — Procurement analytics + Advanced

**Targets** (14 features: 4 PARTIAL, 7 MISSING, 3 FOUNDATION_ONLY): PROC-063, PROC-064, PROC-068, PROC-069, PROC-070, PROC-071, PROC-072, PROC-073, PROC-074, PROC-075, PROC-076, PROC-077, PROC-078, PROC-079

**Categories covered**: Procurement analytics; Advanced

---

### Prompt 34
**Title**: Stock — Product and inventory master + Warehouse structure

**Targets** (13 features: 5 MISSING, 6 PARTIAL, 2 FOUNDATION_ONLY): STOCK-002, STOCK-003, STOCK-004, STOCK-005, STOCK-006, STOCK-007, STOCK-008, STOCK-009, STOCK-010, STOCK-012, STOCK-015, STOCK-016, STOCK-017

**Categories covered**: Product and inventory master; Warehouse structure

---

### Prompt 35
**Title**: Stock — Warehouse structure + Inventory transactions

**Targets** (13 features: 7 PARTIAL, 2 FOUNDATION_ONLY, 4 MISSING): STOCK-018, STOCK-019, STOCK-020, STOCK-023, STOCK-024, STOCK-025, STOCK-026, STOCK-027, STOCK-028, STOCK-029, STOCK-030, STOCK-031, STOCK-032

**Categories covered**: Warehouse structure; Inventory transactions

---

### Prompt 36
**Title**: Stock — Inventory transactions + Warehouse operations

**Targets** (13 features: 13 MISSING): STOCK-033, STOCK-034, STOCK-035, STOCK-036, STOCK-037, STOCK-038, STOCK-039, STOCK-040, STOCK-041, STOCK-042, STOCK-043, STOCK-044, STOCK-045

**Categories covered**: Inventory transactions; Warehouse operations

---

### Prompt 37
**Title**: Stock — Warehouse operations + Inventory planning and control

**Targets** (13 features: 11 MISSING, 2 PARTIAL): STOCK-046, STOCK-047, STOCK-048, STOCK-049, STOCK-050, STOCK-051, STOCK-052, STOCK-053, STOCK-054, STOCK-055, STOCK-056, STOCK-057, STOCK-058

**Categories covered**: Warehouse operations; Inventory planning and control

---

### Prompt 38
**Title**: Stock — Inventory planning and control + 2 more

**Targets** (13 features: 11 MISSING, 2 PARTIAL): STOCK-059, STOCK-060, STOCK-061, STOCK-062, STOCK-067, STOCK-068, STOCK-069, STOCK-070, STOCK-071, STOCK-073, STOCK-074, STOCK-075, STOCK-077

**Categories covered**: Inventory planning and control; Costing and valuation; Traceability and analytics

---

### Prompt 39
**Title**: Stock — Traceability and analytics + Advanced

**Targets** (13 features: 13 MISSING): STOCK-078, STOCK-079, STOCK-080, STOCK-081, STOCK-082, STOCK-083, STOCK-084, STOCK-085, STOCK-086, STOCK-087, STOCK-088, STOCK-089, STOCK-090

**Categories covered**: Traceability and analytics; Advanced

---

### Prompt 40
**Title**: Manufacturing — Product engineering

**Targets** (15 features: 4 FOUNDATION_ONLY, 10 MISSING, 1 PARTIAL): MFG-001, MFG-002, MFG-003, MFG-004, MFG-005, MFG-006, MFG-007, MFG-008, MFG-009, MFG-010, MFG-011, MFG-012, MFG-013, MFG-014, MFG-015

**Categories covered**: Product engineering

---

### Prompt 41
**Title**: Manufacturing — Product engineering + Production planning

**Targets** (15 features: 12 MISSING, 1 FOUNDATION_ONLY, 2 PARTIAL): MFG-016, MFG-017, MFG-018, MFG-019, MFG-020, MFG-021, MFG-022, MFG-023, MFG-024, MFG-025, MFG-026, MFG-027, MFG-028, MFG-029, MFG-030

**Categories covered**: Product engineering; Production planning

---

### Prompt 42
**Title**: Manufacturing — Production planning + Work orders and execution

**Targets** (15 features: 5 FOUNDATION_ONLY, 6 MISSING, 4 PARTIAL): MFG-031, MFG-032, MFG-034, MFG-035, MFG-036, MFG-037, MFG-038, MFG-039, MFG-040, MFG-041, MFG-042, MFG-043, MFG-044, MFG-045, MFG-046

**Categories covered**: Production planning; Work orders and execution

---

### Prompt 43
**Title**: Manufacturing — Work orders and execution + Shop-floor control

**Targets** (15 features: 2 PARTIAL, 12 MISSING, 1 FOUNDATION_ONLY): MFG-047, MFG-048, MFG-049, MFG-050, MFG-051, MFG-052, MFG-053, MFG-054, MFG-055, MFG-056, MFG-057, MFG-058, MFG-059, MFG-060, MFG-061

**Categories covered**: Work orders and execution; Shop-floor control

---

### Prompt 44
**Title**: Manufacturing — Shop-floor control + 2 more

**Targets** (15 features: 9 MISSING, 4 PARTIAL, 2 FOUNDATION_ONLY): MFG-062, MFG-063, MFG-064, MFG-065, MFG-066, MFG-067, MFG-068, MFG-069, MFG-070, MFG-071, MFG-072, MFG-073, MFG-074, MFG-075, MFG-076

**Categories covered**: Shop-floor control; Material and traceability; Quality and maintenance integration

---

### Prompt 45
**Title**: Manufacturing — Quality and maintenance integration + Costing

**Targets** (15 features: 15 MISSING): MFG-077, MFG-078, MFG-079, MFG-080, MFG-081, MFG-082, MFG-083, MFG-084, MFG-085, MFG-086, MFG-087, MFG-088, MFG-089, MFG-090, MFG-091

**Categories covered**: Quality and maintenance integration; Costing

---

### Prompt 46
**Title**: Manufacturing — Costing + Manufacturing analytics

**Targets** (15 features: 11 MISSING, 2 PARTIAL, 2 FOUNDATION_ONLY): MFG-092, MFG-093, MFG-094, MFG-095, MFG-096, MFG-097, MFG-098, MFG-099, MFG-100, MFG-101, MFG-102, MFG-103, MFG-104, MFG-105, MFG-106

**Categories covered**: Costing; Manufacturing analytics

---

### Prompt 47
**Title**: Manufacturing — Manufacturing analytics + Advanced

**Targets** (12 features: 1 FOUNDATION_ONLY, 11 MISSING): MFG-107, MFG-108, MFG-109, MFG-110, MFG-111, MFG-112, MFG-113, MFG-114, MFG-115, MFG-116, MFG-117, MFG-118

**Categories covered**: Manufacturing analytics; Advanced

---

### Prompt 48
**Title**: Projects — Project setup + Planning

**Targets** (15 features: 8 MISSING, 6 PARTIAL, 1 FOUNDATION_ONLY): PROJ-001, PROJ-002, PROJ-003, PROJ-004, PROJ-005, PROJ-006, PROJ-007, PROJ-008, PROJ-009, PROJ-010, PROJ-012, PROJ-013, PROJ-014, PROJ-015, PROJ-016

**Categories covered**: Project setup; Planning

---

### Prompt 49
**Title**: Projects — Planning + Resource management

**Targets** (15 features: 14 MISSING, 1 FOUNDATION_ONLY): PROJ-017, PROJ-018, PROJ-019, PROJ-020, PROJ-021, PROJ-022, PROJ-023, PROJ-024, PROJ-025, PROJ-026, PROJ-027, PROJ-028, PROJ-029, PROJ-030, PROJ-031

**Categories covered**: Planning; Resource management

---

### Prompt 50
**Title**: Projects — Resource management + 2 more

**Targets** (15 features: 6 MISSING, 5 PARTIAL, 4 FOUNDATION_ONLY): PROJ-032, PROJ-033, PROJ-034, PROJ-035, PROJ-036, PROJ-037, PROJ-038, PROJ-039, PROJ-040, PROJ-041, PROJ-042, PROJ-043, PROJ-044, PROJ-045, PROJ-046

**Categories covered**: Resource management; Time and expenses; Project financials

---

### Prompt 51
**Title**: Projects — Project financials + Collaboration and governance

**Targets** (15 features: 2 PARTIAL, 8 MISSING, 5 FOUNDATION_ONLY): PROJ-047, PROJ-048, PROJ-049, PROJ-050, PROJ-051, PROJ-052, PROJ-053, PROJ-054, PROJ-055, PROJ-056, PROJ-057, PROJ-058, PROJ-059, PROJ-060, PROJ-061

**Categories covered**: Project financials; Collaboration and governance

---

### Prompt 52
**Title**: Projects — Collaboration and governance + Project analytics

**Targets** (15 features: 11 MISSING, 3 PARTIAL, 1 FOUNDATION_ONLY): PROJ-062, PROJ-063, PROJ-064, PROJ-065, PROJ-066, PROJ-067, PROJ-068, PROJ-069, PROJ-070, PROJ-071, PROJ-072, PROJ-073, PROJ-074, PROJ-075, PROJ-076

**Categories covered**: Collaboration and governance; Project analytics

---

### Prompt 53
**Title**: Projects — Project analytics + Advanced

**Targets** (10 features: 1 FOUNDATION_ONLY, 8 MISSING, 1 PARTIAL): PROJ-077, PROJ-078, PROJ-079, PROJ-080, PROJ-081, PROJ-082, PROJ-083, PROJ-084, PROJ-085, PROJ-086

**Categories covered**: Project analytics; Advanced

---

### Prompt 54
**Title**: Assets — Asset register + Asset acquisition and accounting

**Targets** (15 features: 9 PARTIAL, 6 MISSING): ASSET-001, ASSET-002, ASSET-003, ASSET-004, ASSET-005, ASSET-006, ASSET-007, ASSET-008, ASSET-009, ASSET-010, ASSET-011, ASSET-012, ASSET-014, ASSET-015, ASSET-016

**Categories covered**: Asset register; Asset acquisition and accounting

---

### Prompt 55
**Title**: Assets — Asset acquisition and accounting + Maintenance

**Targets** (15 features: 5 FOUNDATION_ONLY, 7 MISSING, 3 PARTIAL): ASSET-017, ASSET-018, ASSET-019, ASSET-020, ASSET-021, ASSET-022, ASSET-023, ASSET-024, ASSET-025, ASSET-026, ASSET-027, ASSET-028, ASSET-029, ASSET-030, ASSET-031

**Categories covered**: Asset acquisition and accounting; Maintenance

---

### Prompt 56
**Title**: Assets — Maintenance + Inspection and calibration

**Targets** (15 features: 6 MISSING, 5 PARTIAL, 4 FOUNDATION_ONLY): ASSET-032, ASSET-033, ASSET-034, ASSET-035, ASSET-036, ASSET-037, ASSET-038, ASSET-039, ASSET-040, ASSET-041, ASSET-042, ASSET-043, ASSET-044, ASSET-045, ASSET-046

**Categories covered**: Maintenance; Inspection and calibration

---

### Prompt 57
**Title**: Assets — Inspection and calibration + 2 more

**Targets** (15 features: 9 MISSING, 2 FOUNDATION_ONLY, 4 PARTIAL): ASSET-047, ASSET-048, ASSET-049, ASSET-050, ASSET-051, ASSET-052, ASSET-053, ASSET-054, ASSET-055, ASSET-056, ASSET-057, ASSET-058, ASSET-059, ASSET-060, ASSET-061

**Categories covered**: Inspection and calibration; Asset allocation; Asset analytics

---

### Prompt 58
**Title**: Assets — Asset analytics + Advanced

**Targets** (12 features: 11 MISSING, 1 PARTIAL): ASSET-062, ASSET-063, ASSET-064, ASSET-065, ASSET-066, ASSET-067, ASSET-068, ASSET-069, ASSET-070, ASSET-071, ASSET-072, ASSET-073

**Categories covered**: Asset analytics; Advanced

---

### Prompt 59
**Title**: POS — POS operations + Payments

**Targets** (15 features: 9 MISSING, 3 FOUNDATION_ONLY, 3 PARTIAL): POS-002, POS-003, POS-004, POS-005, POS-006, POS-007, POS-008, POS-009, POS-010, POS-011, POS-012, POS-013, POS-014, POS-015, POS-016

**Categories covered**: POS operations; Payments

---

### Prompt 60
**Title**: POS — Payments + Retail operations

**Targets** (15 features: 4 FOUNDATION_ONLY, 6 MISSING, 5 PARTIAL): POS-017, POS-018, POS-019, POS-020, POS-021, POS-022, POS-023, POS-024, POS-025, POS-026, POS-027, POS-028, POS-029, POS-030, POS-031

**Categories covered**: Payments; Retail operations

---

### Prompt 61
**Title**: POS — Retail operations + Inventory and fulfilment

**Targets** (15 features: 8 PARTIAL, 2 FOUNDATION_ONLY, 5 MISSING): POS-032, POS-033, POS-034, POS-035, POS-036, POS-037, POS-038, POS-039, POS-040, POS-041, POS-042, POS-043, POS-046, POS-047, POS-048

**Categories covered**: Retail operations; Inventory and fulfilment

---

### Prompt 62
**Title**: POS — Inventory and fulfilment + 2 more

**Targets** (15 features: 13 MISSING, 1 PARTIAL, 1 FOUNDATION_ONLY): POS-049, POS-050, POS-051, POS-052, POS-053, POS-054, POS-055, POS-056, POS-057, POS-058, POS-059, POS-060, POS-061, POS-062, POS-063

**Categories covered**: Inventory and fulfilment; Customer engagement; Hardware and integration

---

### Prompt 63
**Title**: POS — Hardware and integration + POS analytics

**Targets** (15 features: 13 MISSING, 2 PARTIAL): POS-064, POS-065, POS-066, POS-067, POS-068, POS-069, POS-070, POS-071, POS-072, POS-073, POS-074, POS-075, POS-076, POS-077, POS-078

**Categories covered**: Hardware and integration; POS analytics

---

### Prompt 64
**Title**: POS — POS analytics + Advanced

**Targets** (11 features: 10 MISSING, 1 PARTIAL): POS-079, POS-080, POS-081, POS-082, POS-083, POS-084, POS-085, POS-086, POS-087, POS-088, POS-089

**Categories covered**: POS analytics; Advanced

---

### Prompt 65
**Title**: Quality — Quality setup + Inspections

**Targets** (14 features: 4 FOUNDATION_ONLY, 3 MISSING, 7 PARTIAL): QUAL-001, QUAL-002, QUAL-003, QUAL-004, QUAL-005, QUAL-006, QUAL-007, QUAL-008, QUAL-009, QUAL-010, QUAL-012, QUAL-013, QUAL-014, QUAL-015

**Categories covered**: Quality setup; Inspections

---

### Prompt 66
**Title**: Quality — Inspections + 2 more

**Targets** (14 features: 8 MISSING, 2 PARTIAL, 4 FOUNDATION_ONLY): QUAL-016, QUAL-017, QUAL-018, QUAL-019, QUAL-020, QUAL-021, QUAL-022, QUAL-024, QUAL-025, QUAL-031, QUAL-032, QUAL-033, QUAL-034, QUAL-035

**Categories covered**: Inspections; Non-conformance; Corrective and preventive action

---

### Prompt 67
**Title**: Quality — Corrective and preventive action + Supplier and customer quality

**Targets** (14 features: 6 FOUNDATION_ONLY, 5 MISSING, 1 UI_ONLY, 2 PARTIAL): QUAL-036, QUAL-037, QUAL-038, QUAL-039, QUAL-040, QUAL-041, QUAL-042, QUAL-043, QUAL-044, QUAL-045, QUAL-046, QUAL-047, QUAL-048, QUAL-049

**Categories covered**: Corrective and preventive action; Supplier and customer quality

---

### Prompt 68
**Title**: Quality — Supplier and customer quality + 2 more

**Targets** (14 features: 9 MISSING, 4 FOUNDATION_ONLY, 1 PARTIAL): QUAL-050, QUAL-051, QUAL-052, QUAL-053, QUAL-054, QUAL-055, QUAL-056, QUAL-057, QUAL-058, QUAL-059, QUAL-060, QUAL-061, QUAL-062, QUAL-063

**Categories covered**: Supplier and customer quality; Compliance; Quality analytics

---

### Prompt 69
**Title**: Quality — Quality analytics + Advanced

**Targets** (13 features: 12 MISSING, 1 PARTIAL): QUAL-064, QUAL-065, QUAL-066, QUAL-067, QUAL-068, QUAL-069, QUAL-070, QUAL-071, QUAL-072, QUAL-073, QUAL-074, QUAL-076, QUAL-077

**Categories covered**: Quality analytics; Advanced

---

### Prompt 70
**Title**: Support — Ticket management + Assignment and workflow

**Targets** (15 features: 9 MISSING, 1 FOUNDATION_ONLY, 5 PARTIAL): SUP-002, SUP-003, SUP-004, SUP-005, SUP-006, SUP-007, SUP-008, SUP-009, SUP-010, SUP-011, SUP-012, SUP-013, SUP-014, SUP-015, SUP-016

**Categories covered**: Ticket management; Assignment and workflow

---

### Prompt 71
**Title**: Support — Assignment and workflow + SLA management

**Targets** (15 features: 9 MISSING, 3 PARTIAL, 3 FOUNDATION_ONLY): SUP-017, SUP-018, SUP-019, SUP-020, SUP-021, SUP-022, SUP-023, SUP-024, SUP-025, SUP-026, SUP-027, SUP-030, SUP-031, SUP-032, SUP-033

**Categories covered**: Assignment and workflow; SLA management

---

### Prompt 72
**Title**: Support — SLA management + 2 more

**Targets** (15 features: 4 PARTIAL, 10 MISSING, 1 FOUNDATION_ONLY): SUP-034, SUP-035, SUP-036, SUP-037, SUP-038, SUP-039, SUP-040, SUP-041, SUP-042, SUP-043, SUP-044, SUP-045, SUP-046, SUP-047, SUP-048

**Categories covered**: SLA management; Customer service capabilities; Knowledge management

---

### Prompt 73
**Title**: Support — Knowledge management + Service analytics

**Targets** (15 features: 5 PARTIAL, 2 FOUNDATION_ONLY, 8 MISSING): SUP-049, SUP-050, SUP-051, SUP-052, SUP-053, SUP-054, SUP-055, SUP-056, SUP-057, SUP-058, SUP-059, SUP-060, SUP-061, SUP-062, SUP-063

**Categories covered**: Knowledge management; Service analytics

---

### Prompt 74
**Title**: Support — Service analytics + Advanced

**Targets** (12 features: 12 MISSING): SUP-064, SUP-065, SUP-066, SUP-067, SUP-068, SUP-069, SUP-070, SUP-071, SUP-072, SUP-073, SUP-074, SUP-075

**Categories covered**: Service analytics; Advanced

---

### Prompt 75
**Title**: HR & Payroll — Core HR

**Targets** (14 features: 8 PARTIAL, 2 FOUNDATION_ONLY, 4 MISSING): HR-001, HR-002, HR-003, HR-004, HR-005, HR-006, HR-007, HR-008, HR-009, HR-010, HR-011, HR-012, HR-013, HR-014

**Categories covered**: Core HR

---

### Prompt 76
**Title**: HR & Payroll — Recruitment and onboarding + Attendance and leave

**Targets** (14 features: 13 MISSING, 1 FOUNDATION_ONLY): HR-015, HR-016, HR-017, HR-018, HR-019, HR-020, HR-021, HR-022, HR-023, HR-024, HR-025, HR-026, HR-027, HR-028

**Categories covered**: Recruitment and onboarding; Attendance and leave

---

### Prompt 77
**Title**: HR & Payroll — Attendance and leave + Payroll

**Targets** (14 features: 8 MISSING, 3 FOUNDATION_ONLY, 3 PARTIAL): HR-029, HR-030, HR-031, HR-032, HR-033, HR-034, HR-035, HR-036, HR-037, HR-038, HR-039, HR-040, HR-041, HR-052

**Categories covered**: Attendance and leave; Payroll

---

### Prompt 78
**Title**: HR & Payroll — Payroll + India-first statutory payroll

**Targets** (14 features: 14 MISSING): HR-054, HR-056, HR-057, HR-058, HR-059, HR-060, HR-061, HR-062, HR-063, HR-064, HR-065, HR-066, HR-067, HR-068

**Categories covered**: Payroll; India-first statutory payroll

---

### Prompt 79
**Title**: HR & Payroll — Employee self-service + Performance and talent

**Targets** (14 features: 12 MISSING, 1 FOUNDATION_ONLY, 1 PARTIAL): HR-069, HR-070, HR-071, HR-072, HR-073, HR-074, HR-075, HR-076, HR-077, HR-078, HR-079, HR-080, HR-081, HR-082

**Categories covered**: Employee self-service; Performance and talent

---

### Prompt 80
**Title**: HR & Payroll — Performance and talent + HR analytics

**Targets** (14 features: 11 MISSING, 1 FOUNDATION_ONLY, 2 PARTIAL): HR-083, HR-084, HR-085, HR-086, HR-087, HR-088, HR-089, HR-090, HR-091, HR-092, HR-093, HR-094, HR-095, HR-096

**Categories covered**: Performance and talent; HR analytics

---

### Prompt 81
**Title**: HR & Payroll — HR analytics + Advanced

**Targets** (12 features: 12 MISSING): HR-097, HR-098, HR-099, HR-100, HR-101, HR-102, HR-103, HR-104, HR-105, HR-106, HR-107, HR-108

**Categories covered**: HR analytics; Advanced

---

### Prompt 82
**Title**: Shared platform — SaaS platform + 2 more

**Targets** (16 features: 11 PARTIAL, 2 UNVERIFIED, 3 MISSING): SHARED-008, SHARED-009, SHARED-010, SHARED-011, SHARED-012, SHARED-013, SHARED-014, SHARED-018, SHARED-026, SHARED-027, SHARED-028, SHARED-029, SHARED-030, SHARED-031, SHARED-032, SHARED-033

**Categories covered**: SaaS platform; Security and governance; Workflow and automation

---

### Prompt 83
**Title**: Shared platform — Workflow and automation + 2 more

**Targets** (16 features: 5 MISSING, 11 PARTIAL): SHARED-034, SHARED-035, SHARED-036, SHARED-037, SHARED-038, SHARED-039, SHARED-040, SHARED-041, SHARED-043, SHARED-050, SHARED-053, SHARED-056, SHARED-060, SHARED-062, SHARED-064, SHARED-065

**Categories covered**: Workflow and automation; Reporting and analytics; Integration

---

### Prompt 84
**Title**: Shared platform — Integration + 2 more

**Targets** (15 features: 12 PARTIAL, 3 MISSING): SHARED-067, SHARED-068, SHARED-069, SHARED-072, SHARED-073, SHARED-074, SHARED-075, SHARED-076, SHARED-077, SHARED-079, SHARED-080, SHARED-087, SHARED-088, SHARED-090, SHARED-091

**Categories covered**: Integration; User experience; Data governance

---

### Prompt 85
**Title**: Accounting — Accounting

**Targets** (5 features: 5 n/a): ACC-034, ACC-035, ACC-036, ACC-037, ACC-038

**Categories covered**: Accounting

---

### Prompt 86
**Title**: Accounting — Accounting

**Targets** (5 features: 5 n/a): ACC-039, ACC-040, ACC-041, ACC-042, ACC-043

**Categories covered**: Accounting

---


## Accounting targeted fixes (85–86)

Accounting is genuinely the strongest module in the repository (33 of 43 real functional areas COMPLETE per `ERP_ACCOUNTING_MATRIX_015.csv`) — these two prompts are targeted correctness fixes and cross-module GL wiring only, explicitly not a rebuild campaign.

### Prompt 85
**Title**: Accounting — tax/depreciation correctness + cross-module auto-drain
**Targets**: ACC-034 (TDS — no India section-rate master, no Form 16A/26Q), ACC-035 (depreciation — `units_of_production` silently falls back to straight-line, a real user-facing calculation bug), ACC-036 (Sales→Accounting — currently manual-import only, no worker drains the queue), ACC-037 (Procurement→Accounting — same manual pattern), ACC-038 (e-invoice — real request/status shell, zero actual GSTN/IRP integration).
**Reason**: Two are correctness bugs (TDS, depreciation), two are "wire the existing worker foundation (Prompt 13) to auto-drain these two already-real, already-idempotent request queues instead of requiring a manual click," one is a genuine external-provider integration gap.
**Dependencies**: 13 (worker foundation, already complete) for ACC-036/037.

### Prompt 86
**Title**: Accounting — remaining compliance + Stock/POS/HR/Assets GL wiring
**Targets**: ACC-039 (e-way bill — same shell pattern as e-invoice, no real portal integration), ACC-040 (TCS — enum value only, no Section 206C logic), ACC-041 (POS→Accounting — confirmed fully isolated, zero GL postings on sale), ACC-042 (HR & Payroll→Accounting — confirmed fully isolated, only an opaque string stored), ACC-043 (Assets→Accounting — confirmed fully isolated, and a real float/BigInt money-handling inconsistency if ever connected).
**Reason**: Closes the three confirmed-isolated cross-module GL integrations together since they share the same "post a real journal entry on the triggering event" shape, plus the remaining India-compliance provider gaps.
**Dependencies**: 61–64 (POS completion) for ACC-041 to have something real to post from; 18 (HR payroll correctness) for ACC-042 to post correct numbers, not zeros; 54–58 (Assets completion) for ACC-043.

---

## Hardening / release reserve (87–102)

Per Part 43: the final 16 prompts are reserved for cross-cutting verification and production-readiness work, not consumed by further module CRUD.

### Prompt 87 — Cross-module E2E
Re-test all 9 critical cross-module journeys (Section 25 of the reconciliation report) against the finished state of Prompts 16–86; confirm each moves from its current BROKEN/PARTIAL status to WORKING, with a real integration test per journey.

### Prompt 88 — Security review #2
Adversarial review of all new surface area introduced by Prompts 16–86 (the write-UI framework, every module's new create/edit/action forms, the data-management/integration/SSO work) — mirrors the adversarial-review discipline established in `ERP_SECURITY_HARDENING_003.md`.

### Prompt 89 — Performance hardening
Large lists, reports, audit logs, search, ledgers, MRP, and warehouse-operation queries across all modules completed in 16–86.

### Prompt 90 — Accessibility audit
WCAG AA verification across all modules, with particular attention to the new write-UI framework (Prompt 20) since it will be the most-reused new UI surface in the product. This is a deeper, module-by-module follow-on to the first-pass accessibility fixes already made in Prompt 16 (see `ERP_UI_UX_BUG_REGISTER_016.csv`'s A11Y-008/A11Y-009 rows, deferred behavioral-keyboard-navigation work).

### Prompt 91 — Responsive/mobile-web audit
Verification across all modules' new UI surfaces.

### Prompt 92 — Landing e2e stabilization
The long-flagged, pre-existing Playwright instability in `apps/landing`, unrelated to the ERP application itself — deferred again, as it has been since Prompt 4.

### Prompt 93 — Observability
Logging/metrics/tracing audit and foundation across the application and the Prompt 13 worker.

### Prompt 94 — Backup/DR runbook
Verify and document the real backup/restore posture — SHARED-010 ("Backup and disaster recovery") was classified UNVERIFIED in this reconciliation (infrastructure-layer claim not directly testable from application code), and SHARED-011 ("Regional deployment and data residency") was MISSING.

### Prompt 95 — Migration/schema consolidation
Dead-schema cleanup review across all modules touched by 16–86; fix the duplicate `039` tenant-migration-prefix warning `verify:db` has flagged since at least Prompt 13 (`039_crm_ai_feedback_draft_id.sql` and `039_crm_offline_completion.sql`).

### Prompt 96 — Notification scheduling
Digest/scheduled notifications, building on the Prompt 13 worker/scheduler foundation — a real, additive workload for the same job-queue infrastructure.

### Prompt 97 — KPI framework + cross-module BI
Deeper build on Prompt 21's chart/reporting foundation, closing SHARED-053 (KPI targets and alerts) fully.

### Prompt 98 — Reports & Analytics completion
Real reports for any module still thin on analytics after its own completion campaign (24–84), using Prompt 21's foundation.

### Prompt 99 — Automation completion
Cross-module automation using the Prompt 13 scheduler foundation. Folds in the two explicitly-deferred Prompt 13/14 gaps: the worker's missing module-enablement check before running jobs (Part 34), and the webhook multi-subscription fan-out limitation (Part 66) — both were deliberately left open at the time, this is their scheduled fix point.

### Prompt 100 — Integration completion
Marketplace/e-commerce/live-bank-feed connectors, building on Prompts 21 and 83.

### Prompt 101 — Full regression + UAT re-verification
Re-run `ERP_TEAM_UAT_SCOPE_015.md` against the fully-completed state — every feature that was READY/LIMITED in Prompt 15 re-confirmed, and every feature closed by Prompts 16–100 added as a new test case.

### Prompt 102 — Final reconciliation + launch sign-off
Re-run this entire Prompt 15 methodology (exact 1,039-row parse + classification) against the finished state, producing the final, authoritative completion percentage and launch-readiness sign-off.

---

## Validation

Programmatically checked by `scripts/validation/verify-exact-feature-matrix.mjs`:
- Every prompt number 16–102 is referenced by at least one row's `recommended_prompt` (shared-blocker/module/Accounting prompts) or exists as a defined hardening entry above (87–102, which by design target no single 1,039-matrix feature — they are cross-cutting verification work, consistent with Part 45's "every COMPLETE requirement need not be scheduled" principle extended to hardening work that spans all rows rather than any one).
- No prompt number outside 16–102 appears in any `recommended_prompt` value.
- No feature_id is claimed by more than one prompt.
- Every one of the 906 incomplete 1,039-matrix rows plus the 10 incomplete Accounting rows has exactly one prompt assignment — confirmed by `scripts/validation/.generated/build-prompt-assignments.mjs`'s own internal check (throws on any unclaimed incomplete feature or any double-claim).
