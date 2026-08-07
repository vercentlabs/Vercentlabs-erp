# Visual Review Log

Three-cycle review discipline, same as Phases 2-5: Cycle 1 self-review against a real production build, Cycle 2 parallel specialist agents against the live build with explicit stale-finding verification, Cycle 3 full production regression after fixes land.

## Cycle 1 — Self-review

**Method:** Real production build (`pnpm --filter @vercentlabs/landing build`, 72 static pages), booted via the standalone `server.js` (never `next dev`). Captured real screenshots via `apps/landing/tests/e2e/visual-review.spec.ts`'s new "Phase 6" block — resource hub, ERP buying guide, requirements checklist, glossary index, one glossary term (RBAC), compare index, and the Odoo comparison page, at desktop (1440px), mobile (390px), and 320px. 21 captures reviewed directly (not assumed from code).

**Findings:**

1. **CONFIRMED, fixed** — `/resources/glossary` index links had no persistent visual affordance distinguishing them from plain text; only a hover state revealed they were clickable. Fixed by adding a permanent subtle underline. See `decision-log.md` item 8.

**Verified clean (no action needed):**
- `/resources` hub — categorized sections render correctly, real dates, alternating tone bands read cleanly, footer/nav Resources links present.
- `/resources/erp-requirements-checklist` — all 73 capability groups render as real crawlable text/checkboxes at both viewports; filter buttons wrap cleanly at 320px with zero horizontal overflow (verified via `document.documentElement.scrollWidth === clientWidth`); the "0 of 73 marked · Print this checklist" row and per-item "See how Vercentlabs implements this" links render correctly at 320px.
- `/resources/erp-buying-guide` — sidebar TOC + key-takeaways box + FAQ accordion + related-resources section all render correctly on desktop; matches Control Surface discipline (hairline borders, no gradients, tight radii).
- `/resources/glossary/rbac` — definition block, "How Vercentlabs handles it" panel with module tags, related-terms links, and contextual CTA all render correctly.
- `/compare` and `/compare/vercentlabs-vs-odoo` — the responsive `DecisionMatrix` table renders as a real `<table>` on desktop; confirmed a real `scrollWidth`/`clientWidth` equality check at 320px (no horizontal overflow) rather than assuming the CSS breakpoint logic was correct from reading the component alone. Source links to `odoo.com` render and are real.

**Regression check:** Re-ran the full pre-existing Phase 5 (31 tests), module-routes (16 tests), and production-smoke (16 tests) E2E suites after this session's changes (module-page resource-guide backlinks, footer Resources column, `/solutions/workflow-automation`'s rename, sitemap additions) — all 63 passed, confirming zero regressions from Phase 6 work landing on top of Phase 5.

## Cycle 2 — Parallel specialist agents

Pending — see the plan: reuse `seo-aeo-geo-reviewer`, `brand-design-reviewer`, `ux-cro-reviewer`, `frontend-quality-reviewer`, plus the new `comparison-fact-checker` and `content-quality-auditor`, run against the live production build in parallel, with explicit re-verification of every finding before any fix lands (never trust a stale or assumed finding).

## Cycle 3 — Full regression

Pending — rebuild after Cycle 2 fixes land, re-run the complete E2E suite (all spec files, both viewport projects), re-verify citations/source links/sitemap dates/noindex exclusion/feed validity/mobile/comparison-table/requirements-checklist usability end to end.
