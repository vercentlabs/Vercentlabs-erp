# Internal Link Graph

How Phase 6's new content (resources, glossary, comparisons) connects to the existing module/workflow/industry/solution graph, and what's enforced by `packages/landing-content/tests/internal-link-graph.test.mjs`.

## Graph shape

```
/resources (hub)
├── 6 cornerstone guides → module(s)/workflow(s)/related guide(s)/book-demo
│     erp-buying-guide → erp-requirements-checklist, erp-implementation-checklist, erp-vs-spreadsheets
│     erp-requirements-checklist → erp-buying-guide, erp-implementation-checklist
│     erp-implementation-checklist → erp-migration-guide, erp-buying-guide
│     erp-migration-guide → erp-implementation-checklist, erp-buying-guide
│     manufacturing-erp-guide → /modules/manufacturing, /modules/stock, /workflows/plan-to-production, erp-vs-spreadsheets, erp-buying-guide
│     erp-vs-spreadsheets → /modules/stock, /modules/sales, /modules/procurement, erp-buying-guide, manufacturing-erp-guide
└── /resources/glossary (index)
      └── 11 standalone terms → related module(s), 1 related workflow (where real), 1-3 related terms
            (erp, crm, mrp, bom, reorder-point-and-safety-stock, three-way-match,
             purchase-requisition, rbac, maker-checker, multi-tenant-saas, multi-company-erp)
      16 index-only terms → the one real existing page that covers them
            (routing/oee/wip → /modules/manufacturing; work-order → /workflows/plan-to-production;
             lead-to-cash/procure-to-pay → their real /workflows/ pages, not a duplicate glossary page;
             order-to-cash → /workflows/order-to-fulfilment; stock-ledger/lot-serial/cycle-count/
             available-to-promise → /modules/stock; rfq → /modules/procurement;
             capa/non-conformance → /modules/quality; depreciation → /modules/assets;
             sla → /modules/support)

/compare (index)
└── /compare/vercentlabs-vs-odoo → erp-buying-guide, erp-requirements-checklist, /book-demo,
                                    2 live odoo.com source links (SourceList)

/modules/[slug] (existing, extended this phase)
└── up to 1 related resource guide per module (getResourceGuidesForModule) — only 4 of 12
    modules have one (manufacturing, stock, sales, procurement), reflecting real relevance,
    not a forced backlink on every module page (enforced by a dedicated test)
```

## Inbound-link guarantee for every new route

- **Resource guides**: reachable from `/resources` (always fully enumerated there) and cross-linked to 1-2 sibling guides via `relatedResourceSlugs`. 4 of 6 guides also get an inbound link from a relevant module page.
- **Glossary standalone pages**: reachable from `/resources/glossary`'s alphabetical index (always fully enumerated) and from 1-3 related-term links on sibling standalone pages.
- **Glossary index-only entries**: no dedicated page to link to — the index card itself links straight to the real page (module or workflow) that covers the concept.
- **Comparison page**: reachable from `/compare` and from the new `/resources` hub's "Reference" section.

## Anti-mesh discipline

- No industry, solution, or module links to *every* module (existing Phase 5 test, still enforced).
- No module links to more than 2 resource guides (new Phase 6 test) — and at least one module genuinely has zero related guides, confirming `relatedModuleKeys` reflects real relevance rather than every guide being tagged onto every module for link-equity's sake.
- Glossary `relatedTerms` arrays are 1-3 entries each, never an exhaustive list of all 11 standalone terms.

## What's deliberately NOT linked

- Glossary terms do **not** get inbound links from module pages in this phase — module pages already link to industries/workflows/solutions/1 resource guide; adding glossary backlinks too risked the "related pages" section becoming a giant undifferentiated link block, which `.claude/rules/landing-content.md`'s internal-link-quality rules explicitly warn against. This is a real, intentional gap, not an oversight — a candidate for Phase 7 if a future audit finds glossary pages are under-linked-to in practice (e.g., via real Search Console data).

## Enforcement

`packages/landing-content/tests/internal-link-graph.test.mjs` (10 tests, all passing) checks: every resource guide and standalone glossary entry has at least one real outbound link; no all-to-all mesh on module/industry/solution/resource-guide relationships; the comparison page's linked resource-guide slugs are real; no glossary slug collides with a resource-guide slug. This is content-layer verification (the data itself); the E2E test suite (`apps/landing/tests/e2e/phase6-routes.spec.ts`) separately verifies the rendered pages' actual `<a href>` targets resolve to real, live routes.
