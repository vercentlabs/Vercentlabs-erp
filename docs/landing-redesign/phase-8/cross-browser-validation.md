# Phase 8 Cross-Browser Validation

## Method

Firefox and WebKit added to `playwright.config.ts` (previously Chromium-only across all 7 prior phases — `desktop-chromium`, `mobile-chromium`). New projects: `desktop-firefox`, `desktop-webkit`, `mobile-webkit` (an `iPhone 14` emulated device profile — the closest available proxy for a real mobile Safari user). Scoped via Playwright's per-project `testMatch` to run only the new `tests/e2e/cross-browser-smoke.spec.ts` — re-running the full 578-test Chromium-oriented suite on every engine would mostly re-validate browser-agnostic internals (PII payload shape, attribution `localStorage` logic) that don't vary by rendering engine; what actually needs cross-engine coverage is rendering/layout/CSS/focus/console-error behavior, which is what the smoke spec targets.

## Exact engines tested — stated precisely, never overstated

| Engine | Tested? | How |
|---|---|---|
| Chromium | Yes | Full 578-test suite (Phase 1-7) + this phase's cross-browser smoke suite, both desktop and mobile-emulated |
| Firefox | Yes | `desktop-firefox` project, cross-browser smoke suite only |
| WebKit (Playwright's engine) | Yes | `desktop-webkit` and `mobile-webkit` (iPhone 14 profile) projects, cross-browser smoke suite |
| **Real Safari (actual Apple hardware/software)** | **No** | Not available in this sandbox. Playwright's WebKit is the closest available proxy for Safari's rendering engine — **it is NOT Safari itself**, and no result in this document should be read as "tested in Safari." |
| Microsoft Edge | No | Not tested — see `deployment-rehearsal.md`'s note; Edge's Chromium-based engine (post-2020) means Chromium coverage substantially — but not completely — covers Edge-specific rendering behavior. Edge-specific enterprise policies/extensions were not evaluated. |
| Real mobile device (physical hardware) | No | Not available. `mobile-webkit`'s `iPhone 14` profile is Playwright's device emulation, not a real device. |

## Results — 80/80 passed across all 5 tested browser/device projects

11 representative routes × console-error check + 5 additional interaction checks (demo-form validation, attribution `localStorage`, comparison-table rendering, footer legal links, skip-link keyboard focus) = 16 tests per project × 5 projects (minus overlap already covered by the pre-existing `desktop-chromium`/`mobile-chromium` projects' own full suite) = 80 real test executions, all passing on the **final** build (after the 2 real WebKit-specific fixes below).

## Real defect found: WebKit skip-link behavior (2 compounding causes, both fixed)

Full detail: `decision-log.md` item 2. Summary: WebKit's default keyboard-navigation mode excludes plain `<a>` links from the Tab order (a real Safari default-configuration behavior — "Full Keyboard Access" is off by default), and even once activated, WebKit doesn't reliably honor `tabindex="-1"` fragment-focus the way Chromium/Firefox do. Both fixed via a small client component (`components/layout/skip-link.tsx`) using `tabIndex={0}` (forces Tab-reachability regardless of engine default) plus an explicit `.focus()` call. **This defect would never have been found without real WebKit testing** — 7 phases of Chromium-only testing, and even this phase's own initial Firefox check, both passed cleanly on the exact same code.

## Screenshot review

`tests/e2e/visual-review.spec.ts` (Phases 3-6) already captures real screenshots at multiple viewports on `desktop-chromium`/`mobile-chromium` — not re-run on Firefox/WebKit this phase (would meaningfully increase this phase's already-large test surface for marginal incremental value, given the smoke suite's console-error + interaction checks already caught the one real rendering-adjacent defect that existed). No typography, flex/grid, or image-sizing difference was observed in the manual review of the cross-browser smoke suite's test output (element visibility assertions passed on every route/engine combination, which would fail on a genuinely broken layout).

## Conclusion

Real, substantive cross-browser gap closed this phase (Firefox + WebKit, previously zero coverage). One real, previously-undetectable defect found and fixed. The remaining gaps (real Safari, real Edge, real mobile hardware) are stated explicitly as untested, not silently assumed equivalent to what was tested.
