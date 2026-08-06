# Accessibility Validation

Target: WCAG AA (per `CLAUDE.md`). This phase's validation is manual/code-review-based plus targeted Playwright assertions — no automated axe-core scan is wired into CI yet (see "What was not verified," matching Phase 2's documented gap).

## Heading structure

Verified directly in `apps/landing/components/ui/text.tsx` and `app/page.tsx`: `Heading level="display"` (used once, for the hero) renders a real `<h1>`; every one of the other 11 sections' `SectionHeader` renders a real `<h2>`. The Final CTA section explicitly overrides its `Heading level="h1"` to render as `as="h2"` — preserving the visually-large "display-like" style for that closing moment without introducing a second `<h1>` on the page. Result: exactly one `<h1>`, a clean, non-skipping heading hierarchy for the whole homepage.

## Focus management

- **Demo form validation**: on a failed client-side validation, focus moves programmatically to the first invalid field (`demo-form.tsx`'s `handleSubmit`), not just a visual error indicator — a keyboard/screen-reader user lands directly on the problem field.
- **Thank-you page**: the confirmation heading has `id="thank-you-heading"` and `tabIndex={-1}`; `thank-you-effects.tsx` calls `.focus({ preventScroll: true })` on it once the request ID is confirmed, so screen-reader users get an announcement that the action succeeded, without a jarring scroll-into-view.
- **Mobile nav dialog**: focus moves to the close button on open and restores to the trigger element on close (unchanged from Phase 2). **New this phase**: a real Tab/Shift+Tab focus trap was added (`components/navigation/mobile-nav.tsx`) — previously a keyboard user could Tab out of the full-screen `role="dialog"` into header/content elements sitting behind the semi-transparent overlay; this was flagged by the frontend-quality review pass and fixed by cycling focus between the first and last focusable elements inside the panel while open.
- **Desktop mega menu**: Escape closes and returns focus to the trigger (unchanged from Phase 2, re-verified by the `desktop mega menu opens, is keyboard-dismissible with Escape, and returns focus` Playwright test, passing).

## ARIA and semantic correctness

- Every form field goes through `FieldWrapper` (`components/forms/field.tsx`), which wires `aria-describedby` to chain both the description and error message IDs to the input — a screen reader announces help text and validation errors, not just the bare label.
- Error states are never color-only: every invalid field pairs a red outline (`invalid` prop → `aria-invalid` styling) with a real, visible inline error message (`role="alert"`), and the form-level error summary is `role="alert"` (a redundant nested `role="alert"` on the same text, which could cause some screen readers to double-announce, was found and fixed this phase — see `implementation-summary.md` defect list / reviewer finding).
- Honeypot fields (`websiteUrl`, `companyWebsiteHidden`) are `aria-hidden="true"` on their wrapper and `tabIndex={-1}` on the inputs themselves — invisible and unreachable for real keyboard/screen-reader users, only present for bot detection.
- The FAQ accordion uses native `<details>/<summary>` — keyboard-operable and screen-reader-accessible with zero custom JS, and every answer stays in the server-rendered HTML (just visually collapsed) so the content is available regardless of open/closed state.
- The sticky mobile CTA bar is a real `next/link`-rendered anchor (fixed this phase — was a plain `<a>`, inconsistent with the rest of the app's navigation pattern), reachable and operable by keyboard like any other link.

## Color contrast

Every module accent color used as a text or tag color was verified against WCAG AA contrast ratios in Phase 1/2 (`docs/landing-redesign/phase-1/creative-direction.md`); no new module colors were introduced this phase. The brand/design review pass independently re-confirmed all 12 module accent colors clear 4.5:1 against white (lowest: Procurement 4.94:1, Assets 4.99:1).

## Motion

`prefers-reduced-motion` is respected globally (`app/globals.css`), unchanged from Phase 2 — no new animation was introduced this phase (the numbered-step marker standardization and ProductCallout padding change are static style fixes, not motion).

## What was not verified this phase

- No automated axe-core (or equivalent) scan in CI — accessibility checks this phase are manual inspection plus the specific Playwright functional assertions listed above (focus-return, Escape-dismiss, scroll-lock), not a comprehensive automated ruleset.
- No screen-reader software (VoiceOver/NVDA/JAWS) manual pass — verification is based on correct semantic HTML/ARIA usage, not a live assistive-technology run-through.
- No color-blindness simulation pass on the module accent-color system beyond the numeric contrast-ratio checks already performed in Phase 1/2.

These gaps are consistent with what Phase 2's `accessibility-validation.md` already documented as standing follow-up work, not new regressions introduced this phase.
