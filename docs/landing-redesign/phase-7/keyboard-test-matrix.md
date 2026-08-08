# Phase 7 Keyboard Test Matrix

Every row is a real, executed test — either an existing committed Playwright spec (re-run against this phase's final build) or a scripted verification performed this phase (documented in `decision-log.md`, script itself not committed since it was purpose-built for one-time verification, not ongoing regression coverage — the two findings it produced are captured as permanent evidence here and in the decision log instead). No row was marked pass based on automated tooling alone without an actual keyboard interaction being simulated.

| Route | Component | Keys | Expected | Actual | Result |
|---|---|---|---|---|---|
| `/` | Skip link | `Tab`, then `Enter` | Skip link receives focus first; activating it moves keyboard focus to `#main-content` | **Before fix:** focus never reached `#main-content` (scroll only). **After fix:** `document.activeElement.id === "main-content"`, confirmed | **Fixed this phase** (`decision-log.md` item 11) |
| `/` | Desktop mega menu (`Modules` trigger) | `Click` to open, `Escape` to close | Menu region becomes visible with real links inside; `Escape` hides it and returns focus to the trigger button | Region visible, `CRM` link visible inside it; after `Escape`, region hidden and trigger button focused | **Pass** (`production-smoke.spec.ts`) |
| `/` | Desktop mega menu (`Product` trigger) | Click outside the open menu | Menu closes | Region hidden after an outside click | **Pass** (`production-smoke.spec.ts`) |
| `/` | Mobile nav (`Open menu` button, 375px viewport) | `Click` to open, expand a group, `Escape` to close | Dialog opens with an accessible name; a module group expands to reveal its links; background scroll locks; `Escape` closes the dialog and returns focus to the open button | Dialog visible (`role="dialog"`, name "Site navigation"); `Revenue` group expands revealing `CRM` link; `Escape` hides dialog, open button refocused | **Pass** (`production-smoke.spec.ts`) |
| `/` | Header CTA | Tab to it, confirm target | Reaches `/book-demo` | `href="/book-demo"` confirmed | **Pass** (`production-smoke.spec.ts`) |
| `/`, `/book-demo`, `/resources/erp-requirements-checklist`, `/compare/vercentlabs-vs-odoo` | Full page, 5 mobile widths (320/360/375/390/412) | Layout reflow (not literal key input, but the direct precondition for keyboard/AT usability at narrow widths) | No horizontal overflow at any width | `scrollWidth <= clientWidth + 1` confirmed for all 20 route×width combinations | **Pass** (`mobile-conversion.spec.ts`) |
| `/` (390px) | Sticky mobile CTA | Reachability + size | Visible, real target, ≥24×24px | Confirmed visible with a real bounding box ≥24×24px | **Pass** (`mobile-conversion.spec.ts`) |
| `/book-demo` | Sticky mobile CTA | Presence check | Does not render (form's own submit button is the CTA on this route) | Confirmed zero elements matching `[data-sticky-mobile-cta]` | **Pass** (`mobile-conversion.spec.ts`) |
| `/` (all 5 mobile widths) | Header CTA vs. sticky CTA | Simultaneous-visibility check | Never both visible at once (the historic Phase 6 duplication bug) | Confirmed false at every tested width | **Pass** (`mobile-conversion.spec.ts`) |
| `/book-demo` | Demo form fields | Tab through `email`/`phone` | Correct input types for mobile keyboards | `type="email"` and `type="tel"` confirmed | **Pass** (`mobile-conversion.spec.ts`) |
| `/book-demo` | Submit button (320px) | Target size | ≥24×24px | Confirmed | **Pass** (`mobile-conversion.spec.ts`) |
| `/book-demo` | Viewport meta | Zoom-not-disabled check | No `user-scalable=no` or `maximum-scale=1` | Confirmed absent | **Pass** (`mobile-conversion.spec.ts`) |
| `/book-demo` | Demo form validation | Submit with empty required fields | Focus moves to a logical location for correction | Focus moved to the first invalid `<input>` — an accepted, correct WCAG pattern; 7 live-region elements present for status announcement | **Pass, confirmed correct** (`decision-log.md` item 12) |
| `/` | Full page | `no console errors` (a keyboard/AT-adjacent health check — a JS error can silently break keyboard handlers) | Zero console errors | Confirmed zero | **Pass** (`production-smoke.spec.ts`) |

## Not covered this phase (explicit gaps, not silently skipped)

- **Resource TOC, accordions/disclosures, requirements-evaluator filter, comparison-table interaction:** no dedicated keyboard-specific test exists for these components' internal keyboard behavior (e.g., arrow-key navigation within an accordion, if any). Axe-core's automated pass found no violation on the routes containing these components (`/resources/erp-requirements-checklist`, `/compare/vercentlabs-vs-odoo` both pass with 0 serious/critical violations), but that is not the same as a scripted keyboard-interaction test for each specific widget. Recorded as a `phase-8-brief.md` follow-up.
- **Footer link tab order:** not individually verified beyond axe's structural checks (no landmark/link-role violations found).
- **Print-preview keyboard behavior** (the requirements checklist's print action): not tested — print dialogs are OS-native UI outside what Playwright can meaningfully drive.
