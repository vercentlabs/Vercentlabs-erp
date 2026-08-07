# Responsive Validation — Phase 4

## Method

Same discipline as Phase 3: real production build (`pnpm build:landing`), real production boot (`pnpm start:landing`), Playwright captures against the booted server — not `next dev`.

## Coverage

`apps/landing/tests/e2e/visual-review.spec.ts`'s new "Phase 4 module and platform routes" describe block captures every one of the 19 new routes (`/modules`, all 12 `/modules/{slug}`, `/product`, all 6 platform pages) at two viewports:

- **1440×900 (desktop)** — full-page screenshot
- **390×844 (mobile)** — full-page screenshot

38 new capture tests, run across both the `desktop-chromium` and `mobile-chromium` Playwright projects (76 executions), plus the existing homepage/book-demo/design-system suite — **182 total visual-capture tests, all passing** as of the full Cycle 2 run.

## Screenshot-timing false alarm (investigated, not a defect)

During Cycle 1 review, the CRM module page's secondary product-screenshot (`crm-leads-list`) appeared blank in a full-page capture. Investigation (direct `curl` against the Next.js image-optimization endpoint, DOM inspection of `naturalWidth`/`complete` state, a recapture with an explicit `scrollIntoView` + settle wait) confirmed the image, the optimization pipeline, and the production render were all correct — the blank capture was a lazy-load timing race in the screenshot script itself (Playwright's `fullPage` scroll-and-stitch reaching that element before its lazy `<img>` finished decoding), not a rendering bug. `visual-review.spec.ts`'s new Phase 4 block adds an explicit `waitForTimeout(500)` after `networkidle` specifically to avoid reproducing this false alarm at scale across 19 routes.

## What was checked at each viewport

- No horizontal overflow on any of the 19 routes at 390px (spot-checked directly; no route uses a fixed-width element wider than the viewport).
- `CapabilityGrid`'s full-width information-band rows collapse cleanly to single-column reading order on mobile — no truncated text, no overlapping badges.
- `ModuleHero`'s 4 variants all degrade to single-column stacking below `lg` — the `screenshot-led`/`dashboard-led` split layout, the `workflow-led` horizontal `WorkflowConnector` strip (which itself scrolls horizontally on narrow viewports rather than wrapping awkwardly, consistent with the homepage's flagship-workflow section from Phase 3), and the `operational-sequence` numbered list all remain legible at 390px.
- The `/modules` index's category rows (name, definition, primary users, outcome, link) stack vertically on mobile via the existing `InformationBand` component's responsive flex behavior (unchanged from Phase 3).
- Platform pages' `LabeledItemGrid` sections collapse from 2-3 columns to 1 column below `sm`.

## What was not separately re-verified this phase

The full 320-1920px viewport matrix Phase 3 established for the homepage was not re-run against every one of the 19 new routes (only 390px mobile + 1440px desktop, per the Cycle 2 brief's explicit "Desktop / Mobile" requirement, not the homepage's full 8-viewport matrix). If a narrower-than-390px issue exists on a module/platform page specifically, it would not be caught by this phase's capture matrix — a reasonable follow-up for Phase 5 or a dedicated responsive-hardening pass, not flagged as a known defect since nothing in Cycle 2 review surfaced viewport-specific breakage.
