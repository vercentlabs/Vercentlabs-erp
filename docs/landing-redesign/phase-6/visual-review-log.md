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

**Method:** 6 independent reviews dispatched in parallel against a live production server: `seo-aeo-geo-reviewer`, `brand-design-reviewer`, `ux-cro-reviewer`, and `frontend-quality-reviewer` ran as their own dedicated agent types; `comparison-fact-checker` and `content-quality-auditor` ran via `general-purpose` with the specialist persona and task embedded directly in the prompt, since this session's newly-authored `.claude/agents/*.md` definitions for those two weren't hot-loaded into the runtime's available agent registry yet (a real, disclosed limitation of creating and using custom agents within the same session — noted for future sessions, since a fresh session should pick them up normally).

**13 real findings, all investigated and either fixed or explicitly recorded as out-of-scope:**

1. **Real regression** (seo-aeo-geo-reviewer): this cycle's own earlier fix (populating `erp-buying-guide`'s `relatedModuleKeys`) caused it to silently shadow more specific guides on `/modules/manufacturing`/`stock`/`procurement` via plain array-order selection. **Fixed** — specificity-sorted selection, new E2E regression test.
2. Missing `FAQPage` JSON-LD on the requirements checklist (seo-aeo-geo-reviewer). **Fixed.**
3. Comparison page's sitemap `changeFrequency` didn't reflect its documented shorter review cycle (seo-aeo-geo-reviewer). **Fixed** — bumped to weekly.
4. `/resources/feed.xml` fully undiscoverable, no `<link rel="alternate">` (seo-aeo-geo-reviewer). **Fixed.**
5. Glossary index `ItemList` JSON-LD missing `item`/`url` (seo-aeo-geo-reviewer). **Fixed.**
6. `entity-architecture.md` silently normalized the 4-vs-3-industries discrepancy against `information-architecture.md` (seo-aeo-geo-reviewer). **Fixed** — explicit cross-reference footnote added.
7. 3 index/hub pages (`/resources`, `/resources/glossary`, `/compare`) had no mid-page/final CTA, violating `conversion-architecture.md` (ux-cro-reviewer). **Fixed** on all 3.
8. Requirements checklist's "Print this checklist" had no actual print stylesheet (ux-cro-reviewer, confirmed via `page.emulateMedia`). **Fixed** — verified via a re-check that `header`/`footer` are `visible: false` under print media emulation post-fix.
9. Progress-counter wording ambiguity, "X of 73 marked" (ux-cro-reviewer). **Fixed** — reworded to "groups reviewed."
10. `/book-demo`'s redirect-based success flow doesn't match `conversion-architecture.md`'s documented in-page-state default (ux-cro-reviewer) — **pre-existing Phase 3 architecture, recorded not fixed**, out of this phase's scope.
11. Resource-guide body copy had no `max-w` constraint, unlike every other long-form template on the site (brand-design-reviewer). **Fixed** — `max-w-[70ch]` added.
12. Requirements checklist's filter buttons had no `aria-pressed` (frontend-quality-reviewer). **Fixed.**
13. **Highest-stakes finding**: the root production `start` path depended on a manual `prepare-standalone.mjs` step nothing in the automated build chain guaranteed (frontend-quality-reviewer, reproduced from a clean build). **Fixed** — folded into `apps/landing`'s own `build` script.

**Stale/environmental findings investigated and resolved, not real code defects:** Multiple agents independently hit a broken-CSS/500 state mid-review, traced to a stale standalone server process combined with concurrent agents each running their own diagnostic builds against the same shared local server (one agent's own build collided with the running server's file lock, by their own account). Confirmed via a direct investigation (checked the actual served CSS chunk against what existed on disk, found a real mismatch, fixed via a clean stop→build→restart cycle, re-verified via a real screenshot showing fully-styled pages). Not a Phase 6 code regression, and finding 13's fix makes this class of issue structurally less likely in a real deploy going forward.

**Comparison-fact-checker's independent re-verification**: re-fetched both `odoo.com` sources live (including raw HTML, not just summarized output) and confirmed all 5 `ODOO_COMPARISON_EVIDENCE` claims still hold; one wording-precision improvement applied to the multi-company dimension (not a factual correction).

**Content-quality-auditor's rubric scores**: `erp-vs-spreadsheets` and `/compare/vercentlabs-vs-odoo` scored clean Ships; `erp-buying-guide` scored "Ship with follow-ups" (3 Weak dimensions, root-caused to the same empty `relatedModuleKeys` gap fixed in finding 1 above — the fix doubled as the remediation); `glossary/mrp` scored a clean Ship at the edge of the threshold, with a disclosed, intentional content overlap with `manufacturing-erp-guide`'s MRP section noted for future monitoring, not required to fix.

## Cycle 3 — Full regression

**Method:** Clean rebuild using the now-fixed `build` script (confirmed `prepare-standalone.mjs` runs automatically — build output ends with "Prepared standalone output at..."), fresh server boot with zero manual steps, confirmed the CSS chunk serves correctly on first request (no repeat of Cycle 2's environmental issue).

**Results:**
- Full E2E suite, `desktop-chromium` project, all 5 spec files (`phase5-routes`, `phase6-routes`, `module-routes`, `production-smoke`, `visual-review`): **216/216 passed**, 0 failures.
- `phase6-routes.spec.ts` on `mobile-chromium`: **35/35 passed** (32 original + 3 new module-backlink-specificity regression tests), including confirmation that `/modules/manufacturing` → `manufacturing-erp-guide`, `/modules/procurement` → `erp-vs-spreadsheets`, `/modules/sales` → `erp-vs-spreadsheets` (the exact regression from finding 1, now fixed and permanently guarded).
- Print stylesheet re-verified via `page.emulateMedia({ media: "print" })`: `header`/`footer` both `visible: false`.
- `packages/landing-content` unit suite: **121/121 passed**.
- `pnpm content:cannibalization`: 1 finding (the pre-existing, already-reviewed `/modules/manufacturing` vs. `/industries/manufacturing` title match — see `cannibalisation-review.md` item 8), no new collisions.
- `pnpm content:stale`: 0 overdue routes.
- `typecheck`/`lint`: clean throughout every fix in this cycle.

No new findings surfaced in Cycle 3 — every Cycle 2 fix held up under a full, independent regression pass.
