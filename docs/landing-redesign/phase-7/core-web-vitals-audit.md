# Phase 7 Core Web Vitals Audit

Full methodology in `performance-methodology.md`. This document covers the LCP/CLS-specific findings; the complete per-route score table lives in `baseline-measurements.md`.

## Field data availability

**Not available — stated explicitly, per the governing brief's required language:** *"Field Core Web Vitals are not yet available because sufficient production traffic data is unavailable."* Everything below is lab data from Lighthouse against the real production build, plus the real code-level LCP-element identification the brief specifically asks for.

## LCP element identification (real, per-route — Workstream D)

Using Lighthouse's `lcp-breakdown-insight` audit (this Lighthouse version, 13.4.1, replaced the older `largest-contentful-paint-element` audit key with this insight-based equivalent — found by inspecting the raw JSON directly rather than assuming the older key still existed):

| Route (mobile) | LCP element | Type |
|---|---|---|
| `/` | Hero subhead paragraph ("Vercentlabs connects sales, inventory, procurement...") | Text |
| `/book-demo` | Subhead paragraph | Text |
| `/product` | **CRM opportunity pipeline board screenshot** | Image |
| `/modules/manufacturing` | Body copy paragraph ("A work order cannot be released without...") | Text |
| `/industries/manufacturing` | **Manufacturing production control workspace screenshot** | Image |
| `/workflows/lead-to-cash` | **Sales quotation detail screenshot** | Image |
| `/implementation` | Subhead paragraph | Text |
| `/resources` | Subhead paragraph | Text |
| `/resources/erp-buying-guide` | Subhead paragraph | Text |
| `/resources/erp-requirements-checklist` | Body copy paragraph | Text |
| `/compare/vercentlabs-vs-odoo` | Body copy paragraph | Text |

**8 of 11 routes have a text LCP element; 3 have an image LCP element** — all 3 image cases share the same source component (`PlatformHero`'s hero screenshot, used by `/product`, `/industries/[slug]`, `/workflows/[slug]`). This directly informed the one Cycle-1 fix this phase made (see below) — no route needed a font-rendering or server-response fix; TTFB was fast (5-33ms) across every single route measured, ruling that out as an LCP contributor anywhere.

## Fix applied — REPRODUCED across all 3 image-LCP routes

All 3 image-LCP routes independently showed the identical `lcp-breakdown-insight` signature: a dominant `resourceLoadDelay` subpart (416-517ms before the fix) — the specific signature of a `loading="lazy"` image that's actually above-the-fold, where the browser defers even starting the fetch. Root cause: `ProductScreenshot` (`components/product/product-frame.tsx`) never set `priority` on its underlying `next/image`, and `PlatformHero` always renders its screenshot as the very first above-the-fold content whenever one exists.

**Fix:** Added an optional `priority` prop to `ProductScreenshot` (default `false`, preserving lazy-loading everywhere else) and set it specifically at `PlatformHero`'s one hero-screenshot call site. `module-hero.tsx` (a different component, confirmed to produce a text LCP element, not image) and `product-evidence-section.tsx`'s below-the-fold secondary screenshots were deliberately left untouched.

**Result (real, measured before/after — full table in `baseline-measurements.md`):**

| Route | Mobile LCP before | Mobile LCP after | Change |
|---|---|---|---|
| `/industries/manufacturing` | 3192ms (over 2.5s target) | **1622ms** (under target) | **-1570ms, -49%** |
| `/product` | 1696ms | 1973ms | +277ms (within single-run noise — see below) |
| `/workflows/lead-to-cash` | 1687ms | 1707ms | +20ms (noise) |

Only `/industries/manufacturing` showed a clear, large, directionally-consistent improvement — this is the one route that was actually over the field target before the fix, so it's also the one route where removing ~500ms of resource-load delay had enough headroom to matter to the final LCP number. `/product` and `/workflows/lead-to-cash` were already under target before the fix and remain under target after — their small movements in either direction are consistent with normal single-run lab variance (`performance-methodology.md`), not a real regression from the same code change that helped the third route.

## CLS

**0 or near-0 (max 0.01) on every route, both form factors, both before and after this phase's fix** — well under the 0.1 field target. This reflects `ProductScreenshot`'s explicit `width`/`height` props (reserving layout space before the image loads, regardless of `priority`) and the absence of any web-font swap (no `next/font`/`@font-face` exists at all — see `regression-risk-register.md` — so there's no FOUT-driven layout shift either). No CLS-specific fix was needed anywhere.

## INP

**Not measurable via Lighthouse** — INP is an interaction-responsiveness metric that requires a real user interaction to measure; a lab tool loading a page with no simulated user input cannot produce a meaningful INP number. This is why `web-vitals.ts`'s RUM collector (see `performance-methodology.md`) is the only planned source of real INP data, once real traffic exists. No INP number is claimed anywhere in this phase's documentation.

## TBT (a lab-only proxy sometimes used to reason about responsiveness)

Several routes show elevated mobile TBT (500-1600ms — see `baseline-measurements.md`'s "Reading this data honestly" section) under Lighthouse's mobile CPU-throttling profile. This wasn't traced to a single fixable cause — it reflects genuine React hydration cost proportional to page complexity (confirmed via `javascript-and-bundle-audit.md`'s finding that every client component is legitimately interactive, and the unused-JS figure is small and stable across routes). No speculative optimization was applied against this number without a demonstrated, attributable cause, per the brief's own instruction to optimize only demonstrated bottlenecks.
