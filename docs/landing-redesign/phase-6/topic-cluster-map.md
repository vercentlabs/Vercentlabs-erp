# Search Cluster Ownership Map

For every cluster: hub, supporting pages, primary intent, commercial vs. informational, buyer stage, conversion path, and overlap risk.

## Cluster 1: ERP Selection

- **Hub**: `/resources/erp-buying-guide`
- **Supporting**: `/resources/erp-requirements-checklist`, `/resources/glossary` (erp, rbac, multi-company-erp, multi-tenant-saas)
- **Primary intent**: "how to choose ERP software" / "ERP requirements checklist"
- **Intent type**: Commercial (buying guide, checklist) + informational (glossary)
- **Buyer stage**: Evaluation
- **Conversion path**: buying guide → requirements checklist → `/book-demo`
- **Overlap risk**: Low. `/modules` (catalog) and `/resources/erp-buying-guide` (strategic sequencing question) target different intents — reviewed in `cannibalisation-review.md` item 7.

## Cluster 2: Manufacturing ERP

- **Hub**: `/resources/manufacturing-erp-guide`
- **Supporting**: `/modules/manufacturing`, `/workflows/plan-to-production`, `/industries/manufacturing`, glossary (bom, mrp, three-way-match)
- **Primary intent**: "manufacturing ERP software"
- **Intent type**: Informational (guide) + commercial (module/industry pages)
- **Buyer stage**: Awareness → Evaluation
- **Conversion path**: guide → module or workflow page → `/book-demo`
- **Overlap risk**: Reviewed against `/industries/manufacturing` in `cannibalisation-review.md` item 4 — different framing (software capability vs. buyer-company fit), confirmed distinct.

## Cluster 3: ERP Implementation

- **Hub**: `/resources/erp-implementation-checklist` (generic) and `/implementation` (Vercentlabs-specific) — a deliberate 2-hub cluster, not a conflict
- **Supporting**: `/resources/erp-migration-guide`
- **Primary intent**: "ERP implementation checklist" / "ERP data migration"
- **Intent type**: Informational, low direct commercial intent but high buyer-stage relevance (post-decision)
- **Buyer stage**: Decision → Implementation planning
- **Conversion path**: checklist/guide → `/implementation` (if evaluating Vercentlabs specifically) → `/book-demo`
- **Overlap risk**: Resolved by design — `resource-content.test.mjs` has a dedicated test asserting the checklist stays generic. See `cannibalisation-review.md` item 5.

## Cluster 4: Replace Spreadsheets

- **Hub**: `/resources/erp-vs-spreadsheets` (vendor-neutral education) and `/solutions/replace-spreadsheets` (Vercentlabs-specific solution) — 2 hubs, distinct intents
- **Supporting**: Homepage `PROBLEM_SECTION` (top-of-funnel pitch only, no dedicated metadata targeting this query)
- **Primary intent**: "ERP vs spreadsheets" / "replace spreadsheets with ERP software"
- **Intent type**: Informational (guide) + commercial (solution page)
- **Buyer stage**: Awareness (guide) → Evaluation (solution page)
- **Conversion path**: guide → solution page → `/book-demo`
- **Overlap risk**: Reviewed in `cannibalisation-review.md` item 3 — 3 pages touching the theme, confirmed 3 distinct intents.

## Cluster 5: ERP Terminology (Glossary)

- **Hub**: `/resources/glossary`
- **Supporting**: 11 standalone term pages, 16 index-only cards pointing to their real owning page
- **Primary intent**: definitional queries ("what is RBAC", "what is a bill of materials")
- **Intent type**: Purely informational
- **Buyer stage**: Awareness (mostly), some Evaluation (e.g. "multi-company ERP")
- **Conversion path**: term page → related module/workflow → `/book-demo` (soft, not pushed)
- **Overlap risk**: The cluster's core design principle IS anti-overlap — see `glossary-architecture.md`'s index-only-vs-standalone split, which exists specifically to avoid this cluster cannibalizing the workflow cluster.

## Cluster 6: Competitive Comparison

- **Hub**: `/compare`
- **Supporting**: `/compare/vercentlabs-vs-odoo`
- **Primary intent**: "Vercentlabs vs Odoo"
- **Intent type**: Commercial, high purchase-intent
- **Buyer stage**: Late evaluation / decision
- **Conversion path**: comparison → `/resources/erp-buying-guide` or `/resources/erp-requirements-checklist` → `/book-demo`
- **Overlap risk**: None — the only page targeting this specific query pair.

## Clusters NOT built this phase (documented gaps, not oversights)

- **Inventory management** / **procurement process**: real content already exists across `/modules/stock`, `/modules/procurement`, `/workflows/order-to-fulfilment`, `/workflows/procure-to-pay`, `/industries/distribution` — a dedicated resource-guide cluster would fragment, not strengthen, existing ownership. See `content-authority-strategy.md`.
- **Additional competitor comparisons** (Zoho, NetSuite, Dynamics 365, SAP, Oracle): no comparison built without the same live-verified-evidence standard applied to Odoo — see `comparison-policy.md`.
