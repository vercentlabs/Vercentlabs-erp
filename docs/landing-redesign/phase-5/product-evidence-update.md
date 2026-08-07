# Product Evidence Update — Phase 5

Extends `docs/landing-redesign/phase-3/product-evidence-register.md` and `docs/landing-redesign/phase-4/screenshot-extension-register.md`. This document covers what changed: closing the 9-module screenshot evidence gap Phase 4 left open, and the root-cause investigation Prompt 5 explicitly required before any retry.

## Root cause of the Phase 4 background agent's stall

The Phase 4 background capture agent was dispatched with an assumption that turned out to be false: that all 9 uncovered modules (Accounting, Procurement, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) had real creation forms in `apps/web`, the same way CRM/Sales/Stock do. Investigating this phase confirmed:

- **7 of the 9 modules (Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) have no creation or detail UI anywhere in `apps/web`.** Each ships only a dashboard hero (real, styled — hero panel + metric-grid + resource-link cards) and a generic, read-only `[resource]/page.tsx` list route. The real backend API (`services/api`, exposed via each module's own `/api/{module}/resources/[resource]` route) is fully built and permission-checked; it is simply never wired to a form.
- **Procurement and Accounting have real UI**, but Procurement's detail view (`ProcurementResourceWorkspace`) renders a generic "Document facts" panel that exposes raw internal UUIDs unstyled for several fields — the same defect class Phase 3 rejected on CRM's opportunity-detail capture.
- The Phase 4 agent's 600-second stall investigating the `master-data/parties` form makes sense in hindsight: it was a single unsupervised agent hunting for creation forms that, for most of its target modules, do not exist — with no way to discover "there is no form" quickly through blind UI trial-and-error.

This is a **script-design and false-assumption root cause**, not an auth, seed-data, timing, network-idle, selector-instability, database-state, API-startup, tenant-selection, or rendering issue — each of those was checked and ruled out (the existing CRM/Sales/Procurement/Stock seeding in the same script continues to work reliably against the same app, same database, same tenant).

## The fix

`apps/landing/scripts/seed-marketing-demo-org.mjs` was extended with 8 new seeding steps, all following the same safety discipline as the rest of the script (real, permission-checked API routes only, called via an authenticated `fetch` from inside the real logged-in page — the exact technique the script already used for Stock's opening-stock movements; never a direct database write, never the real "VercentLabs" organization):

| Module | What was seeded | Method |
|---|---|---|
| Accounting | — (see bug below) | N/A — blocked by a real product bug |
| Procurement | (data already existed from the prior supplier/PO/receipt flow) | real UI form (unchanged) |
| Manufacturing | 1 bill of materials (activated), 2 work orders | authenticated API |
| Projects | 1 project, 1 task, 1 time entry | authenticated API |
| Assets | 1 asset category, 1 asset | authenticated API |
| Quality | 1 quality plan (draft — see gap below) | authenticated API |
| Support | 1 queue, 1 ticket | authenticated API |
| HR & Payroll | 3 employees, 1 payroll run | authenticated API |
| Point of Sale | 1 store, 1 terminal, 1 shift, 1 completed sale | authenticated API |

Each block runs independently in its own `try`/`catch` — a failure in one module never blocks the others, directly addressing the checkpointing weakness that made the Phase 4 attempt an all-or-nothing failure.

## Two additional real, pre-existing product bugs found (documented, not fixed — `apps/web` is out of scope for this redesign, per the same precedent already applied to the sales-order-confirm bug and the missing Stock-movement UI)

1. **Manual journal entries cannot be created.** `POST /api/accounting/journals` always fails with `TypeError: Do not know how to serialize a BigInt`. Root-caused to `services/api/src/accounting/journals.js`'s `createJournalEntry`: each line's `baseDebit`/`baseCredit` are computed as raw `BigInt` via `financial-decimal.js`, and the function's return value only converts `debit`/`credit` back to strings before spreading `...line` into the response — `baseDebit`/`baseCredit` remain `BigInt` and crash `JSON.stringify`. Reproduced through the real `JournalEditor` UI form, not just the API directly — this is a live bug affecting every user of the product today, not a seeding artifact. As a result, Accounting's evidence screenshot uses its real operations dashboard instead of a journal detail view.
2. **A Quality plan can never become inspectable.** `createInspection` requires a plan with `status='active'`, but `createQualityPlan` always inserts `status='draft'`, and no function anywhere in `services/api/src/quality/index.js` (nor any API route) ever transitions a plan to `active`. Unlike the Manufacturing BOM (which has a real `activateBillOfMaterial` function/route), there is no workaround. Quality's evidence screenshot is its dashboard with one real (draft) quality plan — real but weaker evidence than the other 8 new captures, since the metric-grid stays at zero.

## New approved screenshots (9)

All captured 2026-08-07, reviewed individually against the Phase 3 quality bar ("reads as a polished product screen, not a raw record-detail dump") before approval:

| Screenshot id | Module | Verdict |
|---|---|---|
| `accounting-dashboard` | Accounting | Approved — real hero, real receivables/payables framing (values are ₹0, honestly reflecting that no invoice/bill/journal exists yet — see bugs above) |
| `procurement-orders-list` | Procurement | Approved — real title, status badge, version; used the list view, not the detail view, after the detail view was captured and rejected for a raw-UUID "Document facts" panel |
| `manufacturing-dashboard` | Manufacturing | Approved — real non-zero "Planned work orders" metric |
| `projects-dashboard` | Projects | Approved — real non-zero "Overdue tasks" and "Contracted revenue" metrics |
| `assets-dashboard` | Assets | Approved — real "Total assets: 1" |
| `quality-dashboard` | Quality | Approved with a caveat — weaker evidence (all metrics at zero; see gap above) |
| `support-dashboard` | Support | Approved — real "Open tickets: 1" |
| `hr-payroll-dashboard` | HR & Payroll | Approved — real "Active employees: 3" |
| `point-of-sale-dashboard` | Point of Sale | Approved — real "Sales today: 1", "Revenue today: 1390.5", "Open shifts: 1" |

One capture was taken and rejected: `procurement-order-detail` (the `ProcurementResourceWorkspace` detail view) exposed raw, unstyled UUIDs for `branchId`/`companyId`/`supplierId`/`id` under a generic "Document facts" heading — the same defect class as the Phase 3 CRM opportunity-detail rejection. Not registered in `screenshots.ts`.

A secondary finding, fixed in the capture script itself: `ProcurementResourceWorkspace`'s detail view fetches its record client-side after the initial `networkidle` render, showing a transient "Loading record…" state that the first capture attempt caught mid-load. `capture-marketing-screenshots.mjs` now waits for that text to clear (with a timeout fallback) before every capture, not just a fixed delay — a more robust fix than Phase 4's `waitForTimeout(500)`, which happened to be enough for lazy-loaded images but not for this client-fetch race.

## Remaining gap

None. All 9 modules that lacked dedicated evidence in Phase 4 now have a real, approved screenshot. `packages/landing-content/src/modules.js` was updated to reference each module's new screenshot via `screenshots.primary`; `heroVariant` assignments were deliberately left unchanged from Phase 4's already-reviewed distribution (only the `screenshots` field was extended) to avoid reopening the hero-variant content/evidence consistency question Phase 4's decision log already resolved carefully — the new screenshots render in each module page's `ProductEvidenceSection` regardless of hero variant.

`apps/landing/tests/lib.test.mjs`'s existing regression test ("every module's referenced screenshot id actually belongs to that module") and the full `module-content.test.mjs`/`lib.test.mjs` suites were re-run after these changes — all pass.
