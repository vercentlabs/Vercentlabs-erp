# Phase 4 Decision Log

## 1. Route architecture: followed the approved IA doc over the prompt's shorthand example list

**Decision:** Built exactly `/product`, `/product/platform`, `/product/automation`, `/product/analytics`, `/product/mobile`, `/product/integrations`, `/security` (canonical, `/product/security` 301s to it), `/modules`, `/modules/{12 slugs}` — per `docs/landing-redesign/phase-1/information-architecture.md`. Did not build a separate top-level `/integrations` (the prompt's own text listed it as a "minimum to evaluate" example) or duplicate `/product/security` as a real page.
**Evidence:** The IA doc is the actual approved architecture from a dedicated Phase 1 planning workstream; the prompt's route list was explicitly a "minimum, evaluate and implement the approved versions of" instruction, deferring to the real approved architecture rather than asserting its own shorthand list as authoritative.
**Reason selected:** Prompt 4 itself explicitly warns against creating duplicate routes when an approved root route exists ("do not create both `/product/security` and `/security` unless the IA explicitly requires separate purposes") — the IA doc resolves this exact question by name.
**Risks:** None identified — the redirect (`apps/landing/next.config.mjs`) handles anyone who guesses `/product/security` by analogy with the other platform pages.

## 2. Capability traceability: capability-group granularity, not 1,039 individual rows

**Decision:** `packages/landing-content/src/capability-registry.js` operates at capability-group granularity (73 groups: 67 module + 6 platform), each carrying an honest `requirementCount` allocation summing to exactly 1,039.
**Evidence:** No enumerated list of 1,039 individually-named requirements exists anywhere in the repository — the one static feature register is explicitly flagged unreliable (Phase 1 decision-log item 3). CLAUDE.md treats the 1,039 total as settled, not to be re-audited. `information-architecture.md`'s own anti-cannibalisation rule states this exact granularity is correct: "No feature-level URL exists for any of the 1,039 individual requirements — they live as capability-group content inside their module page."
**Alternatives considered:** Hand-write 1,039 individually-cited rows (would require inventing detail not evidenced at that granularity — a direct Evidence and Honesty Rules violation); flatten to a single per-module count with no group-level breakdown (loses the traceability the brief explicitly asked for).
**Reason selected:** The chosen granularity is the most detailed level the repository's real evidence actually supports, and is explicitly authorized by the IA doc's own rule.
**Risks:** A reader expecting 1,039 literal named rows might read the `requirementCount` field as more precisely audited than it is.
**Mitigation:** Documented explicitly, twice — in `capability-registry.js`'s own top comment and in `docs/landing-redesign/phase-4/capability-traceability.md`'s "Methodology" section, which states outright that this is a structural allocation, not an independent re-derivation.

## 3. Structured data: one site-wide `SoftwareApplication`, never one per module

**Decision:** Module pages emit `WebPage` with `isPartOf` referencing the single existing `SoftwareApplication` entity (declared once, on the homepage) — never a separate `SoftwareApplication` per module.
**Evidence:** This prompt's explicit instruction: "Modules are generally components of Vercentlabs ERP, not separate standalone products... Do not add a separate SoftwareApplication entity for every module." This overrides `information-architecture.md`'s older, less-specific suggestion of module-level `SoftwareApplication` schema, using the same later-and-more-specific-instruction-supersedes-earlier-general-one precedent Phase 3 established (decision-log item 5) when it made an analogous call.
**Risks/follow-up:** The SEO/AEO/GEO Cycle 2 review found the `isPartOf` reference is currently a disconnected duplicate object (no shared `@id` linking it back to the real homepage entity) rather than a true reference — see the fix status below and in `structured-data-map.md`.

## 4. Removed the footer's "Industries" column (pre-existing dangling links, now amplified by 32 new pages)

**Decision:** `apps/landing/components/layout/footer.tsx`'s "Industries" column (3 links to `/industries/{slug}`, none of which exist — Phase 5 scope) was removed this phase, not left in place.
**Evidence:** Every one of this phase's 32 new pages renders the global footer, meaning this pre-existing Phase 2/3 gap would have appeared on 32 additional pages unless fixed. Prompt 4's Definition of Done explicitly requires "no public 404 links."
**Alternatives considered:** Leave it (pre-existing, arguably out of this phase's scope); build minimal `/industries/*` stub pages (explicitly prohibited — "do not build industry pages in this prompt").
**Reason selected:** Removing a dangling link column is a small, in-scope, zero-content-debt fix that directly serves the "no public 404s" requirement without violating the "don't build industry pages" boundary. Did **not** apply the same treatment to the footer's other pre-existing dangling links (`/about`, `/contact`, `/pricing`, `/implementation`, `/legal/*`) — those require actual page content or a scope decision beyond this phase's boundary, and existed before this phase with no dedicated content prepared for them; flagged as a known, inherited gap in `phase-5-brief.md` instead of silently ignored or scope-crept into unplanned page-building.
**Risks:** None identified — footer grid rebalanced from `lg:grid-cols-6` to `lg:grid-cols-5` to avoid an asymmetric empty column.

## 5. Corrected 3 modules' `heroVariant` content assignment (found during pre-Cycle-2 QA, not by a reviewer)

**Decision:** `point-of-sale` and `support` (previously assigned `screenshot-led`) and `hr-payroll` (previously assigned `dashboard-led`) were reassigned to `workflow-led`/`operational-sequence` respectively — matching what they actually render as, given none of the three has an approved screenshot.
**Evidence:** `ModuleHero`'s defensive fallback logic (screenshot-wanting variant + no approved screenshot → falls back to `operational-sequence`) meant nothing was ever visually broken, but the raw content itself claimed a screenshot-based layout it couldn't deliver — an internal inconsistency between authored content and actual evidence, caught by re-deriving the true module→heroVariant mapping directly from the source file rather than trusting my own earlier recollection while writing `module-content-architecture.md`.
**Reason selected:** The fallback is meant as a safety net for genuinely unexpected states (e.g. a screenshot getting un-approved later), not as the primary mechanism papering over a content-authoring mistake made in the same session. Fixing the content directly is more honest and removes reliance on the fallback for 3 of 12 modules as shipped.
**Risks:** None — content-only change, re-verified by the full test suite and a rebuild.

## 6. Cycle 2 fixes: the Accounting screenshot bug and what it changed structurally

**Decision:** Beyond the direct fix (`accounting.screenshots = {}`), added a permanent regression test (`apps/landing/tests/lib.test.mjs`, "every module's referenced screenshot id actually belongs to that module") that fails the build if any module's `screenshots.primary`/`secondary` ever again references a screenshot whose own `module` field doesn't match.
**Evidence:** Three independent reviewers (frontend-quality, UX/CRO, brand/design) each found this bug on their own, from different angles — a strong signal it was a real, high-visibility defect, not a nitpick. It happened because `getApprovedScreenshot()` has never done an ownership check (it only checks approval status), and nothing else in the content layer validated the pairing either.
**Reason selected:** A single content-value fix without the regression test would leave the same class of mistake possible the next time a module's `screenshots` field is edited (e.g. in Phase 5, when real Accounting evidence is captured and someone needs to update this field again). The test makes the constraint structural, not just remembered.
**Risks:** None identified — the test is purely additive validation.

## 7. Cycle 2 fixes: moved the sticky mobile CTA to the root layout instead of duplicating it across 32+ pages

**Decision:** `StickyMobileCta` is now mounted once in `app/layout.tsx`, self-hiding on `/book-demo*` routes via `usePathname()`, rather than being explicitly imported and wired into every page that wants it.
**Evidence:** The UX/CRO Cycle 2 review found it wired into the homepage only — every one of this phase's 32 new pages had no persistent mobile conversion path at all, a direct violation of `conversion-architecture.md`'s explicit mobile-CTA rule.
**Alternatives considered:** Add the same explicit `<StickyMobileCta href=... label=... event=.../>` + spacer pair to all 32 new page files (matches the original Phase 3 pattern, but guarantees the exact same omission will happen again the next time a new page is added in Phase 5+).
**Reason selected:** A global, self-aware component can't be forgotten on a future page the way a per-page opt-in can — the same reasoning already applied to the "Home" breadcrumb fix (item below). The only page-specific behavior needed (hiding on `/book-demo*`) is handled inside the component itself via the current pathname, not by the caller remembering to omit it.
**Risks:** None identified — verified via the full 182-test Playwright regression that the bar renders correctly (or correctly doesn't) on every route class.

## 8. Cycle 2 fixes: fixed the "Home" breadcrumb omission at the component level, not per call site

**Decision:** `Breadcrumbs` now always prepends `{ name: "Home", path: "/" }` to whatever trail its caller passes — callers pass only the page-specific segment (e.g. `[{ name: "Modules", path: "/modules" }]`), never the full sequence.
**Evidence:** The SEO/AEO/GEO Cycle 2 review found "Home" missing from both the visible breadcrumb trail and the `BreadcrumbList` JSON-LD on every one of the 19+ pages that render breadcrumbs (both this phase's new pages and Phase 3's `/book-demo`).
**Reason selected:** Same structural reasoning as item 7 — fixing it once at the component boundary means it can't be omitted again on a future page, versus asking every future call site to remember to include it.
**Risks:** None — purely additive to the rendered trail and the structured data.

## 9. Cycle 2 fixes: platform-page empty hero, filled with real data, not a fabricated diagram

**Decision:** `PlatformHero` now renders a "Built into" module-tag cluster (sourced from each platform page's real `connectedModuleKeys`) as the visual anchor for the 6 platform pages that have no screenshot, instead of bare copy over empty space.
**Evidence:** The brand/design Cycle 2 review flagged this as a direct instance of the explicitly prohibited "huge empty hero space" pattern, present on all 6 platform pages (the entire platform-page category).
**Alternatives considered:** A custom illustrative diagram (rejected — Control Surface explicitly prefers real product truth over illustration, and inventing a diagram for 6 different abstract concepts (platform architecture, automation, analytics, mobile, integrations, security) in the time available risked looking generic); leaving it as-is and documenting it as an accepted limitation (rejected — the brief's prohibited-pattern list makes this a real defect, not a stylistic preference).
**Reason selected:** `connectedModuleKeys` was already real, typed, correct data on every platform page (used later in the page for the "Modules built on this capability" section) — reusing it in the hero required no new content authoring and stays within the "real screenshots/real data, no illustration" discipline.
**Risks:** `/product/platform`'s connected-module list is broader (crm, sales, accounting, hr-payroll) than some other pages' shorter lists (e.g. `/product/integrations` has only `crm`) — the visual weight of the hero's tag cluster varies page to page as a result. Judged acceptable since it's an honest reflection of real scope difference, not an inconsistency to paper over.

## 10. Scope decision: `ProductCallout` (in-image numbered annotations) not applied to any real screenshot this phase

**Decision:** The 5 approved screenshots continue to use caption-only evidence framing (a caption below the frame, per `ProductFrame`) — `ProductCallout` remains built and demonstrated only on `/design-system`, not applied to a live page.
**Evidence:** The brand/design Cycle 2 review noted Direction A's spec repeats "numbered callouts" as part of its core screenshot-treatment identity, and flagged this as a real, if moderate, gap between the spec and what shipped.
**Alternatives considered:** Retrofit numbered callouts onto the 5 existing approved screenshots this phase.
**Reason selected:** Correct callout placement requires per-screenshot judgment about which specific UI regions deserve a numbered annotation and what each number's label should say — this is real design work, not a mechanical change, and doing it hastily risked lower-quality annotations across screenshots that are about to be joined by ~9 more captures in a Phase 5 follow-up (`screenshot-extension-register.md`). Deferred as a deliberate scope decision, recorded here rather than left as a silent gap.
**Risks:** None to what's shipped — this is purely an enhancement not yet made, not a regression.
