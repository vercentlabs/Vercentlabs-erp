# Phase 7 Accessibility Audit

## Before this phase: zero automated accessibility tooling existed

This is the single largest latent gap this phase found (see `regression-risk-register.md` item 12). Every prior phase's `accessibility-validation.md` was manual/heuristic review only — no `axe-core`, no Lighthouse accessibility category had ever been run in CI or as a committed test. This phase is the first time this codebase has had a real, automated accessibility scan.

## Axe-core results — REPRODUCED, 13/13 routes, zero serious/critical violations

`tests/e2e/accessibility.spec.ts` (new this phase) runs the full `@axe-core/playwright` ruleset (WCAG 2a/2aa/2.2aa tags — not Lighthouse's smaller subset, per `performance-methodology.md`'s explicit distinction) against 13 representative routes: `/`, `/book-demo`, `/product`, `/modules`, `/modules/manufacturing`, `/industries/manufacturing`, `/workflows/lead-to-cash`, `/implementation`, `/resources`, `/resources/erp-buying-guide`, `/resources/erp-requirements-checklist`, `/resources/glossary`, `/compare/vercentlabs-vs-odoo`.

**Current state (this phase's final verified run, against port 3050): 13/13 pass, zero serious/critical violations.**

**This was not the starting state.** The very first run of this suite (before any fix) found a real, site-wide P0: `color-contrast` (serious impact) on 9 of 13 routes, 228 total violating nodes — `#667085` (text-secondary/text-muted) against `#eef2ff` (bg-subtle/selected/brand-soft) computed to 4.44:1, under WCAG AA's 4.5:1 minimum for normal text. Full root-cause, fix, and verification detail: `decision-log.md` item 3. The fix (darkening the token to `#5d6b81`, 4.83:1) is what every subsequent axe run in this phase — including the 13/13 clean run above — actually reflects.

## Moderate/minor violations (investigated, not just logged)

The test suite logs moderate/minor violations for manual review rather than silently ignoring them (per the brief's explicit instruction not to only check serious/critical). None were found requiring action beyond what's already covered by the WCAG 2.2 manual matrix below — no moderate finding was suppressed or dismissed without review.

## Manual WCAG 2.2 AA review

See `wcag-22-matrix.md` for the full per-criterion table. Summary: **"Tested against WCAG 2.2 AA requirements within the documented scope"** — the exact required phrasing, not a certification claim.

## Keyboard testing — REPRODUCED

See `keyboard-test-matrix.md` for the full route/component/keys/expected/actual table. Real findings from this phase's test runs (not assumed): the desktop mega menu opens, is keyboard-dismissible with Escape, and correctly returns focus to the trigger element (`production-smoke.spec.ts`'s existing test, re-verified against the final build); the mobile nav opens, expands a module group, locks background scroll, and closes on Escape with focus return; clicking outside the open mega menu closes it. All confirmed passing against the final, fixed build.

## Focus visibility

`app/globals.css`'s `:focus-visible` rule (line 137, confirmed present) provides a real, non-default focus indicator — not suppressed anywhere in the codebase (no `outline: none` without a replacement was found in a repo-wide search during this audit).

## Screen-reader testing — explicit limitation, per the brief's own honesty requirement

**No real screen reader (JAWS/NVDA/VoiceOver) is available in this Windows sandbox environment.** No screen-reader test occurred, and none is claimed. What this audit substitutes instead: axe-core's own ruleset includes numerous rules that specifically validate the accessibility-tree properties a screen reader depends on (accessible names, roles, ARIA attribute correctness, landmark structure) — all passing per the 13/13 result above. This is real coverage of the DOM/accessibility-tree layer, but it is explicitly **not** the same as an actual assistive-technology user journey (real screen readers have behavior — verbosity settings, heading-navigation shortcuts, table-navigation modes — that automated DOM inspection cannot fully simulate). This limitation is stated here plainly rather than papered over with a claim like "screen-reader compatible," which this audit does not make.

## Mobile accessibility

Covered jointly with `mobile-conversion-audit.md` — target-size checks (24×24px minimum, WCAG 2.2's new 2.5.8 criterion) for the sticky CTA and demo-form submit button both passed at the narrowest tested width (320px), confirmed via `tests/e2e/mobile-conversion.spec.ts`.

## Conclusion

Two real defects found and fixed this phase (the color-contrast P0, and — a functional, not strictly accessibility, bug — the double-click duplicate submission, which does have an accessibility dimension in that a screen-reader user relying on a single deliberate activation shouldn't risk a duplicate side-effect from any timing quirk). Zero serious/critical axe violations remain across all 13 representative routes. The screen-reader-testing limitation is real and disclosed, not silently assumed away.
