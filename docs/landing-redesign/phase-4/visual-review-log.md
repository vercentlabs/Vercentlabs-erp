# Visual Review Log — Phase 4

## Cycle 1 — Shared template review

Rendered `/product`, `/modules`, one simple module page (`/modules/support`), one complex module page (`/modules/crm`), `/security`, `/product/integrations` at desktop (1440px) and mobile (390/320px) against a real production build+boot, per the brief's exact page list.

**Findings and fixes:**
1. Footer's "Industries" column linked to 3 non-existent `/industries/{slug}` routes on every page site-wide — amplified from a pre-existing Phase 2/3 gap to a 32-page-wide issue. Removed the column; rebalanced the footer grid from 6 to 5 columns. See `decision-log.md` item 4.
2. A screenshot-timing false alarm: the CRM module page's secondary screenshot appeared blank in a full-page capture. Investigated directly (curl against the image-optimization endpoint, DOM `naturalWidth`/`complete` state, a recapture with an explicit settle wait) and confirmed the image, pipeline, and render were all correct — a lazy-load race in the capture script, not a defect. `visual-review.spec.ts`'s Phase 4 block adds an explicit 500ms settle wait after `networkidle` specifically to avoid this at scale.
3. Content-accuracy self-check (not a reviewer finding — caught while writing `module-content-architecture.md`): 3 modules (`point-of-sale`, `support`, `hr-payroll`) were content-assigned a screenshot-based `heroVariant` despite having zero approved screenshots. `ModuleHero`'s defensive fallback meant nothing was ever visually broken, but the content itself was internally inconsistent. Corrected directly. See `decision-log.md` item 5.

## Cycle 2 — Full route review + four independent reviewer passes

Captured all 19 new routes at 1440px and 390px (38 capture tests × 2 Playwright projects = 76 executions; 182 total visual-capture tests including the homepage/book-demo/thank-you/design-system suite, all passing). Four specialized reviewer subagents then inspected the real screenshots and live server independently and in parallel: UX/CRO, SEO/AEO/GEO, brand/design, frontend-quality.

### Confirmed findings and resolutions

| # | Finding | Reviewer(s) | Severity | Resolution |
|---|---|---|---|---|
| 1 | Accounting module page displayed a real Sales screenshot under an "Accounting screens" heading/caption | Frontend-quality, UX/CRO, brand/design (all three independently) | Critical — evidence-honesty violation | Set `accounting.screenshots = {}`; corrected `heroVariant` to `operational-sequence`; added a permanent regression test (`apps/landing/tests/lib.test.mjs`, "every module's referenced screenshot id actually belongs to that module") |
| 2 | `ANALYTICS_EVENTS`'s runtime array (`navigation.js`) had drifted behind its own `.d.ts` type declaration — 7 event names typechecked with no runtime backing | Frontend-quality | High — silent type-safety hole, same bug class Phase 3 fixed once already | Added the 7 missing names to the runtime array; documented the drift risk directly in the file's own comment |
| 3 | No persistent mobile "Book a Demo" CTA on any of the 32 new pages — `StickyMobileCta` was wired into the homepage only | UX/CRO | Severe — direct violation of `conversion-architecture.md`'s "demo conversion must never require opening the mobile nav menu" rule | Moved `StickyMobileCta` to the root layout (mounted once, globally), self-hiding on `/book-demo*` routes via `usePathname()` |
| 4 | Two platform pages' final-CTA heading naively lowercased an acronym title ("Mobile ERP" → "mobile erp", "Integrations & APIs" → "integrations & apis") | Frontend-quality (implicitly, via the `.toLowerCase()` pattern) — caught while implementing the sticky-CTA fix, the same pattern was found a second time in a new mid-page CTA I was adding | Moderate — visible copy bug | Added a `finalCtaHeading` field (hand-written per page) to `PlatformPageContent`, removed the `.toLowerCase()` call |
| 5 | Module pages' body copy lowercased acronym module names ("What makes crm hard...", "a real hr & payroll process...") | SEO/AEO/GEO | Moderate — GEO entity-consistency violation | Removed the `.toLowerCase()` calls; capitalized module names read correctly in both instances |
| 6 | `BreadcrumbList` (and the visible breadcrumb trail) omitted "Home" on every one of the 19+ pages that render breadcrumbs | SEO/AEO/GEO | Moderate — spec deviation from the documented `Home / Modules / {Module}` pattern | Fixed once, at the `Breadcrumbs` component level — it now always prepends `{name: "Home", path: "/"}` to whatever trail a caller passes, so no future call site can omit it |
| 7 | Module pages' `isPartOf` referenced a disconnected duplicate `SoftwareApplication` object with no `@id`, rather than the one real entity | SEO/AEO/GEO | Moderate — undercuts the deliberate "one SoftwareApplication" design intent at the schema-graph level | Added a stable `SOFTWARE_APPLICATION_ID` export (`lib/seo/json-ld.ts`); the homepage's entity now declares it, module pages reference it via `isPartOf: { "@id": ... }` |
| 8 | Platform pages with real, visible FAQ content (`/product/mobile`, `/security`) emitted no `FAQPage` JSON-LD, unlike module pages | SEO/AEO/GEO | Moderate — AEO spec violation | `PlatformPageTemplate` now emits the same conditional `FAQPage` JSON-LD pattern module pages use, generated from the same `content.faqs` data the visible accordion renders |
| 9 | `ModuleWorkflow`'s "Approvals"/"Automated actions"/"Connected modules" sub-headings skipped from h2 directly to h4 | SEO/AEO/GEO | Low — heading-nesting best practice, not a WCAG AA failure | Changed to h3 |
| 10 | No mid-page contextual CTA on module pages or `/modules` — pages went straight from proof/capability content into 6+ more sections with zero re-engagement point | UX/CRO | High — spec violation (`conversion-architecture.md` requires 3 CTA touchpoints: header, mid-page, final) | Added `ContextualCta` (new component) after `ProductEvidenceSection` on every module page; added an equivalent mid-page CTA to `PlatformPageTemplate`; added a hero CTA to `/modules` index (previously had none at all) |
| 11 | All 6 platform-page heroes with no screenshot rendered as bare copy over empty space — the explicitly prohibited "huge empty hero" pattern | Brand/design | Critical | `PlatformHero` now renders a real "Built into" module-tag cluster (sourced from `connectedModuleKeys`, already-modeled real data) as the visual anchor when no screenshot exists |
| 12 | `ModuleTag` in the hero metrics row only appeared for the 4 product-sourced-color modules, creating an unintended 8-vs-4 layout asymmetry | Brand/design | Moderate | Now shown for all 12 modules — `ModuleTag` is a color legend, not a provenance claim, so the original gating didn't serve any honesty purpose |
| 13 | Thank-you page's secondary CTA linked to `/product-tour`, a route that returns a live 404 | UX/CRO | Moderate — broken link on a page in active production use | Repointed to `/product` (now a real page, built this phase) |

### Findings investigated and found to be stale (not real, at time of final report)

Two brand/design findings (its #1, re-confirming the Accounting screenshot bug, and its #6, claiming the `heroVariant` content fix wasn't actually applied) were based on captures/reads taken before the corresponding fixes landed mid-session. Both were independently re-verified against the current file state after all fixes were applied and confirmed correct — not additional outstanding work. This is recorded so the discrepancy between "4 reviewers, but only 3 distinct root-cause reports for the Accounting bug" doesn't read as an inconsistency in this log.

### Deferred (documented, not fixed this phase)

- FAQ count per module (3, vs. the 4-6 `seo-aeo-geo-architecture.md` recommends) — real content-authoring lift across 12 modules, deferred to a dedicated content pass.
- Meta description length (several module pages run 160-198 characters, above the ~155-160 SERP-safe range) — deferred, cosmetic/tuning, not a spec violation.
- Title pattern deviation from the documented `{Value Prop} | {Subject} | Vercentlabs` template (titles are still unique; just a shorter pattern) — deferred, documentation-reconciliation item.
- `ProductCallout` (in-image numbered annotations) built but unused on any real screenshot, captions-only shipped instead — recorded as a deliberate Phase 4 scope decision, not silently dropped; see `decision-log.md`.
- `WorkflowConnector`'s mobile fallback renders a trailing horizontal line rather than a clean vertical connector between steps — minor, pre-existing Phase 3 component quadrupled in exposure this phase; deferred to a polish pass.
- Per-page `lastReviewed` freshness signal (sitemap currently reuses one global date for all 22 entries) — deferred, would need a broader content-model change across both `modules.js` and `platform-pages.js`.
- Header's primary CTA uses plain `ButtonLink`, not `TrackedCtaLink` — unmeasurable via the site's own analytics. Pre-existing since Phase 2/3 (not introduced this phase), wide blast radius (every page site-wide), deferred rather than rushed.

## Cycle 3 — Final regression

After applying the fix batch: rebuilt production, rebooted the real server, re-ran the full test suite. **182/182 Playwright tests passing** (production smoke, module/platform route smoke tests including 404 and redirect handling, book-demo module-preselection, and the full 76-execution visual-capture matrix across both desktop and mobile Playwright projects) — zero failures, zero console errors, zero network errors. 73 unit/content-integrity tests passing (38 in `packages/landing-content`, 35 in `apps/landing`, including the new screenshot-ownership regression test). Confirmed via a second, independent full-suite run (182/182 again) that the result is stable, not a fluke.
