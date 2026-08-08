# Phase 7 Performance Budget

Three distinct kinds of number appear below — conflating them is the exact mistake `performance-methodology.md` warns against. Read the column header before comparing any two numbers across rows.

| Category | What it means | Who/what enforces it |
|---|---|---|
| **FIELD TARGET** | Google's real-user Core Web Vitals thresholds, measured at the 75th percentile of actual visitor sessions. Not obtainable today — no production traffic exists. | Nothing yet — will apply once `web_vitals_*` events (or CrUX) have real data. |
| **LAB BUDGET** | A target for this project's own Lighthouse baseline runs against the real production build. Directional, not a visitor guarantee. | Manual review at each measurement cycle (this phase's Cycle 1/2/3). |
| **CI GUARDRAIL** | A regression-detection range for an eventual automated check, wide enough to absorb single-run lab noise (`performance-methodology.md`'s ~5-point/noise guidance) rather than a precise pass/fail score. | Not implemented yet — no CI pipeline exists in this repo (see `decision-log.md`'s Lighthouse CI scope note). Documented here for whenever one is added. |

## Core Web Vitals

| Metric | Field target (Google) | Lab budget (this project) | CI guardrail (future) |
|---|---|---|---|
| LCP | ≤2.5s (75th pct.) | ≤2.5s on mobile Lighthouse | Flag if a route's LCP regresses by >500ms vs. its last recorded baseline |
| INP | ≤200ms (75th pct.) | Not directly measurable via Lighthouse (a lab tool can't simulate real interaction timing well) — tracked via the `web_vitals_inp` RUM event once real traffic exists | N/A until field data exists |
| CLS | ≤0.1 (75th pct.) | ≤0.1 on both mobile and desktop Lighthouse | Flag if a route's CLS exceeds 0.1 in any single run (CLS is comparatively low-noise across repeated lab runs, unlike LCP) |

## Lab-measured baseline (real numbers, from this phase's verified port-3050 run — see `baseline-measurements.md` for the full table)

- TBT: all 11 routes measured; no route exceeded a few hundred ms on mobile — full figures in `baseline-measurements.md`.
- Speed Index, FCP, TTFB: captured for every route in the same baseline; TTFB was consistently well under 100ms across all routes (a static/SSG-heavy site with no slow backend dependency), so it was never a bottleneck this phase found.

## JavaScript payload budget

| Metric | Lab budget | Current measured value |
|---|---|---|
| Total JS (raw, all shared chunks) | Keep under ~1.5 MB raw as the site grows | 1,047,349 bytes (~1.02 MB) — see `javascript-and-bundle-audit.md` |
| Total JS (gzip) | Keep under ~400 KB gzip | 296,486 bytes (~289.5 KB) |
| Third-party JS | Zero | Zero (confirmed — no third-party script exists in the codebase) |

## Image budget

| Metric | Lab budget | Current measured value |
|---|---|---|
| Per-screenshot file size | Keep individual product screenshots under ~150 KB source PNG (before AVIF/WebP conversion) | Largest is 142.8 KB (`crm-leads-list.png`) — see `media-performance-audit.md` |
| Above-the-fold hero image | Must set `priority` if confirmed as a route's LCP element | Fixed this phase for `PlatformHero`'s screenshot (see `decision-log.md` item 10) |

## Fonts

| Metric | Lab budget | Current measured value |
|---|---|---|
| Font-loading cost | Zero is acceptable if intentional | Zero — no `next/font` or `@font-face` exists; `Inter` in the CSS variable is dead code, falling back to system fonts (see `performance-methodology.md`'s plan context and `regression-risk-register.md`) |

## Quality guardrails (not strictly "performance," but budgeted alongside it per the brief)

| Check | Guardrail |
|---|---|
| Console errors | Zero on every representative route (currently verified only on the homepage via `production-smoke.spec.ts` — see `regression-risk-register.md`'s known gap) |
| Axe serious/critical violations | Zero across all 13 representative routes (currently: zero — see `accessibility-audit.md`) |
| Unexpected 4xx/5xx on representative routes | Zero (verified via route smoke tests) |
| Duplicate analytics success events | Zero — the double-click fix (`decision-log.md` item 1) directly protects this |
| PII in any analytics/observability payload | Zero — verified behaviorally via `pii-leakage.spec.ts` |

## What this budget explicitly does not do

- It does not set a single "target Lighthouse score" like 100, per the brief's own instruction against vanity scores disconnected from a measured baseline.
- It does not treat a 1-3 point Lighthouse Performance score change as a meaningful regression or improvement (see `performance-methodology.md`'s single-run-noise guidance) — only a ~5+ point shift or a clear metric-level change (e.g., LCP up several hundred ms) counts as a real signal in this project's own before/after comparisons.
- It does not claim any of the "CI guardrail" column is currently enforced by an automated pipeline — this repo has no CI configured yet (a Phase 8 candidate, not built this phase per the plan's explicit scope decision).
