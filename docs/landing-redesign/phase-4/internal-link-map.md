# Internal Link Map

## Link graph rules

Per the brief: no all-to-all linking, no repetitive keyword-stuffed anchors, no links to routes that don't exist, no links to noindex routes. Every internal link on a new page traces to real content in `packages/landing-content` — nothing is a hand-typed URL string scattered through JSX (module links are always built from `getLandingModule(key)`/`LANDING_MODULES`, platform links from real route constants).

## Module → module (cross-module relationships)

Sourced directly from each module's `connectedModules` field (the same data rendered in the "How it connects" section, not a separate link-only list) — every relationship carries real, specific relationship text (see `module-content-architecture.md`), not a generic "integrates with" label:

```
accounting     → sales, procurement, assets
procurement    → accounting, stock, quality
sales          → crm, accounting, stock
crm            → sales, support
stock          → manufacturing, point-of-sale, sales
manufacturing  → stock, quality, accounting
projects       → procurement, sales, support
assets         → procurement, stock, support, accounting
point-of-sale  → stock, sales
quality        → procurement, manufacturing, stock, sales
support        → crm, sales, assets, projects, quality
hr-payroll     → accounting, projects
```

Each module page's "Related pages" section additionally links to `/product` and `/modules` (always), plus up to 4 of its connected modules (deduplicated with the "How it connects" section's own links — both point to the same pages, which is intentional: a buyer scanning to the bottom of a long page shouldn't have to scroll back up to find the module links again).

## Module → platform

Every module page's hero includes a secondary "Explore the Platform" CTA linking to `/product/platform`. The Governance section on every module page explicitly says "Full platform-wide security architecture is covered on the security page" without a repeated inline link spam — the security page itself is reachable from the header/footer on every page, so this is a deliberate choice not to duplicate that link a 13th time.

## Platform → module

Every platform page's "Modules built on this capability" section links to real modules via `connectedModuleKeys` (see `platform-page-specification.md`'s table) — sourced from `packages/landing-content/src/platform-pages.js`, not invented per page.

## Everything → conversion

Every module page's primary CTA is `/book-demo?module={slug}` (module-specific context). Every platform page's primary CTA is plain `/book-demo` (no module context — platform pages aren't about one module). The header/footer's global CTA remains plain `/book-demo`, unchanged from Phase 3.

## What deliberately does NOT link out

- No module or platform page links to `/industries/*` or `/workflows/*` — those routes don't exist yet (Phase 5). The flagship-workflow reference on the homepage (`/workflows/lead-to-cash`) was already left 404ing by design in Phase 3 and remains untouched.
- The footer's "Industries" column was removed this phase specifically because it linked to non-existent `/industries/*` routes on every single page site-wide, including all 32 new pages — see `decision-log.md` item 4.
- No link to `/design-system` (noindex, internal review tool only) appears on any public page.

## Validation

- `packages/landing-content/tests/module-content.test.mjs`: every `connectedModules.moduleKey` and `connectedModuleKeys` entry resolves to a real module; every platform/product-overview/modules-index `primaryCta.href` resolves against a hand-maintained `KNOWN_ROUTES` set (kept in sync with `apps/landing/app/` by convention).
- `apps/landing/tests/e2e/module-routes.spec.ts`: live-crawls confirm `/modules` links to all 12 real module pages, and a full Playwright regression pass found zero console/network errors across every new route (which would surface a broken `next/link` prefetch 404, per the pattern Phase 2 established for catching this class of bug).
