# Phase 7 Analytics Event Contract

Every event `track()` can fire, what triggers it, what properties it carries, what it must never carry, which funnel it belongs to, and — per the governing brief's explicit requirement — the business decision it exists to inform. An event that can't answer the last column should not exist; none were found in that state during this audit, but two naming/registration inconsistencies were (see the note after the tables).

All events flow through the single typed entry point `apps/landing/lib/analytics.ts`'s `track(event, properties)`. No analytics provider is wired yet (see `decision-log.md` item, plan scope decision 1) — `track()` forwards to an optional `window.__vercentlabsAnalyticsSink` (documented provider integration point) and, outside production, a `console.debug` line. It never throws.

## Prohibited properties (applies to every event, no exceptions)

`SafeAnalyticsProperties` (the only type `track()` accepts for its second argument) is a closed interface — it does not accept arbitrary objects, so a call site cannot accidentally widen it. It permits only: `section`, `ctaLocation`, `ctaDestination`, `module`, `workflow`, `industry`, `formStep`, `errorCategory`, `campaignSource`, `campaignMedium`, `campaignName`, `referrerCategory`, `routePattern`, `metricValue`, `metricRating`, `navigationType`. None of these can hold a name, email, phone number, company name, free-text field value, CRM record ID, HMAC key, API secret, or capture-secret — enforced structurally (the type has no field that could hold one) and verified behaviorally by `tests/e2e/pii-leakage.spec.ts`, which fills the real demo form with distinctive fake values and asserts none of them appear anywhere in a captured event payload.

## Page-view events

| Event | Trigger | Properties | Funnel role | Business purpose |
|---|---|---|---|---|
| `homepage_view` | Homepage mounts | `campaignSource`, `campaignMedium`, `campaignName`, `referrerCategory` (first-touch attribution snapshot) | Top of funnel | Measures homepage traffic volume and its first-touch source mix — the input side of the homepage → demo conversion rate. |
| `module_page_view` | A `/modules/[slug]` page mounts | `module` | Top/mid funnel | Which modules attract the most page views — informs which module pages deserve deeper CRO investment. |
| `industry_page_view` | A `/industries/[slug]` page mounts | `industry` | Top/mid funnel | Same as above, per industry vertical — informs ICP-targeted content investment. |
| `platform_page_view` | A `/product/*` platform page mounts | `section` | Mid funnel | Distinguishes platform-capability interest from module-specific interest in the buyer journey. |
| `modules_index_view` / `industries_index_view` / `solutions_index_view` / `workflows_index_view` / `resources_index_view` / `compare_index_view` / `glossary_index_view` | The respective index/hub page mounts | none | Top funnel | Measures hub-page traffic as a proxy for browse-vs-search navigation behavior — informs IA/nav investment. |
| `solution_page_view` | A `/solutions/[slug]` page mounts | none | Mid funnel | Which buyer problems (not products) draw traffic — informs positioning work. |
| `workflow_page_view` | A `/workflows/[slug]` page mounts | `workflow` | Mid funnel | Which cross-module workflows draw traffic — informs which workflow narratives to expand. |
| `implementation_page_view` | `/implementation` mounts | none | Mid/bottom funnel | A implementation-concerned visitor is a stronger buying signal than a generic module browse — worth tracking as its own segment. |
| `resource_page_view` | A `/resources/[slug]` guide mounts | `section` | Top funnel (organic) | Measures which resource content actually earns traffic — the input to the content-authority investment decision. |
| `glossary_page_view` | A `/resources/glossary/[slug]` term mounts | none | Top funnel (organic) | Same as above, for glossary/definitional intent. |
| `comparison_page_view` | A `/compare/[slug]` page mounts | none | Bottom funnel (high intent) | Comparison-page visitors are close to a buying decision — a meaningfully different segment worth isolating from general traffic. |

## CTA-click events

| Event | Trigger | Properties | Funnel role | Business purpose |
|---|---|---|---|---|
| `module_hero_cta_click` / `module_mid_cta_click` / `module_final_cta_click` | The primary demo CTA at each of a module page's three CTA placements | `module`, `ctaLocation`, `ctaDestination` | Mid → bottom funnel | Which placement on a module page actually converts — the direct input to the module-page CRO backlog (Workstream P). |
| `industry_final_cta_click` / `solution_cta_click` / `workflow_cta_click` / `implementation_cta_click` / `platform_cta_click` / `resource_cta_click` / `comparison_cta_click` | The primary demo CTA on the respective page type | `ctaLocation`, `ctaDestination` (+ page-type dimension where applicable) | Mid → bottom funnel | Same purpose as above, per page type — lets the CRO backlog rank page types by CTA effectiveness, not just page views. |
| `module_related_link_click` / `resource_related_click` | A related-content link inside a module or resource page | `ctaLocation`, `ctaDestination` | Mid funnel (internal navigation) | Distinguishes visitors self-directing deeper into related content from those hitting a dead end — informs internal-link architecture priority. |
| `source_link_click` | A citation/source link on a comparison or resource page | `ctaDestination` | Trust signal | Measures whether visitors actually verify claims via cited sources — a proxy for content credibility engagement, not a conversion event. |
| `sticky_mobile_cta_click` | The persistent mobile sticky "Book a Demo" bar | `ctaLocation: "sticky_mobile_bar"`, `ctaDestination: "/book-demo"` | Bottom funnel (mobile) | Isolates the sticky CTA's own contribution to mobile conversions — the direct input to Workstream S's mobile CRO decisions. |
| `implementation_specialist_cta_click` | The "Talk to an ERP Specialist" secondary CTA on `/implementation` | none | Bottom funnel (alternate path) | Measures uptake of the secondary conversion path vs. the primary demo CTA — informs whether the secondary CTA is pulling its weight or just adding decision friction. |
| Homepage CTA/section events (`hero_view`, `hero_primary_cta_click`, `hero_secondary_cta_click`, `problem_section_view`, `workflow_view`, `module_group_view`, `breadth_section_view`, `workflow_interaction`, `role_value_view`, `automation_section_view`, `security_section_view`, `implementation_section_view`, `buyer_questions_view`, `final_cta_view`, `final_cta_click`) | Each named homepage section/CTA, on view or click respectively | none (view events) / `ctaLocation`, `ctaDestination` (click events) | Top → bottom funnel, homepage only | A per-section engagement and drop-off map for the single highest-traffic page — the direct input to the homepage-specific CRO backlog. |

## Demo-form funnel events (the canonical chain)

| Event | Trigger | Properties | Funnel role | Business purpose |
|---|---|---|---|---|
| `demo_form_start` | First interaction with any form field (focus/change) | none | Funnel entry | Distinguishes "reached the form and engaged" from "reached the form and bounced" — the denominator for form completion rate. |
| `demo_form_validation_error` | Client-side validation fails on submit attempt | `errorCategory` (comma-joined list of failing field *names*, never values) | Funnel friction signal | Identifies which fields cause the most validation friction — direct input to `form-friction-audit.md`. |
| `demo_form_submit` | Client-side validation passes, request is being sent | none | Funnel mid-point | The true "attempted conversion" event — separates validation friction from delivery/network failure in the funnel math. |
| `demo_form_success` | Server responds 2xx | none | Funnel completion | The server-confirmed lead-capture event — the authoritative conversion count, not `product_demo_complete` (see below). |
| `demo_form_error` | Server responds non-2xx, or the request throws (network failure) | `errorCategory` (HTTP status code as a string, or `"network"`) | Funnel failure signal | Distinguishes validation friction from delivery failure — direct input to `lead-reliability-audit.md` and Workstream O. |
| `product_demo_complete` | The `/book-demo/thank-you` page mounts, deduped per `requestId` via `sessionStorage` (refresh-safe — see `thank-you-effects.tsx`) | none | Funnel completion confirmation | A client-side confirmation the visitor actually reached the thank-you experience, independent of whether the server-side `demo_form_success` fired reliably — the two together let a future analysis detect silent client/server funnel divergence. |

## Content-interaction events

| Event | Trigger | Properties | Funnel role | Business purpose |
|---|---|---|---|---|
| `requirements_filter` | A category filter toggled on `/resources/erp-requirements-checklist` | `section` (category key) | Engagement/tool usage | Measures which requirement categories buyers actually filter for — informs which categories the checklist should expand. |
| `requirements_print` | The checklist's print action | none | Engagement/tool usage | A proxy for buyers taking the checklist into an offline evaluation process — a qualified-intent signal distinct from a page view. |

## Web Vitals (RUM) events

| Event | Trigger | Properties | Funnel role | Business purpose |
|---|---|---|---|---|
| `web_vitals_lcp` / `web_vitals_inp` / `web_vitals_cls` | The `web-vitals` package's `onLCP`/`onINP`/`onCLS` callback fires for the current page | `routePattern` (normalized, e.g. `/modules/[slug]` — never a literal URL or query string), `metricValue`, `metricRating`, `navigationType` | Not a conversion event — a performance/reliability signal | The only planned source of real field Core Web Vitals data once the site has production traffic and a real analytics backend is wired to `window.__vercentlabsAnalyticsSink` (see `performance-methodology.md`). |

## Naming/registration notes (found during this audit, not fixed — informational)

- `sticky_mobile_cta_click` and `implementation_specialist_cta_click` are valid, real, currently-firing events (both call sites exist and both are exercised by real pages), but they are declared only as ad hoc literal additions to `AnalyticsEventName` in `lib/analytics.ts` rather than being registered in the shared `ANALYTICS_EVENTS` array in `packages/landing-content/src/navigation.js`/`index.d.ts` alongside the other 41 events. This means they're outside the reach of `tests/analytics-events-sync.test.mjs`'s drift protection. Not a functional bug (typecheck and runtime both work correctly today), but worth folding into the shared array in a future content-package change so the whole taxonomy lives in one place.
