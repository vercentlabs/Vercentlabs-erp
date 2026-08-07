# Route and Page Inventory — Phase 5

19 new pages, on top of Phase 4's 32 (product/platform/modules) and Phase 3's homepage/demo journey. Total indexable routes after this phase: 52 (excluding `/design-system`, `/book-demo/thank-you`, which stay `noindex`).

## Industries (5 pages)

| Route | Source | ICP | Priority |
|---|---|---|---|
| `/industries` | index (composed) | — | P0 |
| `/industries/manufacturing` | `LANDING_INDUSTRIES[0]` | `manufacturing` | P0 |
| `/industries/distribution` | `LANDING_INDUSTRIES[1]` | `distribution-retail` (shared) | P0 |
| `/industries/retail` | `LANDING_INDUSTRIES[2]` | `distribution-retail` (shared) | P0 |
| `/industries/professional-services` | `LANDING_INDUSTRIES[3]` | `professional-services` | P1 |

Distribution and retail deliberately share one ICP (see `decision-log.md` item 2) — this is a presentation-layer split into 2 pages, not 2 independently researched buyer segments.

## Solutions (6 pages)

| Route | Paired platform page |
|---|---|
| `/solutions` | index (composed) |
| `/solutions/replace-spreadsheets` | `/product` |
| `/solutions/connect-business-operations` | `/product/platform` |
| `/solutions/multi-company-management` | `/product/platform` |
| `/solutions/workflow-automation` | `/product/automation` |
| `/solutions/real-time-business-reporting` | `/product/analytics` |

This tier is a deliberate IA amendment — see `decision-log.md` item 1.

## Workflows (7 pages)

| Route | Modules | New this phase? |
|---|---|---|
| `/workflows` | index (composed) | — |
| `/workflows/lead-to-cash` | crm, sales, accounting | Extended with page-level fields |
| `/workflows/procure-to-pay` | procurement, accounting | Extended with page-level fields |
| `/workflows/order-to-fulfilment` | sales, stock, accounting | **New workflow entry** |
| `/workflows/plan-to-production` | manufacturing, stock | Extended with page-level fields |
| `/workflows/project-to-profitability` | projects, procurement, accounting, hr-payroll | Extended with page-level fields (added `procurement`) |
| `/workflows/hire-to-payroll` | hr-payroll, accounting | **New workflow entry** |

6 of `LANDING_WORKFLOWS`'s 12 entries remain unrouted this phase (quote-to-order, inventory-to-replenishment, retail-checkout-to-inventory, physical-goods-quality-gate, asset-acquisition-to-disposal, support-ticket-resolution, payroll-to-books, returns-and-reverse-logistics, tenant-onboarding-and-entitlement — 9 total minus the 3 promoted this phase leaves the original 12 minus 6 routed = still fully accounted for, no slug lost). Optional workflows named in the governing prompt (ticket-to-resolution, inspection-to-capa) were deliberately not built — see `decision-log.md` item 3.

## Implementation (1 page)

| Route | Notes |
|---|---|
| `/implementation` | 8-phase journey; migration integrated as the Data Migration phase's expanded section, not a separate `/implementation/migration` route — see `decision-log.md` item 4. |

## Cross-cutting changes to existing pages

- `app/book-demo/page.tsx`: `searchParams` now resolves `module`, `industry`, `workflow`, `solution` (priority order: module → industry → workflow → solution).
- `app/modules/[slug]/page.tsx`: "Related pages" section extended with up to 2 industries, 2 routed workflows, 2 solutions referencing that module.
- `app/sitemap.ts`: extended with all 19 new routes.
- `components/layout/footer.tsx`: new "Industries" column (4 links + index); `COMPANY_LINKS` gains Solutions and Workflows.
- `packages/landing-content/src/navigation.js`'s `PRIMARY_NAV`: Solutions and Workflows added as top-level items (Industries already existed, pointing at what was previously a 404); Implementation added as a `Product` submenu child.

## Explicitly not built this phase

Full resource centre, large glossary, competitor-comparison pages (Phase 6 scope), final CRO optimization pass, ERP application changes (2 real, pre-existing `apps/web` bugs found and documented, not fixed — see `docs/landing-redesign/phase-5/product-evidence-update.md`).
