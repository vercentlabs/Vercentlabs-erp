# Phase 8 Analytics, RUM, and Error-Monitoring Production Decisions

Full technical detail on what exists today: `docs/landing-redesign/phase-7/observability-plan.md` and `analytics-event-contract.md`. This document answers the specific launch-decision questions this workstream asks, without re-deriving that technical detail.

## Analytics

1. **Is an analytics provider already configured elsewhere in the repository?** No. A repo-wide search found no analytics SDK, tracking-pixel script, or provider API key anywhere in `apps/landing`. `apps/web` (a different app) is out of this phase's scope and wasn't assumed to share a provider.
2. **Is there an approved provider?** No decision exists in any repository document. This is a genuine open business decision, not a technical gap this phase can close by picking one.
3. **Can current launch occur without one?** **Yes.** The typed `track()` pipeline (`lib/analytics.ts`) is real, tested (PII-safe by construction and by behavioral test — `pii-leakage.spec.ts`), and functions correctly with zero consumer: it forwards to an optional `window.__vercentlabsAnalyticsSink`, which safely no-ops when nothing is attached. No page-rendering or conversion-flow code depends on analytics succeeding — confirmed via `lead-reliability-audit.md`'s finding that `track()`'s internal `try/catch` means even a broken sink can never block a real conversion action.
4. **What measurement is required from day one?** At minimum: `demo_form_start`/`submit`/`success`/`error` (the core funnel) and `web_vitals_lcp`/`inp`/`cls` (performance) — both already fully instrumented and waiting for a real sink.
5. **Decision:** **HIGH** — launch is not blocked on this, but real funnel and performance measurement from day one requires wiring a provider before or shortly after launch. Recorded as `analytics-integration` in `launch-readiness-scorecard.md`.

## RUM (Web Vitals)

Same provider-neutral situation as analytics — `lib/web-vitals.ts` collects real LCP/INP/CLS via the official `web-vitals` package and routes through the same `track()` pipeline, so it inherits the same "works with zero consumer, needs a real sink for actual measurement" status. No random telemetry service was wired without approval — consistent with the governing brief's explicit instruction. **Decision: HIGH**, same rationale as analytics (in practice, likely the same provider decision resolves both at once, since both flow through the identical `track()`/`window.__vercentlabsAnalyticsSink` integration point).

## Error monitoring

**No production error sink exists today** — confirmed in `phase-7/observability-plan.md`'s gap table: server/route errors rely on the Next.js framework default (an `error.tsx` boundary renders correctly, but nothing logs the error anywhere durable), and there is no structured `server_error`/`not_found` log line comparable to the lead-pipeline's own 4-outcome taxonomy.

**This is the one item in this section closer to a real launch concern than analytics/RUM**, because unlike marketing measurement, not knowing about a real production 500 or a broken asset has direct operational cost (a launch team blind to real errors can't respond to them). Per the governing brief's own instruction ("A responsible launch should have some way to identify 500s, API failures, CRM delivery failures... Do not add a heavy vendor without approval"):

- **Decision: HIGH, not BLOCKER.** The lead-delivery path specifically already has real, structured, non-PII outcome logging (`lib/lead-observability.ts`, Phase 7) — the single most business-critical failure mode (a lost lead) is already covered. What's missing is the more general "any unhandled exception anywhere" case.
- **Minimal integration requirement, not solved this phase:** wrap the root error boundary and the `/api/book-demo` handler's remaining exception paths with a structured log line (same taxonomy pattern as `lead-observability.ts`), and ensure the hosting platform's own log aggregation (whatever that turns out to be) captures stdout/stderr — which is exactly what `lead-observability.ts` already assumes and is compatible with. No specific vendor (Sentry, Datadog, etc.) is recommended or assumed here, per the instruction not to add one without approval.

## Summary decision table (for `launch-readiness-scorecard.md`)

| Capability | Blocks launch? | Real status |
|---|---|---|
| Analytics backend | No | Typed, tested, zero-consumer-safe; needs a provider decision post-launch or pre-launch, business call not technical |
| RUM backend | No | Same as analytics |
| Error monitoring (general) | No | Lead-delivery path already covered; general server-error logging is a real, disclosed gap, not launch-blocking on its own |
| Lead-delivery observability | N/A — already real | Fully built and tested in Phase 7 |
