# Accessibility Validation — Phase 4

Target: WCAG AA minimum (CLAUDE.md), WCAG 2.2 AA per this phase's brief. Manual/code-review-based plus targeted Playwright assertions, same discipline as Phase 3 — no automated axe-core scan is wired into CI yet (a standing gap, not new to this phase).

## Heading structure

Every one of the 19 new routes has exactly one real `<h1>`, enforced by an automated Playwright assertion (`apps/landing/tests/e2e/module-routes.spec.ts`, `toHaveCount(1)` on every module and platform route) — not just asserted, verified live against the booted production server. `ModuleHero`'s `Heading level="display"` renders a real `<h1>` (unchanged component from Phase 3); every section below it uses `SectionHeader`'s `<h2>`.

**Found and flagged by the SEO/AEO/GEO review**: `ModuleWorkflow`'s "Approvals"/"Automated actions"/"Connected modules in this workflow" sub-headings render as `<h4>` directly under the section's `<h2>`, skipping `<h3>` — a heading-nesting gap, not a WCAG AA failure on its own, but worth fixing for consistency. See `decision-log.md` for the fix status.

## Breadcrumbs

Every new route renders the existing, Phase-3-built `Breadcrumbs` component (`apps/landing/components/layout/breadcrumbs.tsx`) — `nav[aria-label="Breadcrumb"]`, an `<ol>`, `aria-current="page"` on the final (non-link) crumb. **Found and flagged by the SEO/AEO/GEO review**: the breadcrumb trail omits a "Home" first entry on every one of the 19 new routes — a real gap versus the documented `Home / Modules / {Module}` pattern; the fix belongs at the `Breadcrumbs` component level (or its callers) so it can't regress per-route. See `decision-log.md`.

## Disclosures

`CapabilityGrid`'s capability lists and the FAQ accordion (`FaqAccordion`, reused unchanged from Phase 3) both render all content in server HTML — capability lists are always-visible `<ul>`s (no accordion/collapse, since a module's 5-7 groups aren't numerous enough to need progressive disclosure per the brief's own guidance), and FAQs use native `<details>/<summary>`, keyboard-operable and screen-reader-accessible by construction, unchanged from Phase 3.

## Tables

No `<table>` elements were introduced this phase — reporting, automation, and governance content render as `LabeledItemGrid` (a semantic list-like grid, not a data table), which is the correct choice per the brief's "tables only where they improve understanding" guidance — none of this phase's content is genuinely tabular.

## Link purpose

Every internal link uses descriptive anchor text naming its destination (module names, "Explore the full platform", "See all modules") — no bare "click here"/"learn more" link text was introduced. `RelatedPages` and `ConnectedModules` links always pair a module's real name with its accent-color tag, not a generic label.

## Image alternatives

Every `ProductScreenshot` usage (unchanged component from Phase 3) requires real, descriptive `alt` text sourced from `apps/landing/lib/product/screenshots.ts` — no new screenshot was added this phase without one (none were approved this phase at all, per `screenshot-extension-register.md`).

## Keyboard behavior

No new interactive widget was introduced this phase beyond what Phase 2/3 already validated (FAQ `<details>`, `TrackedCtaLink`, the existing header/mobile-nav). The module CTA context flow (`?module=` query param → preselected checkbox) is a plain checked/unchecked native checkbox, fully keyboard-operable without any new custom interaction pattern.

## Form context passed accessibly

The `?module=` preselection (see `conversion-form-specification.md`'s Phase 3 pattern, extended this phase) sets a real checkbox's `checked` state — a screen reader announces it as checked/unchecked exactly like manual interaction would, with no separate visually-hidden announcement needed since the state itself is the accessible signal.

## What was not separately re-verified this phase

No live screen-reader (VoiceOver/NVDA/JAWS) pass, no color-blindness simulation beyond the module accent-color contrast ratios already verified in Phase 1/2/3 (no new module colors were introduced this phase — all 12 modules reuse their existing `accentColor` values), no automated axe-core scan. Consistent with the standing gap Phase 2/3 already documented, not a new regression.
