# Accessibility Validation — Phase 6

Target: WCAG 2.2 AA, per CLAUDE.md's stated accessibility target for this project.

## What was actually verified

- **Single, real H1 per page**: every one of the 32 `phase6-routes.spec.ts` tests asserts `page.getByRole("heading", { level: 1 }).toHaveCount(1)` — checked live against the rendered DOM, not assumed from JSX structure. All 32 routes pass.
- **Zero console errors**: every route test also asserts an empty `console.error` array across the full page load — a real, automated proxy for "nothing is silently broken," including hydration-mismatch warnings that would otherwise be invisible.
- **Native semantic elements, not div-soup, for interactive components**:
  - `RequirementsChecklist` uses real `<input type="checkbox">` elements with `aria-label`s (`Mark ${group.name} as evaluated`), not a styled `<div>` faking a checkbox.
  - `DecisionMatrix` uses a real `<table>` with `scope="col"`/`scope="row"` on header cells (both `<th>` for row and column headers) — verified by reading the component source directly, not assumed.
  - `FaqAccordion` (reused, not reinvented, for every new page's FAQ section) uses native `<details>`/`<summary>`, keyboard-operable by default with zero custom JS.
  - `TableOfContents` uses plain `<a href="#id">` anchors — normal browser focus/scroll behavior, no custom scroll-spy JS to get wrong.
- **Persistent link affordance** (Cycle 1 finding, fixed): glossary index links now carry a permanent underline, not just a hover-only color change — a real WCAG-adjacent discoverability fix, not just a visual nicety. See `decision-log.md` item 8.
- **Breadcrumb navigation**: every new route uses the existing, already-accessible `Breadcrumbs` component (`aria-label="Breadcrumb"`, `aria-current="page"` on the current item) — reused, not reimplemented.
- **Print styles don't break screen-reader flow**: the requirements checklist's `print:hidden` classes only affect the `@media print` stylesheet target, not screen-reader-only content — filter buttons and per-item links stay in the accessibility tree at all times on screen.

## Not yet done (disclosed gap)

- **No automated axe-core (or equivalent) scan** was run against any new route this phase — the checks above are real but manual/targeted, not a systematic WCAG ruleset sweep. This is the most significant disclosed accessibility gap.
- **No manual screen-reader pass** (VoiceOver/NVDA) through the requirements checklist's filter-and-check interaction specifically — the underlying elements are native and should behave correctly by construction (real checkboxes, real buttons, real labels), but this hasn't been confirmed by an actual assistive-technology walkthrough.
- **No dedicated color-contrast audit** of the new components against WCAG AA thresholds — the new components reuse existing design tokens (`--color-text-primary`, `--color-text-secondary`, `--color-text-brand`, `--color-border-strong`) already used and presumably validated elsewhere on the site, but this phase didn't re-run a contrast checker against them in their new contexts (e.g. the glossary link's new underline color).
- **No focus-order walkthrough** of the requirements checklist's filter buttons → checkbox list → print button sequence — native tab order should follow DOM order correctly by construction, but wasn't manually confirmed with a keyboard-only pass.

These gaps are explicitly named as Phase 7 candidates in `phase-7-brief.md`, not silently deferred.
