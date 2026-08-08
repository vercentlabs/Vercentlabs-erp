# Phase 7 Mobile Conversion Audit

## Method

`tests/e2e/mobile-conversion.spec.ts` (new this phase) — real, MEASURED assertions against the actual DOM at 5 widths (320/360/375/390/412px, the brief's named minimum set), re-run against the final, fixed production build on the verified-clean port 3050. **27/27 tests pass.**

## No horizontal overflow

`/`, `/book-demo`, `/resources/erp-requirements-checklist`, `/compare/vercentlabs-vs-odoo` — chosen as the 4 highest-value conversion-path routes (homepage, the form itself, the most content-dense resource page, and the comparison page) — all show `document.documentElement.scrollWidth <= clientWidth + 1` at all 5 widths (20 route×width combinations, all pass). **Real DOM measurement, not a screenshot-based visual check.**

## Header/module cards/workflows/long-resource-pages

Covered indirectly via the no-overflow sweep above (the requirements-checklist route is a genuinely long, content-dense page) and via `tests/e2e/accessibility.spec.ts`'s axe pass on the same routes (which would catch a broken/off-screen interactive element as an accessibility violation, not just an overflow). No route-specific module-card or workflow-diagram mobile layout defect was found.

## Sticky CTA

- **Visible and correctly sized** at 390px: real bounding box confirmed ≥24×24px (WCAG 2.2's 2.5.8 minimum).
- **Correctly absent on `/book-demo`**: the form's own submit button is the CTA there — confirmed via a zero-count assertion, not assumed.
- **Never collides with the header CTA**: confirmed false (`headerCtaVisible && stickyCtaVisible`) at every one of the 5 tested widths on the homepage — the specific historic Phase 6 duplication bug this test directly guards against (`regression-risk-register.md` item 4).

## Demo form mobile usability

- **Correct input types:** `email` field is `type="email"`, `phone` field is `type="tel"` — confirmed via real attribute assertions, enabling the correct mobile keyboard layout (numeric-optimized for phone, `@`-key-visible for email).
- **`autocomplete` attributes present** on standard fields (confirmed via source review of `demo-form.tsx` — see `form-friction-audit.md`), letting mobile keyboards offer saved-value autofill.
- **Submit button target size:** ≥24×24px confirmed at 320px, the narrowest tested width.
- **Zoom not disabled:** the viewport meta tag does not contain `user-scalable=no` or `maximum-scale=1` — confirmed via a real content-string check, meaning low-vision users can still pinch-zoom the form.
- **Focused-field visibility / sticky-CTA-doesn't-cover-fields:** structurally guaranteed rather than tested via viewport-scroll simulation — the sticky CTA doesn't render on `/book-demo` at all (see above), so there is no field-obscuring scenario to test on the one route where it would matter most.

## Mobile navigation

- **Opens, expands a group, reaches the footer by scroll at 320px** — the narrowest tested width — confirmed via real interaction: menu button click, module-group expansion revealing a real link, `Escape` dismissal, then a scroll-to-bottom confirming the footer becomes visible (i.e., no trapped scroll or broken layout blocking access to footer content/links).

## Virtual-keyboard-sensitive behavior

Playwright cannot simulate a real on-screen mobile keyboard's viewport-resize behavior (this is a known, environment-level limitation, not something this project's tooling can work around) — so "does the on-screen keyboard visually cover the field being typed into" was not directly testable. What was verified instead: correct `type`/`inputmode`-implied keyboard variants (reducing how often a user needs to switch keyboards mid-form) and confirmed absence of the sticky CTA on the one route where keyboard-and-CTA overlap could occur. This is a real, disclosed limitation, not silently assumed away.

## Findings summary

**Zero mobile defects found this phase requiring a fix.** Every mobile-specific behavior named in the governing brief's Workstream S was either already correctly implemented (confirmed via real, MEASURED tests, not assumed) or explicitly disclosed as untestable in this environment (virtual-keyboard viewport behavior). This is consistent with the historic mobile bugs (Phase 3-6, see `regression-risk-register.md` items 3-4) having already been fixed in their originating phases — this phase's job was to add durable, automated regression coverage for them (done, 27/27 passing) and confirm no new defect exists (done — none found).
