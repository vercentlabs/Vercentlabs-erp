# Responsive Validation

## Method

`apps/landing/tests/e2e/visual-review.spec.ts` — a non-assertion Playwright suite that captures full-page screenshots at every required viewport against a real, freshly built and booted production server (`pnpm build:landing` → `pnpm start:landing` on `localhost:3000`, not `next dev`). Screenshots are then read and visually inspected (by both a specialized reviewer subagent and directly), not just captured and assumed correct.

## Viewports covered (homepage)

| Width | Represents |
|---|---|
| 320px | iPhone SE / smallest common mobile |
| 360px | Common Android baseline |
| 390px | iPhone 12-15 class |
| 768px | iPad portrait / small tablet |
| 1024px | iPad landscape / small laptop |
| 1280px | Common laptop |
| 1440px | Common desktop |
| 1920px | Full HD desktop |

Plus targeted captures of: hero-only (desktop), desktop mega menu open, mobile nav open, `/book-demo` (desktop / 375px / 320px / validation-error state), `/book-demo/thank-you` (desktop / mobile), `/design-system` (desktop), and a 404 page — 54 Playwright tests total (up from 30 in Phase 2), run in both a desktop-chromium and mobile-chromium project, all passing as of the final Cycle 3 regression run in this phase.

## Real defects found and fixed at specific viewports

1. **320px**: header CTA button wrapped to two lines and visually overlapped the wordmark — see `implementation-summary.md` defect #3. Confirmed fixed by an isolated 320px-viewport screenshot after the fix (clean wordmark, no overlap) and by the full suite re-passing at both 320px and 360px.
2. **Desktop widths generally (1024px+)**: hero and flagship-workflow sections showed a completely empty second column before any screenshot was approved — see defect #2. Fixed with conditional single/two-column layout; now renders the real two-column layout with product screenshots at all desktop widths since screenshots are approved.
3. **All widths, `/book-demo/thank-you`**: appeared visually blank due to a hydration-timing race — see defect #1. Fixed by rendering the confirmation content server-side; re-confirmed at both desktop and mobile viewports post-fix.

## Mobile-specific behavior verified

- Module tags on the homepage's module-architecture section wrap cleanly across multiple rows at 390px and 320px with no clipping or overflow.
- The new sticky mobile CTA bar (`components/marketing/sticky-mobile-cta.tsx`) renders correctly at 320px, sitting below the header with no collision, and is hidden entirely at `lg` and above (verified in the `hero only — desktop` and `homepage — w1440`/`w1920` captures, where it does not appear).
- The mobile nav dialog (`components/navigation/mobile-nav.tsx`) opens full-screen, locks background scroll, and its accordion module groups expand/collapse correctly at mobile widths — verified via the `mobile navigation` functional test (not just a screenshot) at both desktop-chromium and mobile-chromium projects.
- The demo form's two-column field grids (name, email/phone, company/role, industry/company size) collapse to a single column at mobile widths via the shared `Grid` component's responsive classes — verified in the `book-demo — mobile 375` and `book-demo — mobile 320` captures.

## What was not verified this phase

- Real device testing (only Chromium via Playwright, at both a "desktop" and "mobile" emulated project) — no Safari/iOS or Firefox pass. Consistent with Phase 2's validation scope; flagged as a standing gap, not new to this phase.
- Landscape mobile orientation was not separately captured.
