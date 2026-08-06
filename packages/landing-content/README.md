# @vercentlabs/landing-content

Typed, framework-free content foundation for the Vercentlabs marketing site (`apps/landing`, scaffolded in Phase 2 of the landing-redesign programme). No React/Next.js dependency — this package is pure data plus small pure functions, following the same convention as `@vercentlabs/config`.

This exists so that marketing module names, descriptions, and colors stay mechanically in sync with the ERP's real module catalog (`@vercentlabs/shared-types`'s `ERP_MODULE_CATALOG`) instead of drifting as a hand-duplicated list — a direct GEO/SEO requirement (see `docs/landing-redesign/phase-1/seo-aeo-geo-architecture.md`, "consistent entities").

## What's here

- `modules.js` — the 12 modules + Shared Platform, enriched with marketing fields (personas, pain points, capability groups, best angle, accent color, nav group) on top of the canonical `key`/`name`/`description` from `@vercentlabs/shared-types`.
- `workflows.js` — the 13 evidenced cross-module workflows from `docs/landing-redesign/phase-1/product-intelligence.md`.
- `icps.js` — the 3 primary ICPs from `docs/landing-redesign/phase-1/icp-and-buyer-map.md`.
- `navigation.js` — the mega-menu group structure and primary/secondary CTA definitions from `docs/landing-redesign/phase-1/information-architecture.md` and `conversion-architecture.md`.
- `metadata.js` — site-wide metadata constants (org identity, title pattern, category/promise lines) from `docs/landing-redesign/phase-1/positioning-and-messaging.md`.
- `tokens.js` — design tokens implementing the "Control Surface" creative direction (`docs/landing-redesign/phase-1/creative-direction.md`).

## A note on module accent colors

Only 4 of the 12 modules (CRM, Sales, Procurement, Accounting) have a real, dedicated accent color in the live product today (`apps/web/src/app/enterprise-modules.css`). Those 4 are reused verbatim here. The other 8 modules are assigned **new, landing-original** colors in the same palette family — they are explicitly marked `sourcedFromProduct: false` in `modules.js` and must not be described as "the product's colors" in copy. Every accent color should be verified for WCAG AA contrast against both the off-white canvas and any on-dark usage before shipping (see `phase-2-brief.md`).

## Status

This is a Phase 1 foundation, not a finished content system. It is intentionally minimal — enough structure for Prompt 2 to scaffold navigation/components against, not full page copy (that's Prompts 3-6).
