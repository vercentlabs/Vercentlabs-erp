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

## Summary

7 candidate pairs reviewed; 1 real collision found and fixed (item 1), 1 pre-empted by design decision (item 2), 5 reviewed and confirmed as legitimately distinct or complementary (items 3-7, with one minor cross-linking enhancement opportunity noted for later, not urgent). No route was deleted or merged as a result of this review — every page reviewed here earns its place with a distinct, real intent.
