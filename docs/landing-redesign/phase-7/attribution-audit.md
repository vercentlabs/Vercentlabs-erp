# Phase 7 Attribution Audit

## Scope

`apps/landing/lib/attribution.ts` implements first-party, first-touch campaign attribution: UTM parameters (`utm_source`/`utm_medium`/`utm_campaign`/`utm_content`/`utm_term`), landing path, and a classified referrer category (`direct`/`search`/`social`/`referral`/`email`), captured once per browser via `localStorage` and never overwritten. `AttributionInit` (mounted in the root layout, every page) calls `captureFirstTouchAttribution()` on load. No cookie, no cross-site tracking, no personal data — only campaign metadata and a timestamp.

## Methodology

Prior to this phase, `tests/attribution.test.mjs` only proved the module degrades gracefully outside a browser (`node --test` has no DOM). It never exercised the actual `localStorage`-backed behavior in a real browser. This phase adds `tests/e2e/attribution.spec.ts` — 9 real-browser scenarios, run against both `desktop-chromium` and `mobile-chromium` Playwright projects (18 total test runs).

## Scenarios tested and results — all REPRODUCED, all pass

| Scenario | Result |
|---|---|
| Initial campaign visit (`utm_source`/`utm_medium`/`utm_campaign` in query string) | Captured correctly: all UTM fields, `landingPath`, `referrerCategory`, `firstTouchAt` populated. |
| Internal navigation after first touch (clicking a nav link) | First-touch record unchanged — same `firstTouchAt` timestamp, same UTM values. |
| Refresh | Record identical before/after — `localStorage` persists across reloads as expected. |
| Back/forward navigation | Record unchanged — no re-capture on history navigation. |
| Second, later campaign visit in the same browser (different UTM params) | **Correctly ignored** — the original first-touch record's `utmSource`/`utmCampaign`/`firstTouchAt` are preserved; the second campaign's params never overwrite it. This is the specific behavior the brief calls out as a hard requirement ("never overwrite first-touch accidentally"), and it holds. |
| Direct revisit (no campaign params) after an earlier campaign visit | Existing attribution untouched. |
| First visit with no campaign params at all | Still records a valid attribution (`referrerCategory` correctly falls back to `direct`/`search`/`social`/`referral`; no crash, no `undefined` reference errors). |
| Oversized/malformed UTM value (500-character `utm_source`) | Truncated to 200 characters by the existing `.slice(0, 200)` guard in the source — does not crash, does not store an unbounded string. |
| Availability at demo-form submission time | `getAttribution()` correctly returns the first-touch record when called from the `/book-demo` route, confirming the attribution data a lead-delivery integration would actually have access to at submit time. |

## Expiry, malformed-param, and privacy behavior (explicitly stated, per the brief's requirement)

- **Expiry: none.** A first-touch record persists in `localStorage` indefinitely — there is no TTL and no explicit re-attribution window. This is a deliberate first-touch-model choice, not an oversight: a "session" concept doesn't apply to a same-browser-forever first-party record the way it would to a cookie with a defined lifetime. The one named consequence: a visitor who first arrives via a paid campaign, doesn't convert, and returns weeks or months later via organic search will still show the original campaign as first touch. This is standard first-touch-attribution behavior, not unique to this implementation, and is disclosed here rather than left implicit.
- **Malformed params:** truncated to 200 characters per field (`.slice(0, 200)`), never rejected outright, never crash the capture. A UTM value containing characters that would break JSON serialization is impossible by construction — `URLSearchParams` and `JSON.stringify` handle arbitrary string content safely.
- **Privacy:** only campaign metadata, landing path, referrer category, and a timestamp are stored — no name, email, phone, IP, or any other personal identifier. Storage is first-party (`localStorage`, same-origin), not a third-party tracking cookie, consistent with the source comment's own stated rationale for why this doesn't require consent-banner gating under most jurisdictions' first-party-analytics carve-outs. (This is a technical/architectural observation, not a legal opinion — final consent-banner scoping remains a Phase 8 legal/compliance readiness item.)

## Findings

No P0/P1 defects found. Attribution behaves correctly across every scenario the brief names, verified by real, reproducible browser tests (not inferred from reading source alone). One test-authoring bug was found and fixed while building this suite (a hydration-timing race reading `localStorage` before `AttributionInit`'s `useEffect` had run on the slower mobile-emulated profile) — see `decision-log.md` item 7. Not a product defect.
