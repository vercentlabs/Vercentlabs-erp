# Phase 7 Brief — CRO, Analytics, Performance, and Accessibility Optimization

## Context

Phases 1-6 built the full information architecture: homepage, 12 module pages, 6 platform pages, 4 industry pages, 5 solution pages, 6 workflow pages, implementation, and now the content-authority layer (6 resource guides, a 27-term glossary, 1 comparison, a real requirements-checklist tool). Phase 7 does not add another content batch — it optimizes what already exists: funnel performance, conversion mechanics, Core Web Vitals, deep accessibility, and observability.

## 1. Funnel analytics audit

Every page now fires a view event and every CTA fires a click event (see the `ANALYTICS_EVENTS` tuple in `packages/landing-content/src/index.d.ts`, now ~40 entries across all 6 phases). No analytics provider is actually wired in yet — `apps/landing/lib/analytics.ts`'s `track()` only forwards to an optional `window.__vercentlabsAnalyticsSink` and a dev-mode console log. Phase 7 should: (a) decide on and wire a real analytics provider, (b) audit whether the event taxonomy built across 6 phases is actually coherent and non-redundant now that it's this large, (c) build baseline dashboards once real data exists.

## 2. CTA performance architecture

With ~74 indexable routes and 3+ CTA touchpoints per typical page, there's now a large surface for CTA-copy and placement experimentation. Phase 7 should establish which CTA variants (if any) are worth A/B testing, starting with the highest-traffic pages once real analytics exist.

## 3. Form-conversion optimization

`/book-demo`'s form (module/industry/workflow/solution context-aware, per Phase 5) hasn't been re-audited since Phase 6 added `?` context params are still only module/industry/workflow/solution — Phase 7 should decide whether resource-guide or glossary-term context deserves the same preselection treatment, or whether that's over-engineering for a lower-intent entry point.

## 4. Landing-page segmentation / campaign routes

Not built in any phase so far. If paid acquisition is planned, Phase 7 should scope campaign-specific landing variants — but only if there's a real, funded acquisition channel driving the need, not speculatively.

## 5. Experiment framework and conversion hypotheses

No A/B testing infrastructure exists. Phase 7 should decide build-vs-buy for this before running any real experiment, and should generate a real hypothesis backlog from Phase 6's CTA/UX review findings (see `visual-review-log.md`) rather than guessing at what to test.

## 6. Analytics/attribution validation

`SafeAnalyticsProperties` (in `apps/landing/lib/analytics.ts`) already excludes PII by type — worth a real audit once a provider is wired, confirming no future event accidentally widens this.

## 7. Core Web Vitals, JS reduction, image performance

`performance-validation.md` disclosed real gaps: no Lighthouse run, no bundle-size diff, no CDN/caching-header validation. Phase 7 should establish an actual measured baseline (LCP/CLS/INP) across the highest-value routes — homepage, `/resources`, `/resources/erp-requirements-checklist`, `/resources/glossary`, a glossary term, a comparison page, the manufacturing guide — and only then decide what (if anything) needs optimization. Never invent or estimate a score; measure it.

## 8. Browser profiling

Not done in any phase. A real Chrome DevTools performance trace of the requirements-checklist page (the most JS-heavy new route, with 73 rendered checkboxes and client-side state) would be the highest-value first target.

## 9. Deep accessibility audit

`accessibility-validation.md` disclosed: no axe-core scan, no screen-reader walkthrough, no contrast audit, no focus-order walkthrough. Phase 7 should close these specifically for the Phase 6 routes first (they're newest and least-audited), then extend to a full-site sweep if resourced.

## 10. Keyboard/screen-reader testing

Same gap as above, called out specifically: a real screen-reader pass through the requirements checklist's filter-and-checkbox interaction, and a keyboard-only tab-order walkthrough of the same page.

## 11. Mobile conversion

No mobile-specific conversion-rate data exists yet (no analytics provider). Once wired, compare mobile vs. desktop conversion on the highest-traffic new routes.

## 12. Search Console readiness

Not yet done in any phase. Phase 7 should document: the canonical property to verify, `sitemap.xml`'s real location (`/sitemap.xml`, confirmed working), current indexable/noindex counts (74 indexable + 2 noindex as of Phase 6), a structured-data validation pass (building on `structured-data-map.md`'s disclosed gap — no automated validator run yet), and baseline query tracking once Search Console is actually connected. Do not claim verification is complete until it actually is.

## 13. Observability, error monitoring, lead-delivery monitoring

Not built in any phase. The `/api/book-demo` lead-capture proxy (Phase 3) has no monitoring for delivery failures. Phase 7 should scope real error tracking (a provider decision, not a DIY solution) before anything else in this list, since a broken lead-delivery path silently losing real business inquiries is the single highest-severity risk on this entire list.

## What Phase 7 should NOT do

Add more resource guides, glossary terms, or comparisons — Phase 6's content-authority layer is complete for now; expanding it further should wait for real usage/search data to justify specific new pages, not be done speculatively. Phase 7 optimizes the existing 74-route IA; it doesn't grow it.

## Recommended first step for Phase 7

Read this brief in full, then start with #13 (observability/lead-delivery monitoring) and #7 (a real, measured performance baseline) before anything speculative (A/B testing, campaign routes) — those two are the highest-severity, most concretely actionable, and least speculative items on this list.
