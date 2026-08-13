# Analytics Event Map

Single entry point: `apps/landing/lib/analytics.ts`'s `track(event, properties?)`. No analytics provider is wired into the repository yet — `track()` forwards to an optional `window.__vercentlabsAnalyticsSink` (for a future provider script to attach to) and, in development, the console. **It never throws**: analytics must never block a conversion action like a form submission.

## No PII, enforced at the type level

`SafeAnalyticsProperties` explicitly excludes name/email/phone/company/free-text fields — properties are restricted to categorical/structural values (`ctaLocation`, `ctaDestination`, `errorCategory`, section identifiers, `workflow` slugs). This is a type-level restriction, not just a convention: passing a PII-shaped property object is a TypeScript error at the call site, not just a review-time judgment call.

## Event catalog

The full set of valid event names is `AnalyticsEventName` (`apps/landing/lib/analytics.ts`), a union of three real, literal-typed sources — **this phase fixed a bug where this union had silently degraded to accepting any string; see `decision-log.md` item 6.**

### Section view events (fire once, on first ≥50% intersection — `TrackView`/`homepage-view-tracker.tsx`)

| Event | Section |
|---|---|
| `homepage_view` | Page-level, fired once on mount with attribution context |
| `hero_view` | Hero |
| `problem_section_view` | The cost of disconnected tools |
| `workflow_view` | Connected system explanation |
| `module_group_view` | Twelve modules |
| `breadth_section_view` | Product breadth (1,039 capabilities) |
| `workflow_interaction` | Flagship "lead to cash" workflow |
| `role_value_view` | One system, every role |
| `automation_section_view` | Automation and reporting |
| `security_section_view` | Enterprise control |
| `implementation_section_view` | Getting live |
| `buyer_questions_view` | Buyer questions / FAQ |
| `final_cta_view` | Final CTA |

### CTA click events (`TrackedCtaLink`, `sticky-mobile-cta.tsx`)

| Event | Trigger |
|---|---|
| `hero_primary_cta_click` | Hero "Book a Demo" |
| `hero_secondary_cta_click` | Hero "Explore the Platform" |
| `final_cta_click` | Final CTA "Book a Demo" |
| `implementation_specialist_cta_click` | Implementation section "Talk to an ERP Specialist" |
| `sticky_mobile_cta_click` | Mobile-only sticky bottom bar CTA (new this phase — see `implementation-summary.md`) |

Every `TrackedCtaLink`/`StickyMobileCta` click also carries `ctaLocation` and `ctaDestination` properties, so downstream analysis doesn't need a separate event name per placement — the *event* names the semantic action (e.g. "final CTA clicked"), and the *properties* name where and to what.

### Demo-form funnel events (`demo-form.tsx`)

| Event | Trigger |
|---|---|
| `demo_form_start` | First field interaction (fires once per form session) |
| `demo_form_validation_error` | Client-side validation fails on submit attempt; `errorCategory` lists the invalid field names |
| `demo_form_submit` | Valid submission POSTed to `/api/book-demo` |
| `demo_form_success` | `201` response — about to navigate to the thank-you page |
| `demo_form_error` | Non-OK response or network failure; `errorCategory` is the HTTP status or `"network"` |

### Post-conversion event (`thank-you-effects.tsx`)

| Event | Trigger |
|---|---|
| `product_demo_complete` | Thank-you page loads with a real `rid` query param; deduplicated per request ID via a `sessionStorage` key so a page refresh doesn't double-count |

### Reserved for future phases (declared, not yet fired)

| Event | Reserved for |
|---|---|
| `product_tour_play` | A product-tour video (not built yet) |
| `module_page_view` | Module pages (Phase 4) |
| `industry_page_view` | Industry pages (Phase 5) |

## Attribution

`apps/landing/lib/attribution.ts` captures first-touch UTM parameters and referrer category into `localStorage` under `vercentlabs_attribution_v1` on first page load (`AttributionInit`, mounted once in the root layout) — **first-party storage only, no third-party cookies**, and the record is never overwritten once set (true first-touch, not last-touch). `getAttribution()` reads it back for inclusion in the demo-form submission's `customData` and the homepage-view event's properties. Both functions return `null` outside a browser context instead of throwing (verified by unit test), so server-side rendering and any future SSR-adjacent code path is safe.
