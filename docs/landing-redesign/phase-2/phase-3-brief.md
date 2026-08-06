# Phase 3 Brief — Homepage and Conversion Experience

Prompt 3 of 8: implement the final homepage using the Phase 2 design system, replacing the temporary validation homepage at `/`.

## Source of truth

Follow `docs/landing-redesign/phase-1/homepage-blueprint.md` exactly — it already specifies the 12-section order (Announcement bar, Navigation, Hero, Problem Framing, Connected Platform Explanation, Module Architecture, Cross-Module Workflow, Role-Based/Industry Relevance, Security and Governance, Implementation, Final CTA, Footer), with per-section purpose, audience question, message, required visual, required evidence, CTA, analytics event, mobile behaviour, and SEO contribution already defined. Do not re-derive the section list — implement it.

## Exact copy to carry forward

Hero headline/subhead is already decided in `docs/landing-redesign/phase-1/positioning-and-messaging.md` and is already live on the temporary homepage:
- Headline: "The ERP for businesses that outgrew spreadsheets."
- Subhead: "Sales, inventory, procurement, production, and finance — on one live system, from the first order to the balance sheet."

Primary CTA: "Book a Demo" → `/book-demo`. Secondary: "Explore the Platform" → `/product/platform`.

## What Phase 2 already built for you to compose with

- Every layout/typography/button/card/tag/form primitive in `apps/landing/components/` — see `component-inventory.md` for the full list and usage rules.
- `ProductFrame`/`ProductScreenshot`/`ProductCallout`/`WorkflowConnector` for the "product evidence" and "cross-module workflow" sections — **but `APPROVED_SCREENSHOTS` is currently empty** (see below, this is the top blocker).
- Header/mega-menu/mobile-nav/footer — fully built and tested, reuse as-is.
- `buildPageMetadata`/JSON-LD helpers in `lib/metadata.ts` / `lib/seo/json-ld.ts`.
- The `/book-demo` route does **not** exist yet — Phase 3 must create it (form UI can reuse `components/forms/*` primitives; wiring the real submission to `apps/web`'s `POST /api/crm/public/capture/[key]` endpoint per `docs/landing-redesign/phase-1/conversion-architecture.md` is in scope for Phase 3, not deferred further).

## Top blocker: no approved product screenshots exist

The homepage blueprint requires the hero to **be** a large annotated real screenshot (Direction A / Control Surface), and the Cross-Module Workflow section requires a real workflow walkthrough with real screenshots per step. `lib/product/screenshots.ts`'s `APPROVED_SCREENSHOTS` array is empty (see `product-visual-guidelines.md` for the capture/approval process). **Resolve this before or at the very start of Phase 3** — either by capturing and approving real screenshots from `apps/web`, or by making an explicit, documented decision to ship an interim hero treatment and revisit once screenshots exist. Do not fabricate screenshots to fill the gap (Evidence and Honesty Rules).

## Sections that need new components

- **Problem Framing**: a simple diagram (line/rectangle vocabulary per Control Surface) showing disconnected-tools friction — not yet built, needs a new component.
- **Connected Platform Explanation**: a structural diagram (modules as coloured segments around a shared core) — not yet built.
- **Announcement bar**: not yet built; per the blueprint, omit entirely if there's no genuine, real announcement to show (do not fabricate one).

## Analytics events to wire

The event names are already fixed in `docs/landing-redesign/phase-1/conversion-architecture.md` and re-exported as `ANALYTICS_EVENTS` from `packages/landing-content`: `cta_click`, `demo_form_start`, `demo_form_submit_success`, `demo_form_submit_error`, `product_tour_play`, `module_page_view`, `industry_page_view`. No analytics *provider* is wired into the repo yet (confirmed absent repo-wide in Phase 1) — Phase 3 should decide and wire one, or stub event dispatch behind a single `lib/analytics.ts` entry point so the provider can be swapped later without touching every call site.

## Security/CSP follow-up

`next.config.mjs`'s CSP uses `'unsafe-inline'` in `script-src` (required for Next.js's own inline scripts — see `production-deployment.md`). If Phase 3 or later wants a stricter nonce-based CSP, that requires middleware to mint and propagate a per-request nonce — flagged, not started.

## Testing expectations for Phase 3

- Extend `tests/e2e/production-smoke.spec.ts` to cover the real homepage's CTAs and section presence.
- Re-run the full visual-review capture suite (`tests/e2e/visual-review.spec.ts`) — update it to capture the final homepage, not the temporary one.
- Add `prefetch={true}` to any `Link`/`ButtonLink` whose destination becomes real in Phase 3 (currently defaulted `false` per `decision-log.md` item 4b).
- If `/book-demo` is built, add a content-integrity/E2E test verifying the form actually submits and the HMAC-signed proxy contract to `apps/web` is correctly implemented (headers, timestamp, signature) — do not ship an unverified integration with a production endpoint.

## Do not

- Build module, industry, workflow, or SEO content pages (Phases 4-6) — the homepage may *link* to them (they'll 404 until built, which is expected and fine per this phase's own `prefetch={false}` convention).
- Fabricate screenshots, testimonials, statistics, or claims not traceable to `docs/landing-redesign/phase-1/product-intelligence.md`.
- Reopen the Control Surface creative direction or the design-token values without a genuine accessibility/technical blocker.
