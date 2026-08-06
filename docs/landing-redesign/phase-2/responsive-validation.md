# Responsive Validation

## Method

Real browser automation via Playwright (`@playwright/test` 1.61.1, Chromium), run against the actual production build booted through the repo-root `server.js` — not `next dev`, not source-code inspection alone. Two Playwright projects: `desktop-chromium` (1440×900) and `mobile-chromium` (Pixel 7 emulation, ~412×915), plus explicit per-test viewport overrides for the specific sizes below. Screenshots were captured to `apps/landing/test-results/*.png` and visually inspected directly (not assumed from passing assertions alone).

## Viewports exercised

| Viewport | Method | Result |
|---|---|---|
| 1440×900 (desktop) | `desktop-chromium` project default | Verified — homepage, mega menu, footer all correct after fixes |
| 412×915 (mobile, Pixel 7) | `mobile-chromium` project default | Verified — full smoke/nav suite passes |
| 375×812 (mobile) | Explicit `test.use({ viewport })` | Verified — homepage layout, mobile nav dialog |
| 320×568 (smallest mobile) | Explicit `page.setViewportSize` | Verified — homepage screenshot captured, no horizontal overflow observed |
| 1024×768, 1280×800, 1920×1080 | Not explicitly captured this phase | **Not verified** — see "Remaining limitations" |

## What was checked at each captured viewport

- Header renders correctly; desktop nav visible ≥1024px, hamburger trigger visible <1024px (no dead zone where neither is shown).
- Homepage hero, module-tag strip, and temporary-homepage notice reflow without horizontal overflow.
- Footer's 4-column grid collapses to fewer columns / stacks appropriately at narrow widths.
- Module tags wrap correctly rather than overflowing their container.
- 404 page and `/design-system` render correctly at desktop width.

## Real defects found and fixed via this process

Two of the four bugs documented in `decision-log.md` were **only discoverable through actual screenshot inspection**, not through passing test assertions or code review:

1. **Mega-menu panel overflowed the viewport's right edge** at 1440px width when left-anchored to a trigger not near the left edge of the header. Found by looking at the captured screenshot, not by any assertion (the panel was still "visible" per Playwright's definition, just partially off-screen). Fixed by centering the panel under its trigger.
2. **Mega-menu panel had no visible background**, letting hero text show through it — caused by the Tailwind v4 bracket-syntax bug (see `decision-log.md` item 4). Also only visible in the actual screenshot; DOM assertions (`toBeVisible()`) don't catch "rendered but visually broken."

This is the direct justification for the brief's instruction to review actual renders rather than source code alone — both defects would have shipped invisibly if validation had stopped at "the build succeeds and Playwright's functional assertions pass."

## Remaining limitations

- **1024px, 1280px, and wide-desktop (1920px+) viewports were not explicitly screenshotted.** The mega-menu centering fix is verified correct at 1440px; at exactly 1024px (the `lg` breakpoint boundary) the ~880px-wide Modules panel plus centering could still clip on either edge for a trigger positioned very close to the header's left or right edge. Recommend adding these viewports to the Playwright visual-review suite before Phase 3 ships pages that make the mega menu load-bearing for navigation to real content.
- **Tablet portrait/landscape (768×1024, 1024×768) not captured.** The `md`/`lg` breakpoint transition (where desktop nav first appears) is the highest-risk zone for a responsive nav and was not visually confirmed at exactly that boundary.
- **No real device testing** — Playwright's Chromium mobile emulation was used throughout; no physical iOS/Android device or Safari-specific rendering was verified. Safari's `backdrop-filter` and CSS containing-block behaviour in particular is worth re-checking given this phase's related bug, even though the fix (remove `backdrop-filter`, add a portal) is standards-based and should behave identically across engines.
