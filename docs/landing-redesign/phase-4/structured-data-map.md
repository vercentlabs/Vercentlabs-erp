# Structured Data Map

All JSON-LD is built with the existing safe utilities from Phase 3 (`apps/landing/lib/seo/json-ld.ts`'s `jsonLdScriptProps`, which escapes `<` to prevent script-tag injection) — no new JSON-LD helper library was introduced.

## Decision: one `SoftwareApplication`, never one per module

The existing site-wide `SoftwareApplication` entity (declared once, `apps/landing/app/page.tsx`) is the only one on the site. Module pages emit `WebPage` with `isPartOf` pointing at it, not a separate `SoftwareApplication` per module. This overrides `information-architecture.md`'s older, less-specific suggestion of module-level `SoftwareApplication` entities, per this prompt's explicit instruction: modules are components of one product, not standalone products, and a search engine should never be given 12 different "applications" to reconcile against one company. See `decision-log.md` item 3.

## Per-route schema

| Route(s) | Schema types | Notes |
|---|---|---|
| `/modules/{slug}` (×12) | `WebPage` (with `isPartOf` → SoftwareApplication), `FAQPage` (only if the module has FAQs — all 12 do), `BreadcrumbList` (emitted by the shared `Breadcrumbs` component, not duplicated) | No fabricated ratings/reviews/pricing/offers anywhere |
| `/modules` | `CollectionPage` with `hasPart` listing all 12 module `WebPage` entries, `BreadcrumbList` | |
| `/product` | `FAQPage` (from the page's own FAQ set), `BreadcrumbList` | No dedicated WebPage/SoftwareApplication schema beyond what the root layout already emits site-wide |
| `/product/platform`, `/product/automation`, `/product/analytics`, `/product/mobile`, `/product/integrations`, `/security` | `BreadcrumbList`; `FAQPage` only on `/product/mobile` and `/security` (the only two with real FAQ content) | No `WebPage` entity added — the existing root-level `Organization`/`WebSite` schema plus page-level metadata (title/description/canonical) is sufficient for these; adding a redundant `WebPage` per page was judged unnecessary schema noise given `BreadcrumbList` and `FAQPage` already establish the page's identity and content |

## Root-level schema (unchanged from Phase 3)

`Organization` and `WebSite`, emitted once in `apps/landing/app/layout.tsx` — not duplicated on any new page.

## Validation

- `packages/landing-content/tests/module-content.test.mjs` verifies every module has FAQs (so the `FAQPage` branch is never silently empty) and that `capabilityGroups`/`connectedModules` reference real entities (so `hasPart`/relationship data feeding into any future richer schema stays accurate).
- Manually verified during Cycle 2 review: the SEO/AEO/GEO reviewer agent pulled live JSON-LD from a module page with FAQs, a platform page without FAQs, `/modules`, and a platform page, and checked for valid nesting and no fabricated fields — see `visual-review-log.md` for findings and `decision-log.md` for any resulting fixes.
- No `Review`, `AggregateRating`, `Offer`, or certification schema appears anywhere in this phase's work, consistent with the Evidence and Honesty Rules (none of these exist for the real product).
