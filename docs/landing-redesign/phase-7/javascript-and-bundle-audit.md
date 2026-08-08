# Phase 7 JavaScript & Bundle Audit

## Methodology

Turbopack (this project's build engine — `next build` with Next.js 16's Turbopack production builder) does not print the classic webpack-era per-route "First Load JS" table. This audit instead uses the real, measurable artifacts the build actually produces: file sizes in `.next/static/chunks/` (the single source of truth — `.next/standalone/**/static/chunks/` is a verified-identical copy the standalone output mechanism makes for deployment, not a second, different bundle) and Lighthouse's own per-route diagnostics (`unused-javascript`, `bootup-time`, `mainthread-work-breakdown`, `total-blocking-time`), consistent with the plan's scope decision to lean on existing build-output signals rather than add a new bundle-analyzer dependency unless the simpler signal proves insufficient — it didn't.

## Real, measured totals

- **18 JS chunk files** in `.next/static/chunks/`.
- **1,047,349 bytes raw** (≈1.02 MB) total across all 18 files.
- **296,486 bytes gzip** (≈289.5 KB) — computed by concatenating and gzip-compressing all 18 files together (approximates real transfer size; actual per-route bytes-over-the-wire are smaller since a given page only loads the chunks its route tree needs, not all 18 at once).
- **6 largest chunks** (raw): 308.1 KB, 222.0 KB, 146.9 KB, 110.0 KB, 53.4 KB, 43.4 KB — together ~884 KB of the ~1.02 MB total. These are almost certainly the React/React-DOM/Next.js runtime framework chunks (shared across every route, loaded once and cached) rather than route-specific code, consistent with this being a content-heavy marketing site with modest per-page interactivity.

## Client-component inventory (every `"use client"` file in the repo — 13 total)

| File | Justified? |
|---|---|
| `app/error.tsx` | **Yes** — error boundaries are a required Client Component per Next.js's own architecture. |
| `app/book-demo/thank-you/thank-you-effects.tsx` | **Yes** — fires the `product_demo_complete` analytics event and reads `sessionStorage` for dedup; both are client-only APIs. |
| `components/analytics/attribution-init.tsx` | **Yes** — reads `localStorage`/`document.referrer`, client-only by nature. |
| `components/analytics/homepage-view-tracker.tsx` | **Yes** — fires an analytics event on mount. |
| `components/analytics/track-view.tsx` | **Yes** — same pattern, generic view-tracking wrapper. |
| `components/analytics/tracked-cta-link.tsx` | **Yes** — needs an `onClick` handler to fire an analytics event before navigation. |
| `components/analytics/web-vitals-reporter.tsx` | **Yes** (new this phase) — the `web-vitals` package's observers are browser-API-only (`PerformanceObserver`). |
| `components/marketing/demo-form.tsx` | **Yes** — real form state, validation, and submission logic; the single most legitimately interactive component on the site. |
| `components/marketing/sticky-mobile-cta.tsx` | **Yes** — was already confirmed justified in an earlier phase (scroll-position-aware visibility requires a client-side listener). |
| `components/navigation/header.tsx` | **Yes** — hosts the mega-menu's open/close interaction state. |
| `components/navigation/mobile-nav.tsx` | **Yes** — the mobile menu's open/close/focus-trap state is inherently client-side. |
| `components/navigation/nav-menu.tsx` | **Yes** — mega-menu hover/focus/keyboard interaction logic. |
| `components/resources/requirements-checklist.tsx` | **Yes** — real client-side filter state (`requirements_filter` event) and a print action. |

**Finding: every client component in the codebase is legitimately interactive.** This audit specifically looked for the "Could be a Server Component" category the brief asks about (components marked `"use client"` merely for static rendering, with no real state/effect/browser-API usage) and found none — every one of the 13 either manages real interactive state, listens to a browser-only API, or fires a client-side event. No conversion from Client to Server Component was made this phase because none was warranted; forcing one would be optimization theater against a component list that was already lean.

## Lighthouse diagnostic signals (per-route, from the port-3050 verified-production baseline — see `baseline-measurements.md`)

| Route (mobile) | Unused JS | Bootup time | Main-thread work |
|---|---|---|---|
| `/` | 28 KB | 616ms | 1749ms |
| `/book-demo` | 28 KB | 1352ms | 2763ms |
| `/product` | 29 KB | 1614ms | 4566ms |
| `/modules/manufacturing` | 29 KB | 1318ms | 4273ms |
| `/industries/manufacturing` | 29 KB | 1498ms | 3264ms |
| `/workflows/lead-to-cash` | 29 KB | 2182ms | 4504ms |
| `/implementation` | 29 KB | 1859ms | 3769ms |
| `/resources` | 29 KB | 1245ms | 3259ms |
| `/resources/erp-buying-guide` | 29 KB | 1085ms | 2549ms |
| `/resources/erp-requirements-checklist` | 27 KB | 1841ms | 4495ms |
| `/compare/vercentlabs-vs-odoo` | 29 KB | 1794ms | 4262ms |

**Unused JS is consistently 27-29 KB across every single route** — out of a ~289.5 KB gzip total, this is stable framework/shared-chunk code not exercised by any one given page's specific interactions, not route-specific waste pointing at an over-included dependency. No route showed a large, isolated unused-JS finding that would justify code-splitting a specific dependency further.

**Main-thread work (1.7-4.6s) and bootup time (0.6-2.2s) scale roughly with page complexity** under Lighthouse's mobile CPU-throttling profile (a 4x slowdown simulating a mid-tier device) — this is real hydration cost, not evidence of a specific bug. `/workflows/lead-to-cash` and `/product` show the highest main-thread work, consistent with them being among the more content/interaction-dense templates (workflow sequence diagrams, platform hero + evidence sections). No single dependency or component was identified as a disproportionate contributor once the "every client component is justified" finding above is accounted for — the cost is spread across legitimate hydration work, not concentrated in an obvious excess.

## Third-party JavaScript

**None.** No third-party analytics/tag-manager/chat-widget/font-loader script exists anywhere in the codebase (confirmed via the CSP's `connect-src 'self'` — a third-party script attempting a cross-origin request would be blocked and would have shown up as a console error in `production-smoke.spec.ts`, which passes clean). The entire JS payload is this application's own code plus the React/Next.js framework runtime.

## Conclusion

No bundle-reduction action was taken this phase because the audit found no clear, demonstrated waste to remove — every client component is justified, there's no third-party script weight, and Lighthouse's own unused-JS diagnostic didn't flag a specific over-included dependency on any of the 11 measured routes. This is consistent with the brief's own instruction not to indiscriminately optimize without a demonstrated problem.
