# Responsive Validation — Phase 6

## What was actually tested (not assumed from CSS)

- **Real production build** (`pnpm --filter @vercentlabs/landing build`), booted via the standalone `server.js` — every check below ran against this, never `next dev`.
- **No-horizontal-overflow checks at 320px** for the two pages with the most layout complexity, via a real Playwright `document.documentElement.scrollWidth === clientWidth` assertion (not visual inspection alone):
  - `/compare/vercentlabs-vs-odoo` (the `DecisionMatrix` comparison table) — confirmed `scrollWidth <= clientWidth + 1` at 320px, both in `phase6-routes.spec.ts` (automated, CI-repeatable) and manually re-verified during Cycle 1.
  - `/resources/erp-requirements-checklist` (the filter-button row + 73 checklist items) — confirmed `scrollWidth === clientWidth` exactly at 320px via a manual Playwright check during Cycle 1; not yet promoted to an automated spec assertion (see Remaining Risks in the completion report).
- **Real screenshots reviewed directly** (not just captured and assumed fine) at desktop (1440px), mobile (390px), and 320px for: `/resources`, `/resources/erp-buying-guide`, `/resources/erp-requirements-checklist`, `/resources/glossary`, `/resources/glossary/rbac`, `/compare`, `/compare/vercentlabs-vs-odoo` — 21 captures, via `apps/landing/tests/e2e/visual-review.spec.ts`'s Phase 6 block.
- **Full E2E route suite** (`phase6-routes.spec.ts`, 32 tests) run against both `desktop-chromium` (1440px) and `mobile-chromium` (Pixel 7 viewport) projects — 64 total runs, all passing, zero console errors on any route at either viewport.

## Specific findings from real screenshots

- The requirements checklist's filter-button row wraps cleanly into multiple rows at 320px with no overflow (verified via screenshot, not just the scrollWidth check).
- The glossary index's definition-list layout stacks correctly at all 3 widths.
- The comparison `DecisionMatrix` correctly switches from a real `<table>` (desktop) to stacked cards (mobile) — confirmed both renderings via screenshot, not just trusting the `sm:` Tailwind breakpoint exists in the source.

## Not yet done (disclosed gap)

- No systematic sweep across the full required viewport list (320/360/390/768/1024/1280/1440/1920, per `docs/landing-redesign/phase-3/responsive-validation.md`'s original required set) for every one of the ~22 new routes — only the 7 representative routes above got the full Cycle 1 treatment, matching the brief's own stated Cycle 1 scope ("resource hub, buying guide, requirements checklist, one glossary term, comparison page"). A full sweep of all 11 glossary standalone pages and all 5 remaining resource guides at every viewport is a reasonable Phase 7 (or a Cycle 3 extension) task, not completed here.
- Tablet-width (768px) was not specifically re-verified for Phase 6 content this cycle, though nothing in the new components (`DecisionMatrix`, `RequirementsChecklist`, `ArticleHeader`, etc.) uses a tablet-specific breakpoint that would behave differently from the tested 390px/1440px pair — low risk, not zero risk.
