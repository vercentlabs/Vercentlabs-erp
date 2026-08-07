# Glossary Architecture

## Controlled, not hundreds of pages

27 terms total, 11 standalone pages. The brief's own example list named 28 terms (Reorder Point and Safety Stock as 2 separate entries); this glossary combines them into 1 standalone page (`reorder-point-and-safety-stock`) since they're the same operational decision viewed from two angles — a deliberate, documented count reduction, not a missed term.

## The quality gate: standalone vs. index-only

A term gets its own `/resources/glossary/{slug}` page only if it can support the full 9-part shape (`definition`, `whyItMatters`, `howItWorks`, `example`, `relatedTerms`, `relatedModules`, `vercentlabsHandling`, `relatedWorkflow`, `sources`/`lastReviewedAt`) **and** connects meaningfully to a real, evidenced Vercentlabs capability. If either condition fails, the term stays index-only: a real short definition on `/resources/glossary`, linking straight to whichever existing page (a module or workflow) already covers it — never a thin, half-filled standalone page.

## Why "Lead to Cash" and "Procure to Pay" are index-only, not standalone

Both already have a full, real page at `/workflows/lead-to-cash` and `/workflows/procure-to-pay` — a standalone glossary page would either duplicate that content or (worse) present a shallower, competing definition of the same concept. This is the single clearest illustration of the quality gate working as designed: these are exactly the kind of terms that *would* qualify content-wise, but lose to a real prior-existing page on the differentiation test. See `.claude/rules/landing-content.md` rule 3 and `cannibalisation-review.md` item 2.

## The 11 standalone pages and why each earns it

| Term | Real Vercentlabs mechanic cited |
|---|---|
| ERP | The 12-module + shared-platform architecture itself |
| CRM | Won-opportunity → quotation source-record handoff |
| MRP | Manual-trigger limitation, stated honestly |
| BOM | One-active-BOM-per-item enforcement |
| Reorder Point & Safety Stock | Real low-stock dashboard + honest no-auto-requisition limitation |
| Three-Way Match | Real 2/3/4-way matching + mandatory override reason |
| Purchase Requisition | Real draft→submit→approve→execute state machine |
| RBAC | Real ~12 seeded roles + scoped/time-bound assignments |
| Maker-Checker | Real self-approval blocks across HR/Assets/Accounting/Projects |
| Multi-Tenant SaaS | Real organisation/company/branch/department isolation hierarchy |
| Multi-Company ERP | Real consolidation + intercompany posting capability |

Every one of these traces to a fact already established (and cited) elsewhere in the content model (`workflows.js`, `solutions.js`) — no new, unverified product claim was invented for glossary copy specifically.

## The 16 index-only terms and their real target page

Routing, Work Order → `/modules/manufacturing` / `/workflows/plan-to-production`; Lead to Cash, Procure to Pay → their real workflow pages; Order to Cash → `/workflows/order-to-fulfilment`; Available to Promise, Stock Ledger, Lot/Serial Tracking, Cycle Count → `/modules/stock`; RFQ → `/modules/procurement`; CAPA, Non-Conformance → `/modules/quality`; OEE, WIP → `/modules/manufacturing`; Depreciation → `/modules/assets`; SLA → `/modules/support`.

## Testing

`glossary-content.test.mjs` (9 tests) enforces: controlled size bounds, exactly 11 standalone pages, unique term names, full 9-part shape on every standalone entry, `relatedModules`/`relatedWorkflow` resolving to real content, `relatedTerms` never self-referencing, `getGlossaryTerm` returning `null` (not throwing) for unknown/index-only slugs, index-only `relatedRoute` values matching a real route-shape pattern, and — as a permanent regression guard — that Lead to Cash and Procure to Pay specifically stay index-only pointing at their real workflow routes.
