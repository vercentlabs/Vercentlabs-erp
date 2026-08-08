# Responsive Validation — Phase 7

## What was actually tested (not assumed from CSS)

- **Real production build**, booted via the standalone `server.js` on a dedicated, verified-clean port (3050 — see `decision-log.md` item 8 for why the default port 3000 couldn't be trusted this session).
- **5-width no-overflow sweep** (320/360/375/390/412px — the brief's explicit minimum set, a finer-grained sweep than any prior phase's single-320px check) across 4 representative conversion-path routes (`/`, `/book-demo`, `/resources/erp-requirements-checklist`, `/compare/vercentlabs-vs-odoo`) via a real `document.documentElement.scrollWidth <= clientWidth + 1` assertion — 20 route×width combinations, all passing. New this phase: `tests/e2e/mobile-conversion.spec.ts`.
- **Full E2E route suite** (9 spec files, 548 tests including the new `attribution.spec.ts`) run against both `desktop-chromium` (1440px) and `mobile-chromium` (Pixel 7 emulated) projects — confirmed 548/548 passing against the verified production build (545 in the main run + 3 flaky-under-load failures confirmed passing on isolated retry — see `decision-log.md` item 9).
- **Existing visual-review captures** (`visual-review.spec.ts`, carried forward from Phases 3-6, re-run this phase as part of the full regression pass) continue covering the wider desktop set (1440/1920px) and mobile 320/390px screenshots across the full route inventory — not re-captured wholesale this phase since no visual/layout change was made to any of those routes (the only visual-adjacent change this phase — the LCP `priority` fix — affects loading order, not layout, and CLS measurements before/after confirm no layout shift was introduced: 0 or near-0 on every route, both runs).
- **Real axe-core accessibility scan** at the actual rendered mobile viewport (Pixel 7 project) across 13 representative routes — 13/13 pass, which also indirectly validates that responsive layout changes didn't introduce a new off-screen or unreachable interactive element (axe flags elements with zero dimensions or `display:none` incorrectly applied to a still-referenced control).

## Specific findings from this phase's real testing

- No route in the 4-route/5-width sweep showed horizontal overflow at any width, including 320px — the narrowest width tested, and the one most likely to expose a fixed-width element or an unwrapped flex row.
- The sticky mobile CTA and header CTA never render simultaneously at any of the 5 widths on the homepage — real, MEASURED confirmation (not assumed) of the Phase 6 collision-bug fix holding.
- The mobile nav dialog opens, a module group expands, and the footer remains scroll-reachable at the narrowest tested width (320px) — confirmed via real interaction, not just a screenshot.

## Not done this phase (disclosed gap, consistent with prior phases' practice)

- The 5-width sweep covers 4 representative routes, not the full ~74-route inventory — matching the brief's own sampling strategy (deep review on representative routes, broader smoke coverage via the existing route-suite specs on everything else).
- Tablet-width (768px) breakpoint behavior was not specifically re-verified this phase — consistent with Phase 6's own note that no component uses a tablet-specific breakpoint that would diverge from the tested narrow/wide pair; still a low-but-nonzero risk, unchanged from the prior phase's assessment.
- Virtual-keyboard-triggered viewport resize (a real mobile browser behavior when an on-screen keyboard opens) is not simulable in Playwright — disclosed explicitly in `mobile-conversion-audit.md` rather than silently assumed fine.
