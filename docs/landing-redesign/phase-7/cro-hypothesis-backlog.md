# Phase 7 CRO Hypothesis Backlog

Structured backlog of CRO hypotheses found during this phase's audit work. None have been applied — per `experiment-framework.md`'s decision, there is no traffic to test them against yet. No baseline conversion percentage is stated anywhere below; where a number would normally go, it says so explicitly.

## H-001 — Add risk-reduction copy to the homepage final CTA

- **Observation:** The homepage's final CTA section (`homepage.js`'s `finalCta` content block) carries a single line of framing copy and the CTA button itself, with no supporting risk-reduction text (no "what happens on the call," no time commitment, no "no obligation" framing).
- **Evidence type:** OBSERVED (direct content inspection — see `cro-heuristic-audit.md`'s homepage-final-CTA section).
- **Hypothesis:** Adding one short line of concrete expectation-setting (e.g., what the demo call actually covers, roughly how long it takes) immediately below or beside the final CTA reduces last-moment hesitation for a visitor who has read the whole page but hasn't yet committed to booking a call.
- **Target audience:** Visitors who scroll to the bottom of the homepage without converting via the hero CTA — a distinct, more-informed segment than a hero-only visitor.
- **Change:** Add a single line of real, non-fabricated expectation-setting copy (e.g., referencing the actual demo flow, once confirmed against how sales actually runs these calls — this content must come from a real source, not invented, per `landing-content.md` rule #1).
- **Primary metric:** `final_cta_click` rate relative to `final_cta_view` (both events already exist and are instrumented — no new analytics work needed to measure this once live).
- **Guardrail metric:** `demo_form_start` → `demo_form_success` completion rate should not drop (a hypothesis that increases raw clicks but decreases lead quality/completion would be a net loss).
- **Priority:** Medium — low implementation effort, plausible impact, no risk to existing functionality.
- **Confidence:** Low-to-medium — grounded in general CRO practice (risk-reduction copy near a commitment point is a well-established pattern), not in any Vercentlabs-specific data, since none exists yet.
- **Status:** Backlog — not applied.

## H-002 — Contextual pre-selection of module interest on the demo form based on referring page

- **Observation, corrected during Cycle 2 review:** This hypothesis's original framing (below, preserved for the record) assumed no pre-selection existed. Independent Cycle 2 CRO review found this is **already substantially built**: `app/book-demo/page.tsx` genuinely reads `?module=`/`?industry=`/`?workflow=`/`?solution=` server-side and pre-checks the corresponding module checkboxes plus shows a contextual label ("We'll focus this session on Manufacturing"), and every module/industry/workflow/solution page's CTA already passes the right param (verified via a live fetch of `/modules/manufacturing`'s rendered CTAs). Phase 7 also added `?intent=specialist` support to the same mechanism (see `decision-log.md` item... / `cro-heuristic-audit.md`'s Book-demo section).
- **Original hypothesis (partially resolved):** ~~Pre-selecting `industry`/`primaryInterest` `<select>` fields based on referrer context~~ — superseded; the real mechanism pre-selects the module-interest checkbox group instead, which is arguably the higher-value target (see `form-friction-audit.md`'s corrected field table).
- **Remaining real gap (narrower than originally framed):** referrer-based context only exists for *direct URL-parameter* navigation (a visitor who clicks a module page's own CTA). It does not exist for a visitor who browses organically within the site (e.g., reads `/modules/manufacturing`, then navigates to `/resources`, then clicks the header's generic "Book a Product Demo") or arrives at `/book-demo` directly. Closing this narrower gap would need either last-internal-page tracking (not built) or accepting that only direct-CTA-click traffic benefits — a real, smaller-scoped hypothesis than the original.
- **Evidence type:** OBSERVED (Cycle 2 review, live HTML fetch + source read).
- **Status:** Largely resolved (pre-selection exists and works for its primary use case); the narrower remaining gap is Backlog, not applied, low priority given the primary case is already covered.

## H-003 — Reduced-chrome `/book-demo` variant

- **Observation:** `/book-demo` retains the full global header (6 nav items, mega-menus, a "Sign in" link to a different app) and a ~30-link footer, despite being the single highest-intent conversion page on the site. The codebase's own `sticky-mobile-cta.tsx` already establishes the precedent that this exact page should minimize competing chrome — it explicitly suppresses the mobile sticky CTA there, with a comment noting a floating CTA "reads as broken rather than helpful" mid-form.
- **Evidence type:** OBSERVED (Cycle 2 CRO review, confirmed via live HTML fetch of `/book-demo`).
- **Hypothesis:** A visitor who has already clicked "Book a Product Demo" has made their decision — full site navigation (including a second, different "Sign in" link that represents a real context-switch away from the form) may function as pure exit-friction rather than helpful orientation at this specific point in the funnel.
- **Target audience:** All `/book-demo` visitors, but the effect (if real) would be strongest for visitors arriving with high intent already (e.g., from a comparison page or a direct campaign link) who don't need reassurance-via-navigation.
- **Change:** A minimal-header, no/short-footer variant of `/book-demo` specifically (not a site-wide change) — logo + a way back to the homepage, form, done.
- **Primary metric:** `demo_form_start` → `demo_form_success` completion rate.
- **Guardrail metric:** Bounce rate on `/book-demo` itself (a reduced-chrome page that feels like a dead end if the visitor isn't ready to commit could increase bounces rather than reduce them — this is a real two-sided risk, which is exactly why this is a hypothesis requiring a real test, not a direct fix).
- **Effort:** Low-medium — a conditional layout variant for one route.
- **Confidence:** Low-medium — the precedent set by the sticky-CTA suppression suggests the team already believes reduced competition helps on this page, but that was a narrower, lower-risk change (removing one floating element) than removing primary navigation entirely.
- **Status:** Backlog — not applied. This is a genuine trade-off (focus vs. navigability/trust), not a defect with one correct answer, so it stays a hypothesis per the brief's own instruction not to apply speculative CRO changes as permanent fixes.

## Explicitly NOT hypotheses (confirmed usability defects, already fixed directly)

Per the brief's own instruction not to A/B test defects: the double-click duplicate-lead bug, the site-wide color-contrast failure, 5 dead nav/footer links, and the dropped `intent=specialist` CTA parameter (`decision-log.md` items 1, 3, 17-18) are not in this backlog — they were fixed directly, not queued as experiments.
