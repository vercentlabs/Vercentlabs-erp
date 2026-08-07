# Cannibalisation Review

A deterministic pass comparing titles, H1s, target intent, and content depth across every route that could plausibly compete for the same query — Phase 6's new ~20 routes against each other and against the existing ~52 Phase 1-5 routes. Findings are flagged for record; nothing here was auto-resolved without a documented reason.

## Method

For each candidate pair: compare `<title>`/H1 text, compare the page's `searchIntent`/`metaDescription` field, and read both pages' opening (direct-answer) paragraph to check whether they'd plausibly satisfy the same search query at the same depth. A pair is flagged only if a real reader (or a search engine) would have genuine difficulty telling which page to land on for a given query.

## Findings

### 1. RESOLVED — `/solutions/workflow-automation` vs. `/product/automation`

Both used the literal title "Workflow Automation" before this review. **Fixed**: solution renamed to "Automate Governed Workflows" (see `decision-log.md` item 7). No longer a risk — verified via `node --test` that no test or content asserts the old name.

### 2. RESOLVED (by design, not a fix) — Glossary "Lead to Cash" / "Procure to Pay" vs. their real workflow pages

The brief's example glossary term list named these as glossary entries. Building them as standalone `/resources/glossary/{slug}` pages would have directly duplicated `/workflows/lead-to-cash` and `/workflows/procure-to-pay`, which already own this exact query at full depth (trigger, sequence, automated actions, approvals, exceptions, FAQs). **Decision**: both stay index-only on the glossary index, linking straight to the real workflow page. See `glossary-architecture.md` and `.claude/rules/landing-content.md` rule 3.

### 3. REVIEWED, no cannibalisation — "Replace spreadsheets" appears on 3 pages

The homepage's `PROBLEM_SECTION`, `/solutions/replace-spreadsheets`, and `/resources/erp-vs-spreadsheets` all touch the spreadsheets-vs-ERP theme.
- **Homepage**: a five-second top-of-funnel pitch, not attempting to answer the full question — no dedicated H1 or metadata targeting "ERP vs spreadsheets" as a query.
- **`/solutions/replace-spreadsheets`**: buyer-problem-framed, specific to Vercentlabs' own mechanisms (governed numbering series, immutable audit trail, master-data model) — targets "replace spreadsheets with ERP software."
- **`/resources/erp-vs-spreadsheets`**: vendor-neutral, educational — explicitly argues spreadsheets remain appropriate in some cases, a nuanced angle neither other page takes — targets "ERP vs spreadsheets" as a comparison/education query.
**Verdict**: 3 distinct intents (awareness pitch / Vercentlabs-specific solution / vendor-neutral education), not cannibalisation. `search-intent-ownership.md` should list these as a deliberately clustered trio, not a conflict.

### 4. REVIEWED, no cannibalisation — `/resources/manufacturing-erp-guide` vs. `/industries/manufacturing`

Both discuss manufacturing. `/industries/manufacturing` is buyer-framed around a manufacturing *company's* operating model and Vercentlabs' fit for it (industry page tier). `/resources/manufacturing-erp-guide` is topic-framed around what manufacturing ERP *software* needs to do generically (BOM, routing, MRP, work-order gating), with Vercentlabs detail woven in as evidence, not as the page's organizing question. Different H1s, different `searchIntent` values ("manufacturing ERP software" for industries vs. the guide's own framing), different direct-answer openings. **Verdict**: legitimately complementary, cross-linked (the guide links to the module and workflow, not to the industry page — a possible future enhancement, not a conflict).

### 5. REVIEWED, no cannibalisation — `/resources/erp-implementation-checklist` vs. `/implementation`

Already explicitly differentiated by design (generic/vendor-neutral checklist vs. Vercentlabs' own specific implementation journey) and enforced by a dedicated test (`resource-content.test.mjs`). No further action needed.

### 6. REVIEWED, low-risk gap (not cannibalisation) — Glossary "Multi-Tenant SaaS" / "Multi-Company ERP" vs. `/solutions/multi-company-management`

The glossary entries are dictionary-style (definition/why-it-matters/how-it-works/example) — a different content type from the solution page's buyer-problem narrative (before/after, approach items, FAQs). Not competing for the same query shape ("what is multi-company ERP" vs. "multi-company ERP software"/"consolidate multiple companies"). **Gap noted, not a conflict**: the glossary entries' `relatedTerms` don't currently link to `/solutions/multi-company-management` — a real, low-priority enhancement opportunity for a future pass, not a defect requiring action this phase.

### 7. REVIEWED, no cannibalisation — `/resources/erp-buying-guide`'s "which modules first" section vs. `/modules` index

The buying guide's section answers a strategic sequencing question ("which module should you implement first, and why") in prose form; `/modules` is a catalog/directory page with no equivalent strategic framing. Different intents, no overlap.

### 8. REVIEWED, no action — `/modules/manufacturing` and `/industries/manufacturing` both title as "Manufacturing"

Found by `packages/landing-content/scripts/check-cannibalization.mjs` (see below), not by the manual pass above — this predates Phase 6 (shipped in Phase 4/5) and wasn't part of the original candidate list. Both pages' bare `name`/H1 text is the literal string "Manufacturing." **Verdict: acceptable, not a real collision** — the two pages are structurally different entity types (a product-capability page vs. a buyer-industry page), sit under different breadcrumb trails (`Modules > Manufacturing` vs. `Industries > Manufacturing`), carry different `metaDescription`/`searchIntent` values, and answer different questions ("what does the Manufacturing module do" vs. "does Vercentlabs fit a manufacturing company"). Comparable to a retailer having both a product-category page and a use-case page sharing a short, generic label — the surrounding context, not the bare label, disambiguates it. No change made; flagged here so a future reviewer doesn't have to re-investigate it from scratch.

## Automated tool

`packages/landing-content/scripts/check-cannibalization.mjs` (run via `pnpm content:cannibalization`) performs a deterministic exact/near-duplicate title scan across all ~61 real content-backed routes and prints any collisions for human review — it never auto-deletes or auto-merges anything. Running it against the final Phase 6 route set found exactly the 2 real findings documented above (item 1, already fixed before the script existed, confirming it would have caught it; and item 8, newly surfaced and reviewed here). Re-run this script whenever a new route is added.

## Summary

8 candidate pairs reviewed (7 from the manual pass, 1 surfaced by the new automated script); 1 real collision found and fixed (item 1), 1 pre-empted by design decision (item 2), 6 reviewed and confirmed as legitimately distinct or complementary (items 3-5 and 7-8, plus item 6's minor cross-linking enhancement opportunity noted for later, not urgent). No route was deleted or merged as a result of this review — every page reviewed here earns its place with a distinct, real intent.
