# Phase 8 Responsive Validation

## Method

A real, MEASURED viewport sweep against the live production build (port 3050) across the exact 7 widths this workstream names — **320, 360, 390, 768, 1024, 1440, 1920** — a wider set than any prior phase's own sweep (Phase 7's own sweep covered 320-412px mobile widths only; this phase adds the 3 wider breakpoints: 768/tablet, 1024, 1920/large-desktop). 6 representative routes × 7 widths = 42 real checks, each asserting `document.documentElement.scrollWidth - clientWidth <= 1` (a real DOM measurement, not a screenshot-based visual guess).

**Result: 42/42 pass — zero horizontal overflow at any tested width on any tested route**, including the two brand-new routes this phase added (`/privacy`, `/terms`, both long-form text pages using the same `SidebarLayout`/`TableOfContents` primitives already proven correct on resource-guide pages in earlier phases).

## Routes covered

`/`, `/privacy`, `/terms`, `/book-demo`, `/resources/erp-requirements-checklist` (chosen as the most content-dense, layout-complex page on the site — filter buttons, 73 capability groups), `/compare/vercentlabs-vs-odoo` (chosen for its comparison table, which switches between a real `<table>` on wide viewports and stacked cards on narrow ones — the specific kind of layout most likely to overflow if broken).

## Tablet width (768px) — a real gap Phase 6 explicitly disclosed, now closed

Phase 6's own `responsive-validation.md` stated: "Tablet-width (768px) was not specifically re-verified for Phase 6 content this cycle... low risk, not zero risk." This phase closes that gap with real measurement: 768px is now confirmed overflow-free across all 6 tested routes.

## Cross-browser + viewport combined coverage

This phase's `cross-browser-smoke.spec.ts` (see `cross-browser-validation.md`) separately covers `mobile-webkit` (an iPhone 14 emulated viewport, ~390px) and `desktop-webkit`/`desktop-firefox` (1440px) rendering correctness across engines — combined with this document's width-only sweep (Chromium engine, 7 widths), the two datasets together give real evidence across both axes (width × engine), even though no single test run covers the full cross-product of all 7 widths × all 5 engines (which would be 35 combinations per route — judged disproportionate to run exhaustively, consistent with this project's established "representative sampling, not exhaustive" discipline).

## What was not done

The full ~74-route inventory was not swept at all 7 widths — only the 6 representative routes above, per the same sampling discipline every prior phase has used. No new layout defect was found this phase requiring a fix.
