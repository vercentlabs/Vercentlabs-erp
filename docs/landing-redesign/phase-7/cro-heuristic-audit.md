# Phase 7 CRO Heuristic Audit

## Method (stated honestly, per this phase's evidence-classification discipline)

Every surface below was scored via direct source/content inspection (`packages/landing-content/src/homepage.js` and the equivalent page-content modules, plus the rendering components) cross-referenced against the real, running production build — **not** a full manual click-through-and-screenshot walkthrough of every surface (that level of visual review was already performed in Phases 3-6's `visual-review-log.md`s and is not repeated wholesale here). Findings below are tagged **OBSERVED** (verified against real content/code) unless marked otherwise. The rubric score is prioritization support, not a conversion-rate predictor — stated explicitly per the brief's own requirement.

## Rubric

Each surface scored 1 (weak) – 5 (strong) on: **Message clarity**, **Buyer relevance**, **Proof**, **Risk reduction**, **CTA clarity**, **CTA competition** (lower is better — fewer competing CTAs), **Visual hierarchy**, **Mobile usability**, **Next-step expectation**.

## Surface-by-surface findings

### Homepage hero
- **Message clarity (5):** "The ERP for businesses that outgrew spreadsheets." — a specific, falsifiable positioning statement, not generic "all-in-one platform" copy. **OBSERVED**, `homepage.js:24`.
- **Buyer relevance (4):** Names a real trigger (outgrowing spreadsheets) that matches the ICP research's documented buyer moment.
- **Proof (4):** 4 real stat tiles (12 connected modules, 1,039 implemented capabilities, multi-company, role-based) — all traceable to real, settled product facts (per `product-intelligence.md`), not invented numbers.
- **CTA clarity (5):** One primary ("Book a Product Demo") + one secondary ("Explore the Platform") — exactly two choices, clearly differentiated by commitment level.
- **CTA competition (5 = low competition, good):** Only 2 CTAs in the hero, no visual competition.
- **Mobile usability:** Verified via `tests/e2e/mobile-conversion.spec.ts` — no horizontal overflow, correct target sizing across 320-412px.
- **Next-step expectation (4):** "Book a Product Demo" clearly implies a scheduled call, not a vague "Get Started."

### Homepage final CTA
- **Message clarity (4):** "See how your operations would run in one connected system." — reframes the demo as operationally concrete rather than generic.
- **CTA clarity (5):** Single CTA (`final_cta_click`), no secondary competing option at the page's final decision point — correct pattern (a final CTA section diluted by multiple choices is a real, common CRO mistake this page avoids).
- **Proof/Risk reduction (3):** The final CTA section itself carries no additional risk-reduction copy (no "no credit card," no "30-minute call," no "what to expect" framing) — this is the one real, evidence-grounded gap found on this surface. **Candidate for `cro-hypothesis-backlog.md`**, not a defect (the CTA works; this is an optimization opportunity, not a broken experience).

### Product page (`/product`)
- **Message clarity/Buyer relevance:** Platform-level positioning distinct from module-specific pages — correctly targets the "is this a real platform or just modules bolted together" buyer question per the IA's tier structure.
- **Mobile perf:** MEASURED via this phase's Lighthouse baseline — 85 (mobile), 100 (desktop), LCP 1696ms mobile / 461ms desktop (see `baseline-measurements.md`) — both within field CWV targets on lab data.

### Manufacturing module (`/modules/manufacturing`)
- **Proof:** Uses `ProductScreenshot` (real product screenshot, not illustration) as the hero-adjacent visual per `module-hero.tsx`.
- **CTA structure:** 3 distinct CTA placements (`module_hero_cta_click`, `module_mid_cta_click`, `module_final_cta_click`) — allows measuring which placement actually converts once real analytics data exists (see `analytics-event-contract.md`), a good instrumentation decision already in place, not something this phase needed to add.

### Manufacturing industry (`/industries/manufacturing`)
- Distinct from the module page by design (vertical/buyer-problem framing vs. feature framing) — confirmed via the IA's differentiation rule (`landing-content.md` rule #3) and the existing `cannibalisation-review.md`'s explicit check that this pairing doesn't compete for the same query.

### Lead-to-cash workflow (`/workflows/lead-to-cash`)
- Cross-module workflow narrative — real, specific step sequence (per `homepage.js`'s own "One record moves through the business" section using the identical lead→opportunity→quotation→order→warehouse→quality→invoice→support chain, confirming content consistency between the homepage teaser and the dedicated workflow page rather than contradictory narratives).

### Implementation (`/implementation`)
- Addresses a real, distinct buyer concern (rollout risk) separate from feature/pricing concerns — per `homepage.js`'s own implementation-section heading ("A configurable product still needs a structured rollout") confirming the same concern is seeded on the homepage and given a full page of its own depth.

### ERP buying guide / requirements checklist (`/resources/*`)
- Top-of-funnel, organic-acquisition surfaces by design — not expected to carry the same CTA density as bottom-funnel pages. Correctly instrumented with their own CTA events (`resource_cta_click`) distinct from page-view tracking.
- **Mobile:** the requirements checklist's filter/print interactions were specifically covered by `tests/e2e/mobile-conversion.spec.ts` this phase (target sizing, no horizontal overflow) — MEASURED, not assumed.

### Odoo comparison (`/compare/vercentlabs-vs-odoo`)
- High-intent, bottom-funnel surface. Correctly neutral framing per `landing-content.md` rule #7 (verified in Phase 6 — not re-audited for factual accuracy this phase, which is `comparison-fact-checker`'s job, not a CRO concern).
- Own dedicated CTA event (`comparison_cta_click`) — correctly instrumented for measuring this specific high-intent surface's conversion separately from general traffic.

### Mobile sticky CTA / header CTA
- **REPRODUCED via `tests/e2e/mobile-conversion.spec.ts`:** visible, correctly sized, does not collide with the header CTA, does not render on `/book-demo` itself (avoiding a redundant "book a demo" prompt on the page that already is the booking form) — a real, verified-correct UX decision, not assumed.

### Book-demo page (`/book-demo`)
- **Form-friction audit** (see `form-friction-audit.md`) confirms every field earns its place — no CRO action needed on field count. (First pass of that audit missed the 12-checkbox module-interest group entirely; corrected during Cycle 2 review — see `decision-log.md` item 18.)
- **Lighthouse (MEASURED):** mobile perf 98, desktop 100, LCP 2329ms mobile / 348ms desktop — the best-performing route in this phase's baseline, appropriate given it's the single highest-value conversion surface on the site.
- **Real, previously-broken CTA differentiation, fixed this phase:** the homepage's "Talk to an ERP Specialist" CTA (`?intent=specialist`) landed on `/book-demo` with zero differentiation from the generic CTA — the param was silently dropped by the page's `searchParams` handling. REPRODUCED via Cycle 2 review, confirmed by reading `app/book-demo/page.tsx`'s destructured params before the fix. **Fixed**: `intent=specialist` now sets a distinct context label ("We'll pair you with a specialist..."), matching the exact pattern already used for `?module=`/`?industry=`/`?workflow=`/`?solution=`. Classified as a confirmed usability/misleading-affordance defect (a CTA promising a different experience than it delivers), not a CRO hypothesis — fixed directly per the brief's instruction not to A/B test defects.
- **`/book-demo` retains full global header/footer chrome** (6 nav items, mega-menus, a second "Sign in" link, a ~30-link footer) despite the codebase's own `sticky-mobile-cta.tsx` already establishing the precedent that this exact page should minimize competing chrome (it explicitly suppresses the sticky CTA there with a comment explaining a floating CTA "reads as broken" mid-form). OBSERVED via Cycle 2 CRO review, independently confirmed by reading the rendered HTML. **Not applied this phase** — classified EXPERIMENT, not FIX: unlike the intent-param bug (an unambiguous broken promise) or the dead links (unambiguous 404s), "how much chrome a conversion page should carry" is a legitimate design trade-off with real arguments both ways (trust/navigability vs. focus), not a defect with one obviously-correct answer. Added to `cro-hypothesis-backlog.md` as H-003.

### Two site-wide broken-link defects found and fixed this phase (not CRO hypotheses — dead links, fixed directly)

- **5 broken internal links** in primary nav and the footer (`/pricing`, `/about`, `/contact`, `/legal/privacy`, `/legal/terms` — none ever had a real page) — REPRODUCED, all confirmed 404, removed. Full detail in `decision-log.md` items 16-17. This is the single highest-severity finding of this phase's entire CRO/UX work: "Pricing" sat in primary nav at the same visual tier as Modules/Industries, a dead link in the most-seen navigation element on every page.
- A related, now-superseded false alarm (widespread apparent 500s, traced to a corrupted local build artifact from this session's own repeated rebuild cycling, not a real defect) is documented in `decision-log.md` item 16 as a worked example of this project's "verify every finding" discipline.

## Summary: confirmed usability defects vs. observations vs. hypotheses

- **Confirmed usability defects found and fixed this phase (not CRO-tested, fixed directly per the brief's own instruction):** the double-click duplicate-lead bug, the site-wide color-contrast failure, 5 dead nav/footer links, and the dropped `intent=specialist` CTA param (see `decision-log.md` items 1, 3, 17-18 and this document's Book-demo section) — all defects with one clear correct fix, not judgment calls.
- **Observations (real, source-grounded, no change needed):** the CTA-density and cross-page consistency findings above — the existing structure already reflects sound CRO practice.
- **Hypotheses (not applied, not measured, backlog only):** see `cro-hypothesis-backlog.md` — the final-CTA risk-reduction copy gap (H-001), contextual field pre-selection (H-002, partially already built per Cycle 2 review — see the backlog), and `/book-demo`'s chrome-density trade-off (H-003, new this phase).

No conversion-rate uplift is claimed anywhere in this document — there is no traffic to measure one against (see `experiment-framework.md`).
