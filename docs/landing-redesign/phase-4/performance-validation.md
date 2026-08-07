# Performance Validation — Phase 4

## Method

Real production build (`pnpm build:landing`) + real production boot (`pnpm start:landing`), not `next dev` — measurements below are from that build's actual output.

## Static generation

All 12 module pages generate via `generateStaticParams` over the real 12 module keys — confirmed by inspecting `.next/server/app/modules/*.html` directly (real pre-rendered HTML files exist for every module, not runtime database calls). `/product`, `/modules`, and all 6 platform pages are static (`○`) in the build output. Only `/book-demo` is dynamic (`ƒ`) — expected, since it now reads a `searchParams` prop server-side for the `?module=` preselection, and `/api/book-demo` (unchanged from Phase 3).

## Bundle size

Total client JS across all shared + route chunks: **928KB uncompressed** (`.next/static/chunks`), up from Phase 3's 784KB — a **+144KB** increase despite adding 32 new pages. This is proportionally small because the module and platform pages are almost entirely Server Components; the only client-side pieces reused across them are the same ones Phase 3 already shipped (`TrackView`, `TrackedCtaLink`) plus the demo form's existing module-checkbox interactivity (no new client component was added specifically for module/platform pages — `ModuleHero`, `CapabilityGrid`, `ModuleWorkflow`, `ConnectedModules`, `ProductEvidenceSection`, `PlatformHero`, `PlatformPageTemplate`, and `LabeledItemGrid` are all Server Components).

## Images

No new screenshots were approved this phase (`screenshot-extension-register.md`) — the 5 screenshots from Phase 3 are reused across the pages that reference them (CRM, Sales, Stock, and Accounting's borrowed reference), served through the same `next/image` AVIF/WebP on-demand transcoding pipeline Phase 3 established. No new image weight was added to the production artifact.

## Representative pages measured

Per the brief's suggested sample: `/product`, `/modules`, `/modules/crm` (richest content — 6 capability groups, 2 screenshots), `/modules/stock` (mid-size, 1 screenshot), `/modules/accounting` (7 capability groups, the deepest single module), `/security`, `/product/integrations`. All generate as static HTML; page weight is dominated by real text content (each module page runs roughly 8,000-10,000px of full-page content per the Cycle 1/2 screenshot captures), not client JavaScript or unoptimized assets.

## What was not measured this phase

No Lighthouse/PageSpeed Insights run, no Core Web Vitals (LCP/CLS/INP) field or lab measurement — consistent with Phase 3's documented gap, not new to this phase. `docs/landing-redesign/phase-3/performance-validation.md` already recommended deferring this to Phase 7 ("CRO, analytics, performance, and accessibility optimisation") once there's a deployed environment and enough real page weight to make the tooling investment meaningful; that recommendation still holds, and now applies to a larger, more representative set of pages (33 total routes) than it did at the end of Phase 3.
