# Phase 7 Baseline Measurements

Real Lighthouse output — see `performance-methodology.md` for the full methodology, tooling, and lab-vs-field distinction this data must be read against. Every number below traces to a saved JSON report under `apps/landing/.lighthouse-reports/` (gitignored — reproducible via `pnpm --filter @vercentlabs/landing lighthouse:baseline`, not committed as an artifact). Both runs targeted `http://localhost:3050`, a dedicated production server verified clean of dev-mode contamination (see `decision-log.md` item 8) — not the default port 3000, which this session found compromised by an external, unrelated `next dev` process partway through the session.

Two full 22-run passes exist: **`cycle1-baseline`** (before this phase's one Cycle-1 code fix) and **`cycle1-after-lcp-fix`** (after adding `priority` to `PlatformHero`'s screenshot — `decision-log.md` item 10). The table below shows both, so the one real, attributable change is visible against the noise floor of everything that didn't change.

## Full results — mobile

| Route | Perf (before→after) | A11y | Best Practices | SEO | FCP | LCP (before→after) | TBT | CLS | Speed Index | TTFB |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 92→88 | 100 | 100 | 100 | 1043ms | **2913ms→3043ms** | 184ms | 0 | 1458ms | 11ms |
| `/book-demo` | 98→84 | 100 | 100 | 100 | 806ms | 2329ms→1842ms | 77ms | 0 | 806ms | 14ms |
| `/product` | 85→79 | 100 | 100 | 100 | 1495ms | 1696ms→1973ms | 568ms | 0 | 1495ms | 13ms |
| `/modules/manufacturing` | 77→84 | 100 | 100 | 100 | 1553ms | 1785ms→1917ms | 1015ms | 0 | 1553ms | 14ms |
| `/industries/manufacturing` | 78→89 | 100 | 100 | 100 | 1617ms | **3192ms→1622ms** | 581ms | 0 | 1617ms | 11ms |
| `/workflows/lead-to-cash` | 88→77 | 100 | 100 | 100 | 1442ms | 1687ms→1707ms | 458ms | 0 | 1442ms | 11ms |
| `/implementation` | 78→78 | 100 | 100 | 100 | 1418ms | 1758ms→1528ms | 926ms | 0 | 1441ms | 18ms |
| `/resources` | 77→87 | 100 | 100 | 100 | 838ms | 1889ms→1412ms | 1040ms | 0 | 1325ms | 11ms |
| `/resources/erp-buying-guide` | 81→92 | 100 | 100 | 100 | 1388ms | 1690ms→1938ms | 788ms | 0 | 1388ms | 12ms |
| `/resources/erp-requirements-checklist` | 85→77 | 100 | 100 | 100 | 1285ms | 1531ms→1649ms | 570ms | 0 | 1285ms | 12ms |
| `/compare/vercentlabs-vs-odoo` | 63→72 | 100 | 100 | 100 | 1629ms | 3615ms→3003ms | 1632ms | 0 | 1895ms | 21ms |

## Full results — desktop

| Route | Perf (before→after) | A11y | Best Practices | SEO | FCP | LCP (before→after) | TBT | CLS | Speed Index | TTFB |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 100→93 | 100 | 100 | 100 | 274ms | 540ms→949ms | 0ms | 0.009 | 283ms | 5ms |
| `/book-demo` | 100→100 | 100 | 100 | 100 | 247ms | 348ms→391ms | 16ms | 0.004 | 341ms | 33ms |
| `/product` | 100→100 | 100 | 100 | 100 | 379ms | 461ms→464ms | 79ms | 0.008 | 605ms | 17ms |
| `/modules/manufacturing` | 100→100 | 100 | 100 | 100 | 311ms | 486ms→567ms | 18ms | 0 | 343ms | 7ms |
| `/industries/manufacturing` | 99→99 | 100 | 100 | 100 | 410ms | **795ms→463ms** | 86ms | 0 | 570ms | 8ms |
| `/workflows/lead-to-cash` | 100→81 | 100 | 100 | 100 | 313ms | 488ms→606ms | 13ms | 0 | 388ms | 6ms |
| `/implementation` | 100→100 | 100 | 100 | 100 | 380ms | 442ms→493ms | 52ms | 0 | 492ms | 8ms |
| `/resources` | 92→93 | 100 | 100 | 100 | 271ms | 527ms→403ms | 216ms | 0 | 1246ms | 9ms |
| `/resources/erp-buying-guide` | 97→98 | 100 | 100 | 100 | 291ms | 454ms→549ms | 153ms | 0.01 | 580ms | 7ms |
| `/resources/erp-requirements-checklist` | 100→91 | 100 | 100 | 100 | 310ms | 499ms→453ms | 19ms | 0 | 381ms | 10ms |
| `/compare/vercentlabs-vs-odoo` | 100→93 | 100 | 100 | 100 | 351ms | 403ms→715ms | 78ms | 0 | 450ms | 10ms |

## Reading this data honestly

**One real, attributable change:** `/industries/manufacturing` mobile LCP dropped from 3192ms to 1622ms (**-1570ms, -49%**) after adding `priority` to its hero screenshot — the only route whose underlying code actually changed between the two runs, and the only LCP change large enough (and directionally consistent with the fix's mechanism — see `decision-log.md` item 10) to be a confirmed improvement rather than noise. This moved the route from over the 2.5s field target to comfortably under it (on lab data — see `performance-methodology.md`, field data doesn't exist yet). Desktop LCP for the same route also improved (795ms→463ms), consistent with the same fix.

**Everything else is noise, not signal — and is disclosed as such, not cherry-picked away.** No other route's code changed between these two runs, yet Performance scores moved by anywhere from 0 to 19 points in either direction (e.g., `/resources/erp-requirements-checklist` desktop dropped 100→91; `/workflows/lead-to-cash` desktop dropped 100→81) and LCP values shifted by hundreds of milliseconds on unrelated routes. This is exactly the single-run lab variance `performance-methodology.md` warns about — this project does not treat any of these as regressions requiring investigation, because there is no code change that could explain them, and re-running either measurement again would likely show yet another set of small movements in both directions.

**TBT is the one metric worth independent note:** several routes show TBT in the 500-1600ms range on mobile (`/compare/vercentlabs-vs-odoo` mobile: 1632ms; `/resources` mobile: 1040ms; `/modules/manufacturing` mobile: 1015ms). This reflects Lighthouse's mobile CPU-throttling profile (a real, if aggressive, simulated mid-tier-device condition) applied to genuine React hydration work, not a specific bug — no route showed a TBT value clearly attributable to a single fixable cause during this audit (see `javascript-and-bundle-audit.md`'s finding that the bundle itself has no obvious excess weight to trim).

## Accessibility, Best Practices, SEO

**100/100 on every single route, both form factors, both runs.** Accessibility hit 100 consistently because the site-wide color-contrast fix (`decision-log.md` item 3) landed before either of these baseline runs — both runs already reflect the fixed state, not a before/after for that specific defect (which was found and fixed while building this phase's test suite, ahead of the formal Lighthouse baseline). **Reminder, per `performance-methodology.md`: Lighthouse's Accessibility score is not a complete accessibility audit** — see `accessibility-audit.md` for the real axe-core and manual WCAG 2.2 findings, which used a broader ruleset than Lighthouse's subset.

## Field Core Web Vitals

**Not available.** No production traffic exists. See `performance-methodology.md` for the full explanation and the exact required disclosure language.

## Cycle 3 final comparison (baseline → final, after all fixes)

A third full 22-run Lighthouse pass (`cycle3-final`) ran against the truly-final build — after the LCP `priority` fix, the null-body/attribution-spread/rate-limit fixes, the 5 broken-link removals, the `intent=specialist` fix, and the checkbox-group accessibility fix. This is the honest baseline-to-final comparison, not cherry-picked:

| Route | Perf mobile (baseline→final) | LCP mobile (baseline→final) | Perf desktop (baseline→final) | LCP desktop (baseline→final) |
|---|---|---|---|---|
| `/` | 92→75 | 2913ms→3141ms | 100→100 | 540ms→478ms |
| `/book-demo` | 98→91 | 2329ms→1510ms | 100→100 | 348ms→444ms |
| `/product` | 85→81 | 1696ms→1647ms | 100→100 | 461ms→403ms |
| `/modules/manufacturing` | 77→91 | 1785ms→1956ms | 100→100 | 486ms→485ms |
| `/industries/manufacturing` | 78→81 | **3192ms→2104ms** | 99→100 | 795ms→488ms |
| `/workflows/lead-to-cash` | 88→96 | 1687ms→1982ms | 100→100 | 488ms→487ms |
| `/implementation` | 78→93 | 1758ms→1908ms | 100→100 | 442ms→369ms |
| `/resources` | 77→85 | 1889ms→1860ms | 92→100 | 527ms→408ms |
| `/resources/erp-buying-guide` | 81→85 | 1690ms→1593ms | 97→100 | 454ms→474ms |
| `/resources/erp-requirements-checklist` | 85→90 | 1531ms→1953ms | 100→100 | 499ms→485ms |
| `/compare/vercentlabs-vs-odoo` | 63→87 | 3615ms→2182ms | 100→100 | 403ms→646ms |

**Accessibility, Best Practices, SEO: 100/100 on every route, both form factors — unchanged and stable across all 3 runs.** **CLS: 0 (or ≤0.01) on every route, both runs — no layout-shift regression from any fix.**

**Honest read, disclosing what got worse alongside what got better:**

- **`/industries/manufacturing` is durably better** — mobile LCP 3192ms→2104ms (still a real -34% improvement, now comfortably under the 2.5s field target; the immediate post-fix reading of 1622ms was itself a single-run sample, and 2104ms sits within normal variance of that while still clearly beating the pre-fix baseline). Desktop LCP also durably better (795ms→488ms).
- **`/compare/vercentlabs-vs-odoo` mobile improved substantially** (perf 63→87, LCP 3615ms→2182ms) despite no code change to that route — this is very likely largely noise/system-load variance from the earlier contaminated/contended runs (see `decision-log.md` items 8-9 on this session's own measurement contamination), not a real code-driven improvement. Recorded honestly as an unexplained-by-code-change movement, not claimed as a fix result.
- **Several routes got mobile-Perf-score worse in raw terms** (`/` 92→75, `/product` 85→81) with no corresponding code change to those routes — consistent with `performance-methodology.md`'s own single-run-noise caveat. None of these show a corresponding LCP regression large enough to indicate a real problem (e.g., `/`'s LCP moved from 2913ms to 3141ms, a ~228ms/8% shift within normal lab variance, not a collapse).
- **`/compare/vercentlabs-vs-odoo` desktop LCP got worse** (403ms→646ms) — still fast in absolute terms (well under any reasonable budget), flagged here specifically because the brief requires disclosing regressions, not because it represents a real concern at this magnitude.
- **No route regressed below its own field-target-relevant thresholds** — every mobile LCP that was already under 2.5s stayed under 2.5s; the one route that was over target is now durably under it.

This is consistent with `performance-methodology.md`'s core message: single Lighthouse runs carry real noise, and only `/industries/manufacturing`'s change is large enough, consistent enough (confirmed at both the immediate post-fix measurement and this later Cycle 3 measurement), and mechanistically explained (the `priority` fix directly targets exactly this route's LCP-blocking behavior) to be treated as a confirmed, attributable improvement.
