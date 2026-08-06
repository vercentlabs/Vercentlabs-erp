# Navigation Specification

Implements `docs/landing-redesign/phase-1/information-architecture.md`'s nav structure and `conversion-architecture.md`'s CTA rules, using `packages/landing-content`'s `PRIMARY_NAV`, `MODULE_NAV_GROUPS`, and `CTAS` as the single source of truth — no competing hard-coded nav arrays exist in `apps/landing`.

## Desktop structure (≥1024px / `lg` breakpoint)

`Logo | Product ▾ | Modules ▾ | Industries | Pricing | Resources` — `Sign in | Book a Demo` (persistent, right-aligned).

- **Product** — a simple disclosure listing `PRIMARY_NAV`'s "Product" children (Platform, Automation, Analytics, Mobile, Security, Integrations).
- **Modules** — the full mega menu: 5 groups (Revenue / Operations / Finance / People & Service / Delivery) from `MODULE_NAV_GROUPS`, each module shown with its accent-colour dot, name, and one-line description from `packages/landing-content`. Footer row: "See all modules" (→ `/modules`) and "Watch Product Tour" (→ `/product-tour`).
- **Industries / Pricing / Resources** — plain links, no dropdown (3 industries don't warrant a mega menu per the IA).

## Mega-menu keyboard and focus model

- Trigger is a real `<button aria-expanded aria-controls>`.
- Panel is a labelled `role="region"`, not an ARIA `menu` — a deliberate choice (see `component-inventory.md`) so keyboard users get normal Tab order through real links rather than being forced into arrow-key-only ARIA menu navigation, which is poorly supported for heterogeneous mega-menu content.
- **Escape** closes the open menu and returns focus to its trigger button.
- **Click outside** the panel and trigger closes the menu.
- **Route change** closes any open menu (implemented as a render-time state adjustment comparing current vs. last-seen pathname, not a `useEffect` + `setState`, to avoid React's cascading-render warning for that pattern).
- Only one desktop menu can be open at a time in practice (each `NavMenu` instance manages its own state independently; opening a second while the first is open is a known minor gap — not yet coordinated — see "Remaining risks" in `accessibility-validation.md`).

## Panel positioning

The panel is centered under its trigger (`left-1/2` + `-translate-x-1/2`), not left-anchored. **This was a real bug**: left-anchoring caused the ~880px-wide Modules panel to overflow past the right edge of a 1440px viewport when its trigger (positioned mid-header) wasn't near the left edge. Centering keeps it on-screen for realistic desktop widths; true viewport-collision detection (flip to right-aligned near the right edge, clamp on very narrow desktop widths ~1024px) is not implemented — flagged as a follow-up, not a blocker, since it only matters below ~1200px wide desktop viewports.

## Mobile structure (<1024px)

A dedicated slide-over dialog, not a shrunk mega menu — `Header`'s hamburger button opens `MobileNav`:

- **Header**: "Menu" label, close (✕) button.
- **Product**: flat list (6 links).
- **Modules**: accordion, one entry per group (5 groups) — expanding a group reveals its modules with accent-colour dots. Maximum depth is 2 levels (group → module), per the brief's mobile-nav depth limit.
- **Industries / Pricing / Resources / Sign in**: flat list below the module accordion.
- **Footer**: persistent "Book a Demo" button, always visible without scrolling within the dialog's own layout.

### Focus and scroll model

- Opening the dialog moves focus to its close button and locks `document.body` scroll (`overflow: hidden`).
- **Escape** closes the dialog and restores focus to whatever element had focus before it opened (the hamburger trigger, in normal use).
- The dialog is **portalled to `document.body`** (`createPortal`) rather than rendered in place — a real bug this phase (see `decision-log.md`) found that rendering it as a descendant of the header broke its `fixed inset-0` positioning when the header gained a `backdrop-filter`. The portal makes this robust against any future ancestor-style change, independent of the header no longer using `backdrop-filter` either.
- Touch targets in the mobile accordion are `min-h-11` (44px), meeting the accessibility target.

## CTA placement and wording

Per `conversion-architecture.md`: primary CTA "Book a Demo" is persistent in the header (desktop, ≥`sm`) and as a full-width button at the bottom of the mobile nav dialog. Secondary CTA "Explore the Platform" appears in hero content (Phase 3). No CTA anywhere uses a generic label ("Learn More"/"Get Started") — enforced by `tests/content-integrity.test.mjs`'s check against `CTAS` from `packages/landing-content`.

## Active states

Not yet implemented — no page besides `/` and `/design-system` exists to compare an active route against, so "highlight the current nav item" has no meaningful test surface in this phase. Flagged as Phase 3+ scope once module/industry pages exist.

## Scroll behaviour

Header is `position: sticky` with a solid background (no transparency/blur transition on scroll) — deliberately simple for this phase; the brief permits a "subtle" scroll-triggered style change but this phase did not add one, to avoid reintroducing motion/undertested behaviour this late in the validation cycle. Candidate for Phase 7 (CRO/performance polish).
