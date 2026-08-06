# Phase 4 Brief — Module and Platform Pages

Per `CLAUDE.md`'s roadmap: "4. Module and platform pages." Industry, solution, workflow, and implementation pages are Phase 5 — do not build those yet, even though some are linked from the homepage already (see "Links that currently 404" below).

## Source of truth

- `docs/landing-redesign/phase-1/product-intelligence.md` — module capability content, per-module evidence, Honest Limitations.
- `docs/landing-redesign/phase-1/information-architecture.md` — the intended URL structure and page inventory.
- `docs/landing-redesign/phase-1/seo-aeo-geo-architecture.md` — "one page owns one query family," direct-answer openings, FAQ requirements.
- `docs/landing-redesign/phase-3/homepage-content-specification.md` and `homepage-copy-rationale.md` — the tone, evidence-discipline, and content-testing pattern module pages should match.
- `packages/landing-content/src/modules.js` — already has real, evidence-grounded per-module content (`personas`, `painPoints`, `capabilityGroups`, `bestAngle`, `accentColor`) mechanically sourced from `@vercentlabs/shared-types`'s `ERP_MODULE_CATALOG`. **Module pages should consume this, not re-derive module facts.**

## Links that currently 404 — this phase's real scope

Every module tag on the homepage, footer, mega menu, and mobile nav already links to `/modules/{key}` for all 12 modules (CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) — none of these routes exist yet. This is Phase 4's primary deliverable.

The footer also links to platform pages that are Phase 4 scope: `/product/platform` (also the hero's secondary CTA), `/product/automation`, `/product/analytics`, `/product/mobile`, `/security`, `/product/integrations`.

**Explicitly NOT Phase 4** (exist as links today, but are Phase 5+ or later): `/about`, `/contact`, `/pricing`, `/implementation`, `/legal/privacy`, `/legal/terms`, `/industries/{slug}` (footer), `/workflows/lead-to-cash` (flagship-workflow section's "See the full workflow" link).

## What Phase 3 already built for you to compose with

- The full component library from Phase 2 plus this phase's marketing additions: `FaqAccordion`, `NumberedSteps`, `StickyMobileCta`, `TrackedCtaLink`, `ProductFrame`/`ProductScreenshot`/`ProductCallout`/`WorkflowConnector`.
- 5 real, approved product screenshots (`apps/landing/lib/product/screenshots.ts`) — 3 are CRM/Sales-specific (`crm-pipeline-board`, `crm-leads-list`, `sales-quotation-detail`, `sales-order-detail`) and 1 is Stock (`stock-overview`). Every other module (Accounting, Procurement, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) has **zero approved screenshots** — their module pages will need the honest empty-state pattern (`ProductScreenshot` renders nothing on public pages for an unapproved ID) until new screenshots are captured and approved. Plan a screenshot-capture pass as part of this phase's scope, following the exact process in `screenshot-capture-process.md` (same synthetic org, or a new one if a module needs data the current seed doesn't have — e.g. Manufacturing work orders, Quality inspections, Assets records).
- The `crm-opportunity-detail` capture exists but is **not** approved (exposes raw internal UUIDs) — a real candidate for a clean re-capture if a CRM module page wants an opportunity-detail screenshot; either re-capture cleanly or add a UI treatment that hides the raw ID fields behind a disclosure before re-capturing.
- The `FAQPage` JSON-LD pattern (`app/page.tsx`) — generate structured data directly from the same content a page's visible FAQ accordion renders; do not write separate copy for markup vs. display.
- The content-testing pattern (`packages/landing-content/tests/landing-content.test.mjs`) — extend it with per-module-page assertions (every module page references a real module key, every internal link resolves, no banned overclaiming phrases) rather than relying on manual review.

## Known follow-ups from Phase 3's review cycles (carry into this phase if in scope)

1. **Mid-page section monotony** (brand review finding, deprioritized in Phase 3) — module pages are a good place to apply the line/rectangle/dot diagram vocabulary between text-heavy sections, now that there's a concrete need (module pages will have more consecutive text sections than the homepage).
2. **Repeated inline "label + description" grid pattern** (frontend-quality finding) — `app/page.tsx` repeats the same raw JSX shape four times instead of a shared component. If module pages need the same pattern, extract a `LabeledItemGrid`/`FeatureGrid` primitive into `components/ui/` now rather than propagating the duplication to a fifth+ call site.
3. **`CRM_CAPTURE_FORM_KEY` production wiring** — the local/dev value points at the synthetic demo org. Before any real deployment (this phase or later), confirm with the Vercentlabs team which real organization/form should receive production leads, and set the production environment variable accordingly — this is a deployment-configuration task, not a code change.
4. **Automated accessibility/performance tooling** — no axe-core scan or Lighthouse run is wired into CI yet (see `accessibility-validation.md`/`performance-validation.md`). Worth adding once there are enough real pages (this phase adds ~18) to make the tooling investment pay off.

## Testing expectations for Phase 4

- Extend `landing-content.test.mjs` with module/platform-page-specific content-integrity assertions (same discipline as the homepage: real module keys, resolvable internal links, no banned phrases).
- Extend `visual-review.spec.ts`'s viewport matrix to cover at least one representative module page and one platform page at all required viewports — don't just re-test the homepage.
- Every new page needs its own `product-evidence-register.md`-style traceability (or an addendum to the existing one) — do not add a capability claim to a module page without tracing it to `product-intelligence.md`.
- Follow the same build → boot → screenshot → diagnose → fix → rebuild discipline established in Phases 2-3. Source review and passing tests are not enough — this has now been proven three phases in a row (CSP/prefetch/backdrop-filter/Tailwind-syntax bugs in Phase 2; blank-thank-you-page/empty-hero/320px-header/phone-mobile-misdiagnosis in Phase 3), and there is no reason to expect Phase 4 is exempt.

## Do not

- Build industry, solution, or workflow pages (Phase 5) — even though the homepage's flagship-workflow section links to `/workflows/lead-to-cash` today, leave that link 404ing until Phase 5, per the roadmap's explicit phase boundary.
- Redesign the ERP application itself.
- Fabricate screenshots, testimonials, or capability claims not traceable to `product-intelligence.md`.
- Push to a remote — commit locally only, as in every prior phase.
