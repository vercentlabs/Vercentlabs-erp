# Industry Content Architecture

## Schema

`packages/landing-content/src/industries.js` exports `LANDING_INDUSTRIES` (4 entries) matching the `IndustryPage` interface in `index.d.ts`: `slug`, `icpSlug`, `name`, `directDefinition`, `operatingModel`, `challenges[]`, `moduleStack[]` (`{moduleKey, role}`), `primaryWorkflowSlug?`, `buyerRoleSlugs[]`, `evidenceHighlights[]`, `screenshots{primary?}`, `faqs[]`, `metaDescription`, `searchIntent`, `conversion{heading, ctaLabel}`.

## Composition, not duplication

Every industry page composes real content already built elsewhere — it never re-explains a module's capabilities inline:

- `moduleStack` links to `/modules/{key}` for depth (via `RecommendedModuleStack`).
- `primaryWorkflowSlug` links to a real `/workflows/{slug}` page.
- `buyerRoleSlugs` resolve against `BUYER_ROLES` (shared with workflow pages, not industry-specific data).
- `screenshots.primary` reuses an approved screenshot from `lib/product/screenshots.ts` — no industry-specific captures were taken.

## The distribution/retail split (see `decision-log.md` item 2 for the full reasoning)

`LANDING_ICPS` (Phase 1 buyer research, `packages/landing-content/src/icps.js`) has exactly 3 entries. The governing prompt for this phase asked for 4 industry pages, splitting "distribution-retail" into two. Rather than fabricate a 4th independently-researched buyer segment, both `/industries/distribution` and `/industries/retail` set `icpSlug: "distribution-retail"` and share that ICP's trigger-event/buyer-committee framing, while each gets:

- A distinct `operatingModel` narrative (distribution: warehouse-to-warehouse stock visibility and procurement-driven replenishment; retail: point-of-sale-to-inventory real-time deduction and shift/cash control).
- A distinct `moduleStack` emphasis (distribution leads with Procurement; retail leads with Point of Sale).
- A distinct `primaryWorkflowSlug` in principle, though both currently resolve to `order-to-fulfilment` — the closest routed workflow to either narrative; documented as an acceptable shared anchor since the content differentiation happens at the operating-model and module-stack level, the same reasoning Phase 4's `page-differentiation-matrix.md` used for hero-variant sharing across modules with similar evidence strength.
- A distinct approved screenshot (`procurement-orders-list` vs. `point-of-sale-dashboard`).

`industry-content.test.mjs`'s "distribution and retail intentionally share one ICP" test asserts the shared `icpSlug` while asserting the `operatingModel` and `moduleStack` are NOT identical — codifying this as an intentional, checked design decision rather than an accident.

## Evidence discipline

Every `evidenceHighlights` line is copied verbatim or near-verbatim from `product-intelligence.md`'s "Publicly Usable Product Evidence" list — no new claims were authored for this phase. Every `challenges` line traces to `icp-and-buyer-map.md`'s "Core pain points" for the matching ICP. FAQs address the real "Honest Limitations" callouts relevant to that industry (e.g. retail's FAQ on POS not auto-creating a Sales order/invoice, professional-services' FAQ on Projects having no native mobile presence).

## Buyer-role weaving

Each industry names 2-3 `buyerRoleSlugs` (from `BUYER_ROLES`, `packages/landing-content/src/buyer-roles.js`) rendered via the shared `RolePerspective` component — not a new dedicated page per role, per the governing prompt's explicit instruction.
