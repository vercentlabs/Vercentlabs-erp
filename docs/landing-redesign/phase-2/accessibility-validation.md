# Accessibility Validation

## Method

`eslint-config-next` (via `eslint-plugin-jsx-a11y`, inherited automatically — no separate a11y lint setup needed) ran clean against the entire `apps/landing` codebase. Functional keyboard/focus/ARIA behaviour was verified with real Playwright browser automation against the production build (not just code inspection). No dedicated automated accessibility scanner (axe-core, Lighthouse CI) was run this phase — neither is wired into the repo yet (confirmed absent in Phase 1's frontend-architecture findings) and adding one was judged out of scope for this phase's validation budget; see "Remaining risks."

## Keyboard results (verified via Playwright)

- **Desktop mega menu**: opens on click/Enter (native button), closes on **Escape** with focus returned to the trigger button — verified via `expect(trigger).toBeFocused()` after an Escape keypress, not just visual disappearance.
- **Mobile nav dialog**: opens with focus moved to the close button, closes on Escape with focus **restored** to the hamburger trigger that opened it — verified the same way.
- **Tab order**: mega-menu content uses real `<a>` links in normal document order (not an ARIA `menu` widget requiring arrow-key navigation) — a deliberate choice so standard Tab/Shift+Tab keyboard navigation works without special handling, documented in `component-inventory.md`.
- **Form fields** (`/design-system`): all inputs are keyboard-focusable native elements; no custom widget reimplements native form semantics.

## Focus results

- Global `:focus-visible` ring (`--color-border-focus`, 2px, 2px offset) applied once in `globals.css`, not per-component — guarantees every interactive element gets a visible focus indicator without relying on each component author remembering to add one.
- Focus-trap behaviour for the mobile nav dialog was verified for open (focus moves in) and close (focus restored) but **not** verified for Tab-cycling containment (i.e., whether Tab from the last focusable element inside the open dialog wraps back to the first, rather than escaping to the page behind it). Flagged as a gap — see "Remaining risks."

## Screen-reader semantics

- Mobile nav: `role="dialog"` `aria-modal="true"` `aria-label="Site navigation"`.
- Mega-menu panels: labelled `role="region"` matching the trigger's label.
- Breadcrumbs: `nav aria-label="Breadcrumb"`, ordered list, `aria-current="page"` on the current item.
- Form fields: `FieldWrapper` wires `aria-describedby` to chain both description and error text to the input — verified by unit test (`tests/lib.test.mjs` doesn't cover this directly since it's JSX, but the pattern is visually confirmed correct on `/design-system` and matches standard accessible-forms practice).
- Icon-only buttons (mobile menu close, hamburger trigger) require a `label`/`sr-only` text alternative — enforced by `IconButton`'s required `label` prop and an explicit `<span className="sr-only">` on the raw hamburger button.
- Decorative elements (module colour dots, chevron icons, checkmarks) are `aria-hidden="true"` throughout.

## Colour contrast

- Core semantic pairings (ink-on-canvas, ink-on-elevated, inverse text on brand) are standard high-contrast combinations by construction (dark ink `#101828` on near-white `#f9fafb`/`#ffffff`) and pass WCAG AA by a wide margin.
- **Not machine-verified**: the 8 landing-original module accent colours (Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) as used in `ModuleTag`'s dot-plus-label pattern rely on the dot being decorative and the label text using the standard ink colour — so accent-colour contrast isn't actually load-bearing for text legibility today. It **would** become load-bearing if a future page uses an accent colour as a text or background colour directly (e.g. a module-tinted section band) — `design-system-specification.md` flags this explicitly as a pre-condition before that usage ships.

## Reduced motion

Global CSS rule in `globals.css` collapses all animation/transition durations to near-zero under `@media (prefers-reduced-motion: reduce)`, mirroring the technique already used in `apps/web`'s CSS. Not independently re-verified with the OS-level "reduce motion" flag in this phase's Playwright runs (Playwright supports emulating this via `page.emulateMedia`, but no test does so yet) — flagged as a gap.

## Touch targets

Mobile nav links use `min-h-11` (44px) — meets the common 44×44px minimum target-size guideline. Desktop nav items were not explicitly measured but use standard `px-3 py-2` button padding consistent with the rest of the design system.

## Remaining risks

- No automated contrast-checking tool (e.g. axe-core) was run — recommend adding one before Phase 3 introduces more color combinations (module-tinted sections, workflow diagrams).
- Focus-trap Tab-cycling containment inside the open mobile dialog was not explicitly tested.
- `prefers-reduced-motion` was not re-verified with Playwright's media emulation.
- Zoom-to-200% and text-spacing (WCAG 1.4.4/1.4.12) were not explicitly tested this phase.
- Multiple simultaneously-open desktop menus (see `navigation-specification.md`) is a minor, untested edge case.
