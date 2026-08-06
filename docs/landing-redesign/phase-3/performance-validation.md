# Performance Validation

## Method

Real production build (`next build`, Turbopack) + real production boot (`next start` on `localhost:3000`), not `next dev` — measurements below are from that build's actual output, not estimates.

## Bundle size

Total client JS across all shared + route chunks: **784KB uncompressed** (`.next/static/chunks`). The homepage itself adds no client-side JavaScript beyond what Phase 2's shell already required except small, purpose-built client islands: `TrackedCtaLink`, `TrackView` (an `IntersectionObserver` wrapper), `HomepageViewTracker`, `AttributionInit`, and `StickyMobileCta` — each a small, focused Client Component, not a blanket `"use client"` on a large tree. `app/page.tsx` itself is a Server Component; none of its 12 sections' static content ships as client JS.

## Product screenshots

| File | Size |
|---|---|
| `crm-pipeline-board.png` | 156KB |
| `crm-leads-list.png` | 144KB |
| `sales-quotation-detail.png` | 124KB |
| `sales-order-detail.png` | 112KB |
| `stock-overview.png` | 100KB |
| **Total** | **640KB** (source PNGs) |

All five are rendered exclusively through `next/image` (`components/product/product-frame.tsx`'s `ProductScreenshot`), never a raw `<img>` — `next.config.mjs` configures `images.formats: ["image/avif", "image/webp"]`, so the browser receives an on-demand-transcoded, appropriately-sized AVIF/WebP response per request, not the raw 100-156KB PNG. `width`/`height` are read directly from each PNG's real `IHDR` header (not guessed), so `next/image` can reserve the correct aspect-ratio box before the image loads — no cumulative layout shift risk from these images.

**Fixed this phase**: a set of pre-generated `.webp` sibling files (~577KB combined) were being shipped in `public/product/` despite never being referenced by any component — `next/image`'s on-demand transcoding already makes them redundant. Removed, along with the excluded `crm-opportunity-detail` screenshot's PNG/WebP pair (~319KB combined, unused since that capture was never approved for marketing — see `screenshot-capture-process.md`). Net reduction: **~896KB of dead weight removed from the production artifact.**

## Fonts

No webfont is loaded — the app uses the system-ui font stack (unchanged from Phase 2), so there is no FOUT/FOIT risk and no separate font-loading network request to measure.

## Dependencies

**Fixed this phase**: removed the `sharp` devDependency (was added solely to generate the now-removed `.webp` files during screenshot capture) — `sharp` is a native-binary package and its removal reduces `node_modules` install size and CI install time, with zero production runtime impact (it was a devDependency, never bundled into the client or server output).

## What was not measured this phase

- No Lighthouse/PageSpeed Insights run — this phase's performance validation is build-artifact inspection (bundle size, image handling, dependency audit), not a synthetic-user timing benchmark.
- No Core Web Vitals (LCP/CLS/INP) field or lab measurement.
- No CDN/edge-caching configuration review (out of scope — this phase runs against a local production server, not a deployed environment).

These are reasonable candidates for Phase 7 ("CRO, analytics, performance, and accessibility optimisation") per the roadmap in `CLAUDE.md`, once there's a deployed environment and enough real page weight (more sections, more pages) to make a Lighthouse run meaningful rather than trivially passing on a mostly-empty page.
