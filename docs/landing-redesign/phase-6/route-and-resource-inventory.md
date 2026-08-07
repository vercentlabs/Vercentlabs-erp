# Route and Resource Inventory

Every indexable route added in Phase 6, its content source, and its `CONTENT_FRESHNESS` key. Cross-reference `apps/landing/app/sitemap.ts` for the authoritative generated list — this table is a human-readable snapshot, not a second source of truth.

## Resource hub (9 routes)

| Route | Source | Type |
|---|---|---|
| `/resources` | `resources.js` (categorized index) | Hub |
| `/resources/erp-buying-guide` | `resources.js` | Cornerstone guide |
| `/resources/erp-requirements-checklist` | `capability-registry.js` (bespoke interactive page) | Cornerstone guide |
| `/resources/erp-implementation-checklist` | `resources.js` | Cornerstone guide |
| `/resources/erp-migration-guide` | `resources.js` | Cornerstone guide |
| `/resources/manufacturing-erp-guide` | `resources.js` | Cornerstone guide |
| `/resources/erp-vs-spreadsheets` | `resources.js` | Cornerstone guide |
| `/resources/glossary` | `glossary.js` (27-term index) | Index |
| `/resources/feed.xml` | `resources.js` + `comparisons.js` (route handler) | RSS feed |

## Glossary standalone pages (11 routes)

`erp`, `crm`, `mrp`, `bom`, `reorder-point-and-safety-stock`, `three-way-match`, `purchase-requisition`, `rbac`, `maker-checker`, `multi-tenant-saas`, `multi-company-erp` — all under `/resources/glossary/{slug}`, all from `glossary.js`.

16 further glossary terms are index-only (no dedicated route) — see `glossary-architecture.md`.

## Compare (2 routes)

| Route | Source |
|---|---|
| `/compare` | `comparisons.js` (index) |
| `/compare/vercentlabs-vs-odoo` | `comparisons.js` |

## Machine-readable, non-page routes (1)

| Route | Purpose |
|---|---|
| `/llms.txt` | Plain-text canonical-route index, generated at request time |

## Total route count

- **Before Phase 6**: 52 indexable routes (homepage, 12 modules, 6 platform pages, 4 industries, 5 solutions, 6 workflows, implementation, plus non-indexable book-demo/thank-you/design-system).
- **Added in Phase 6**: 22 new indexable routes (9 resource-hub + 11 glossary standalone + 2 compare), plus `/llms.txt` and `/resources/feed.xml` (both real content, neither counted as a traditional "page" — `llms.txt` isn't HTML and isn't in `sitemap.xml`; the RSS feed is a machine-readable index of already-indexable pages, also not separately sitemapped).
- **Total indexable routes after Phase 6**: 74.

This scale doesn't justify sitemap segmentation — see `freshness-and-sitemap-policy.md`'s explicit reasoning for staying with one `sitemap.xml`.
