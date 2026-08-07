# Workflow Content Architecture

## Schema

`packages/landing-content/src/workflows.js`'s `LANDING_WORKFLOWS` (12 entries total, unchanged shape at the base level: `slug`, `name`, `modules[]`, `summary`, `iaPriority`) is extended for exactly the 6 workflows this phase routes (`ROUTED_WORKFLOW_SLUGS`) with the full page-level structure: `trigger`, `participants[]`, `sequence[]` (`{step, moduleKey, detail}`), `automatedActions[]`, `approvals[]`, `exceptions[]`, `visibility[]`, `businessValue[]`, `faqs[]`, `screenshotId?`. The other 6 entries keep their original minimal shape — still real, still consumed by `getWorkflowsForModule()` for module-page cross-links, just not given a dedicated page this phase.

## Two new workflow entries

`order-to-fulfilment` and `hire-to-payroll` did not exist in `LANDING_WORKFLOWS` before this phase. Neither is invented:

- **`order-to-fulfilment`** is explicitly named as a "relevant workflow" for ICP 2 in `icp-and-buyer-map.md` (written in Phase 1, before any workflow-routing decision was made) — this phase simply builds the page Phase 1 already anticipated. Content is grounded in `product-intelligence.md`'s Sales module profile and Cross-Module Workflow 1 (Quote-to-Cash)'s back half, with the honest limitation ("standard sales-order fulfillment does not yet post an automatic stock deduction") stated explicitly in the `exceptions` field, not glossed over.
- **`hire-to-payroll`** is grounded in the HR & Payroll module profile's full capability sequence (workforce structure → attendance/leave → compensation → payroll run → approval → payslip), broader than the pre-existing `payroll-to-books` entry (which starts at attendance, not at employee creation) and named to match the governing prompt's exact wording rather than the closer-but-different `icp-and-buyer-map.md` phrase "hire-to-retire" (which would imply termination/offboarding content this phase doesn't have evidence for).

## `project-to-profitability`'s `modules` array was corrected, not just extended

While building the sequence's "Procurement actuals" step, the workflow's own `modules` array (`["projects", "accounting", "hr-payroll"]`) turned out to be missing `procurement` — a real gap versus `product-intelligence.md`'s actual Cross-Module Workflow 7 ("Billable Project Delivery": Projects → Procurement → Sales → Accounting). `workflow-content.test.mjs`'s "every sequence step's moduleKey ... appear[s] in the workflow's own modules array" test caught this immediately (a real, useful test catching a real content-accuracy gap, not a false positive) — fixed by adding `procurement` to the array, which also means Procurement's module page now correctly cross-links to this workflow via `getWorkflowsForModule()`.

## Why `HowTo` schema was not used

Evaluated and deliberately rejected for all 6 workflow pages: `HowTo` schema is for step-by-step instructions a user manually follows (a recipe, an assembly guide). These pages describe a cross-module business process the *software* executes for an organisation — closer to a system/process description than a tutorial. Forcing `HowTo` would be schema misuse for a superficial rich-result gain. `WebPage` + `FAQPage` + `BreadcrumbList` (the same pattern as every other page type) is used instead — see `decision-log.md` item 5.

## Deliberately skipped optional workflows

The governing prompt allowed, but did not require, `ticket-to-resolution` (matches the existing `support-ticket-resolution` entry) and `inspection-to-capa` (no exact existing match — `physical-goods-quality-gate` is adjacent but narrower). Both were skipped this phase — see `decision-log.md` item 3 for the reasoning (6 required workflows plus depth and review-cycle time were judged higher-value than 2 more thin pages).
