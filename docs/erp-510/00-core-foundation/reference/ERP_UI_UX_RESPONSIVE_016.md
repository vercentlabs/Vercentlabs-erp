# Vercentlabs ERP — UI/UX, Design-System, Responsive-Web, and Accessibility Overhaul (Prompt 16)

Companion doc: `ERP_UI_UX_BUG_REGISTER_016.csv` (44 findings — 26 `FIXED`, 18 `DEFERRED_WITH_REASON`, 0 `NOT_A_BUG`). This document explains the audit methodology, what was actually changed, what was deliberately deferred and why, and what remains for a future pass.

## 1. Scope and mandate

This was a systematic product-design correction across `apps/landing` and `apps/web`, not a cosmetic pass: audit real rendered pages under real data at real viewports, produce an evidence-backed bug register, fix the highest-severity/best-effort-ratio findings directly, and leave everything else honestly documented rather than silently skipped. The hand-written CSS system in both apps was strengthened in place — no Tailwind/MUI/Chakra/Bootstrap migration was made or considered, per this prompt's explicit constraint.

## 2. Why Prompt 16 (not Prompt 17) does this work

Prompt 15's own execution plan placed "Quality-hold cross-module enforcement" at Prompt 16, before this UI/UX prompt was issued. That feature work has been moved to Prompt 17; see `ERP_EXECUTION_PLAN_016_102.md`'s "Why Prompt 16 changed" section for the full renumbering rationale (the 8 shared-blocker prompts 16–23 were compressed to 7 slots, 17–23, by merging two small blockers, so nothing from Prompt 24 onward needed renumbering).

## 3. Audit methodology

Three parallel research agents ran against real, running instances of both apps (not static code reading alone):

- **Landing UI/UX audit**: ran the full Playwright e2e suite (`production-smoke`, `mobile-conversion`, `accessibility`) against a real production build (`.next/standalone`), then did live `getBoundingClientRect()`/`scrollWidth` measurement at the failing viewports to find root causes, not just symptoms.
- **ERP page/component audit**: read every module dashboard and generic fallback page against `apps/web`'s actual CSS files (`globals.css`, `operator-workbench.css`, `enterprise-modules.css`, `business-data-extension.css`), grepping for every className referenced in JSX against every className actually defined anywhere in the stylesheet set.
- **Accessibility audit**: ran the landing a11y suite at both default (parallel) and `--workers=1` concurrency to separate real violations from infrastructure flakiness, and read ERP component source for missing labels/roles/focus-visible styling.

I then did my own direct, live-browser verification: created a real authenticated session (the actual `sessions` table row/token scheme, not a mock), drove `apps/web`'s dev server with Playwright at 1440×900, 768×1024, and 390×844, and found two additional real bugs (`TOPBAR-001`, `SIDEBAR-001`) neither agent had exercised, since both only manifest with a real authenticated session and a real collapsed-sidebar/mobile-drawer interaction.

## 4. The two most severe findings (P0) and why they matter

**TOPBAR-001** — every authenticated ERP page overflowed the viewport horizontally at tablet (768px, by 373px) and mobile (390px, by 406px) widths. Root cause was two independent, compounding cascade bugs: `.topbar > .context-switcher` used `flex: 0 0 auto` (never shrinks, regardless of its own grid's `minmax(0,...)` tracks), and `operator-workbench.css` (loaded after `globals.css`) carried an unconditional `.global-search { width: min(100%, 620px) }` with no media guard, silently overriding `globals.css`'s own responsive shrink-to-icon rule. This is exactly the class of defect this prompt's "Global Responsive Invariant" requirement exists to catch.

**LAND-001** — the landing site's shared `Grid` layout primitive had a hard, unshrinkable minimum-width floor of `(tracks−1) × gap` on any spanning item, because `gap` between grid tracks is a fixed pixel length that cannot shrink even though `minmax(0,1fr)` tracks can collapse to zero. At `gap-10`, a single-column mobile item still carried an 11×40px = 440px floor — wider than every supported phone viewport — causing confirmed overflow on the homepage, `/book-demo` (the site's primary conversion route), every module page, every workflow page, and `/implementation`.

Both were found, root-caused, fixed, and re-verified live (exact `scrollWidth == innerWidth` match at every previously-failing viewport) in this prompt.

## 5. Design-system and typography

No new typographic scale was introduced; existing type tokens in both apps were reused as-is. The one live-text contrast defect found (`--color-muted-light` at ~2.6:1, used for 9-10px captions/labels in 5 places) was fixed by switching those 5 call sites to `--color-muted` (~4.97:1, AA-compliant), reserving `--color-muted-light` for disabled/decorative use only, matching how the landing app's equivalent token is already scoped.

## 6. Spacing, radius, shadow, color, status, z-index

The documented `--z-*` scale (`--z-base`, `--z-sticky`, `--z-dropdown`, `--z-drawer`, `--z-modal`, `--z-toast`) added in this prompt's earlier direct-implementation work remains the reference scale; `.sidebar` and `.command-palette-overlay` were migrated onto it as part of building the new shell components. A full codebase-wide sweep of every remaining z-index literal was out of scope for this pass — see Section 24.

## 7. Landing: navbar and header

Fixed `LAND-008`: the "Modules" mega menu (up to 880px wide, centered under its trigger) rendered with its left edge off-screen at 1024–1110px, because the trigger sits a measured, roughly-constant 109px left of true viewport-center at every audited width, and the panel's own width (90vw, effectively ~90% of a 1024px viewport) left no safe margin in either direction. Narrowed the panel's width fraction to `min(70vw, 880px)`; algebraic verification against the audit's own 4 measured data points confirms the centered panel now stays within the viewport with margin to spare from 1024px up.

## 8. Landing: hero and section system

`LAND-009` (hero height doesn't account for the `AnnouncementBanner`'s height on first visit, so the hero's bottom edge sits 44px past the viewport) was documented but deliberately deferred — a robust fix needs either a runtime-measured CSS custom property via `ResizeObserver` or a considered scope reduction of the "exact viewport fit" claim in the component's own doc comment; both are design decisions better made deliberately than patched under this prompt's time budget.

## 9. Landing: cards and product visuals

No defects found in this pass beyond the `Grid` component's overflow floor (Section 4), which also affected card-grid layouts using `Grid` at narrow viewports and is resolved by the same fix.

## 10. Landing: CTA system, Book Demo, and lead forms

`/book-demo` was the single highest-priority instance of the `Grid` overflow bug (the site's primary conversion route, with a documented history of Playwright instability). It is now confirmed overflow-free at all 5 standard mobile widths (320/360/375/390/412px) via `tests/e2e/mobile-conversion.spec.ts`. `LAND-010` (duplicate honeypot field labels) was deliberately deferred — axe-core reports zero violations, and changing honeypot labeling risks interacting with the form's actual anti-spam detection logic, which needs the form author's confirmation, not a guess.

## 11. Landing: footer

No defects found in this pass.

## 12. Landing: animation and reduced motion

No changes made or needed; existing `prefers-reduced-motion` handling was not touched.

## 13. Landing Playwright investigation (root-cause, not "pre-existing")

`A11Y-001`: 8 of 13 `accessibility.spec.ts` tests failed with a 30-second timeout under this project's default `fullyParallel` concurrency — root-caused (not just labeled "flaky") as resource contention from running a full `axe-core` scan plus `networkidle` navigation against one production server under many concurrent Chromium workers. Re-run at `--workers=1`, all 13 pass cleanly with zero violations. Fixed by adding `test.slow()` (triples the per-test timeout) to every test in the file, so a genuine hang still fails loudly while normal parallel-worker contention no longer produces false failures. Verified: 13/13 pass at `--workers=1` after the fix, matching the audit's own diagnosis exactly. The full landing e2e suite (305 tests, all spec files, `--workers=1`) was also run end-to-end after all fixes: **305/305 passed**, zero regressions.

## 14. ERP shell: desktop sidebar (expanded and collapsed rail)

The collapsed/rail sidebar state (~72px, icon-only) was already built in this prompt's direct-implementation phase before the audit agents ran. Manual visual verification during this prompt's required final-inspection step (Section 26) found a real bug the earlier work had missed: **`SIDEBAR-001`** — module group headers (`<details><summary>CRM</summary>`, a separate component from the leaf nav-link pattern) use their own `.nav-section-label`/`.nav-section-chevron` classes that the collapsed-mode CSS never targeted, so every module group name rendered as wrapped, visible multi-line text inside the narrow rail instead of collapsing to an icon. Fixed and re-screenshotted, confirming a clean icon-only rail.

## 15. ERP shell: tablet navigation

The mobile drawer (Section 16) serves tablet widths as well as mobile — confirmed via live screenshot at 768×1024 showing the drawer trigger, panel, and full navigation tree rendering correctly with no overflow.

## 16. ERP shell: mobile drawer and bottom navigation

Both were newly built in this prompt (previously a `<details>`-based hamburger hack with no real dialog semantics). The drawer is a real `role="dialog" aria-modal="true"` panel with focus-trap, body-scroll-lock, initial-focus-on-open, Escape-to-close, and auto-close on route change. The bottom nav (Home/My Work/Search/Modules/Profile) dispatches `CustomEvent`s to open the command palette and drawer respectively, matching this codebase's own established pub-sub convention for cross-component triggering. Both verified via live screenshot at 390×844 with zero horizontal overflow.

## 17. ERP shell: topbar responsive hierarchy

Fixed `TOPBAR-001` (Section 4) — the root cause of every authenticated page's tablet/mobile overflow. Verified fixed at 768px and 390px with exact `scrollWidth == innerWidth` matches.

## 18. ERP shell: company/branch switcher

Fixed as part of `TOPBAR-001`: `.context-switcher` now genuinely shrinks under space pressure (`flex: 0 1 auto`, `min-width: 0`, grid tracks changed from hard `px` floors to `minmax(0, ...)`), with `text-overflow: ellipsis` added to its select/label text so compression degrades visually rather than clipping abruptly.

## 19. ERP shell: command palette focus trap

Built in this prompt's direct-implementation phase (real Tab/Shift+Tab wrap between first/last focusable elements, queried fresh on every keydown; body-scroll-lock; listens for the bottom nav's `vercentlabs:open-command-palette` event). Verified via live screenshot showing correct dialog rendering, focused search input, and dimmed overlay.

## 20. Quick Create, notifications, profile menu

`A11Y-008` (three topbar popovers use `role="menu"`/`"menuitem"` without the ARIA APG keyboard-navigation model — no arrow-key movement, no initial-item focus) was audited and documented but deliberately deferred: implementing a real roving-tabindex model is a behavioral change to 3 shared, frequently-used components with real regression risk, better done as its own focused, tested pass than folded into an already-large prompt.

## 21. Page-header system, content-width variants, card system

`ERP-005` (8 generic fallback pages use a raw `h1` instead of the shared `.page-heading` structure) was documented but deferred alongside `ERP-004`/`ERP-006` as one coordinated future change to the same 8 files, rather than three separate partial edits.

## 22. Table, form, button, dropdown, modal, drawer, filter-bar normalization

Fixed: `ERP-001`/`ERP-002` (8 module dashboards plus 3 additional real instances found during verification — `role-manager.tsx`, a second `user-administration.tsx` usage, `procurement/page.tsx` — referenced undefined CSS classes, rendering primary action buttons as bare underlined text; renamed to the established `.module-workbench`/`.module-hero-actions`/`.primary-button`/`.secondary-button`/`.resource-cards`/`.action-row` classes already used correctly elsewhere), `ERP-003` (undefined `.table-shell` wrapper on 8 fallback pages, replaced with the real `.table-panel` class), `ERP-007` (dead `position: sticky` on table headers, removed rather than risk a page-wide scroll-behavior change to make it real). Deferred: `ERP-004`/`ERP-005`/`ERP-006` (fallback-page empty-state/heading/pagination consistency), `ERP-008`/`ERP-009` (BusinessDataManager over-fetch and text truncation), `ERP-010` (Accounting mobile field labels), `ERP-012` (18 components missing error-state styling), `ERP-013` (native `window.confirm()` instead of an in-app dialog), `ERP-014` (audit-logs filter-bar column mismatch), `A11Y-009` (DownwardSelect listbox keyboard model, same reasoning as `A11Y-008`) — all with reasons recorded in the bug register.

## 23. Dashboards and per-module page normalization

All 12 module dashboards were checked. 8 had the broken-button/broken-card-grid defect (Section 22, fixed). `ERP-020` (Stock's dashboard is the only one fetching client-side with a silent-failure catch, unlike its 7 server-fetched siblings) was documented but deferred as an architecture change, not a styling fix, better folded into Stock's own module-completion campaign. Per-module cautions from this prompt's own scope were honored: no Quality-hold functionality was started (moved to Prompt 17), no fake POS checkout UI was designed, no claim was made that payroll works correctly.

## 24. Breakpoint/CSS-architecture consolidation

Two real cross-file cascade conflicts were found and fixed, both following the same pattern (an unconditional or non-shrinking rule in a later-loaded stylesheet defeating an earlier responsive rule): `TOPBAR-001`'s `operator-workbench.css` vs `globals.css` conflict (Section 4), and `ERP-018` (`.module-context-bar`'s sticky `top` offset was stale at 58px/54px after `operator-workbench.css`'s later-loaded topbar `min-height` rule changed the topbar's actual rendered height to 64px/62px — fixed to match). A full sweep of the 10-file, inconsistent-breakpoint-value problem documented in earlier prompts was not undertaken in this pass; the two conflicts found were fixed as concrete bugs, not as a preventative full rewrite.

## 25. Accessibility: landmarks, headings, focus, keyboard, screen-reader labels, contrast

Fixed: `A11Y-002` (unlabeled primary sidebar `<nav>`), `A11Y-003`/`A11Y-004`/`A11Y-005`/`A11Y-006`/`A11Y-007` (6 different focus targets across both apps had `outline: none` with no `:focus-visible` replacement — the skip-link's landing target on both `apps/web` and `apps/landing`, the mobile drawer panel, the master-data search input, and the post-demo-request confirmation heading — all given a visible focus-visible ring, or in the landing skip-link's case, a Tailwind `focus:outline-none` utility was removed entirely rather than risk re-losing the fix to the same cascade-order race the audit found), `A11Y-010` (2 unlabeled search inputs on Sales Orders/Quotations), `A11Y-011` (2 fully div-based fake tables given `role="table"/"row"/"columnheader"/"cell"` — the audit's own documented fallback when a full `<table>` conversion isn't feasible without a larger visual-risk change), `A11Y-012` (contrast fix, Section 5), `ERP-011` (missing `aria-label` on an icon-only "remove line" button). Deferred: `A11Y-008`/`A11Y-009` (ARIA menu/listbox keyboard-navigation models — behavioral, regression-risk, better as a focused pass).

## 26. Manual visual inspection (required before finishing)

Performed at 1440×900 (desktop, both expanded and collapsed sidebar), 768×1024 (tablet, drawer open), and 390×844 (mobile, bottom nav and drawer-via-Modules) against a real authenticated session on the real running `apps/web` dev server. This inspection is what found `SIDEBAR-001` (Section 14) — a real defect the two earlier audit agents' static/scripted checks had not caught, since it only manifests visually with a real collapsed-sidebar interaction. All 5 screenshots were re-verified overflow-free after all fixes; the collapsed-sidebar screenshot was re-captured after the `SIDEBAR-001` fix to confirm a clean result.

## 27. What remains (honest accounting)

18 of 44 tracked findings are `DEFERRED_WITH_REASON` in `ERP_UI_UX_BUG_REGISTER_016.csv`, each with a specific reason (architecture-change risk, wide blast radius better done as its own reviewed pass, unverified-live source-inferred risk, or a product decision needed before changing behavior). None were skipped silently. The two Shared feature-matrix rows this prompt's work genuinely touches (`SHARED-068` Responsive web application, `SHARED-079` Accessibility) remain `PARTIAL` — real, evidence-backed progress was made and the most severe confirmed defects were fixed, but both still have real, individually-tracked gaps, so moving either to `COMPLETE` would be inaccurate. Recommended next steps: a focused ARIA-keyboard-interaction pass (`A11Y-008`/`A11Y-009`), a coordinated single pass over the 8 generic fallback pages (`ERP-004`/`005`/`006`), and the 18-component error-styling sweep (`ERP-012`) — all natural candidates for the Prompt 90/91 accessibility and responsive/mobile-web audit slots already reserved in `ERP_EXECUTION_PLAN_016_102.md`.
