# Phase 7 Analytics Integrity Audit

## Type safety

`track(event: AnalyticsEventName, properties?: SafeAnalyticsProperties)` is the single entry point every call site in the codebase uses — confirmed via a full-repo grep for `track(` (see `analytics-event-contract.md`'s inventory). `AnalyticsEventName` is a closed union (`(typeof ANALYTICS_EVENTS)[number] | HomepageAnalyticsId | "implementation_specialist_cta_click" | "sticky_mobile_cta_click"`), not `string` — a call site passing an event name outside this union fails `tsc --noEmit`, which this phase confirmed clean (see `implementation-summary.md`'s validation section). No call site was found using an untyped or arbitrary string.

## Search results (all negative — no findings)

- **Direct untyped event dispatch:** none found. Every `track()` call site was enumerated in `analytics-event-contract.md`; all pass through the typed function.
- **Arbitrary strings bypassing the type:** none found. A repo-wide grep for `as AnalyticsEventName` and `as any` near analytics code turned up zero production-code matches — the only casts touching `__vercentlabsAnalyticsSink` directly are in `tests/e2e/pii-leakage.spec.ts`, which intentionally monkey-patches the sink to intercept events for testing (a legitimate test-only pattern, not a production bypass).
- **Deprecated event names still firing:** none found. Every event in `ANALYTICS_EVENTS` (and the 2 out-of-band additions) has at least one real call site — no dead entries were found still being fired from removed UI.
- **Forgotten properties:** `SafeAnalyticsProperties` is a closed interface (15 fields) — a call site cannot pass a property the type doesn't declare, so there's no way to "forget" a property in the sense of a typo silently creating a new, unindexed field the way a loose `Record<string, unknown>` would allow.
- **Unsafe `as` casts:** none in production code (see above).
- **Free-form analytics payloads:** structurally impossible — `track()`'s second parameter type has no index signature, so an arbitrary object literal with extra fields fails to typecheck.

## Duplicate/redundant events

No two events were found firing for the same user action from the same location. The closest pattern worth naming explicitly (not a defect): `demo_form_success` (server-confirmed, fires from `demo-form.tsx` on a 2xx response) and `product_demo_complete` (fires from the thank-you page, deduped per `requestId` via `sessionStorage`) are **intentionally** two distinct events for the same underlying conversion — see `analytics-event-contract.md`'s explanation: this is a deliberate reliability design (letting a future analysis detect silent client/server funnel divergence), not accidental duplication. If a provider is later wired up, both remain useful signals and should not be collapsed into one.

## Business-purpose test (per the brief: "every event must answer what decision it will enable")

Every event catalogued in `analytics-event-contract.md` has a stated business purpose. No event was found during this audit that exists without a clear consumer decision it informs — none were removed, because none failed the test.

## Two events outside the shared-array sync guard (real gap, documented, not fixed)

`sticky_mobile_cta_click` and `implementation_specialist_cta_click` are declared as ad hoc literal additions directly in `apps/landing/lib/analytics.ts`'s `AnalyticsEventName` union rather than being part of the shared `ANALYTICS_EVENTS` array in `packages/landing-content` that `tests/analytics-events-sync.test.mjs` protects. Both are real, currently-firing, correctly-typed events — this is not a functional bug (typecheck passes, runtime works) — but it means these two events sit outside the specific drift-protection mechanism Phase 4 built after a real type/runtime-array divergence incident (`docs/landing-redesign/phase-4/decision-log.md`, referenced in `regression-risk-register.md` item 6). Recommended follow-up, not done this phase to avoid an unnecessary content-package change mid-phase: fold both into the shared array.

## PII verification (cross-referenced with `tests/e2e/pii-leakage.spec.ts`)

`SafeAnalyticsProperties`'s 15 fields (`section`, `ctaLocation`, `ctaDestination`, `module`, `workflow`, `industry`, `formStep`, `errorCategory`, `campaignSource`, `campaignMedium`, `campaignName`, `referrerCategory`, `routePattern`, `metricValue`, `metricRating`, `navigationType`) were each individually reviewed — none can structurally hold a name, email, phone, company, free-text value, or secret. This was verified behaviorally, not just by type inspection: `pii-leakage.spec.ts` fills the real demo form with distinctive fake values for every field (including `mainChallenge`, the one free-text field) and asserts none of those exact serialized values appear in any captured event payload. Both tests pass.

## Conclusion

No integrity defects found. The type system, the closed properties interface, and the behavioral PII test together provide layered protection — a call site cannot violate the contract at compile time, and the one gap that does exist (2 events outside the sync guard) is a maintainability note, not a safety or correctness issue.
