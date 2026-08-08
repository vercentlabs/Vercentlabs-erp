# Phase 7 Production Observability Plan

What this phase implemented, what it left as a documented, provider-neutral integration point, and — explicitly — what has no backend today. No signal below is claimed as "live" or "monitored" unless a real consumer exists; where none does, that's stated plainly rather than implied.

## Request health

| Signal | Implementation status |
|---|---|
| Server errors (5xx) | **Not instrumented beyond the framework default.** Next.js's own `error.tsx` boundaries catch render errors (see "Error boundary review" below); there is no structured server-error log line comparable to the lead-pipeline ones below. A Phase 8/production candidate: wrap the root layout or a middleware hook to emit a structured `server_error` log entry with route + error class (never a full stack trace or request body) for any unhandled 500. |
| Route errors | Each route segment inherits Next.js's `error.tsx` boundary behavior (see below); no custom per-route logging beyond that today. |
| 404 rate | **Not instrumented.** Next.js's built-in `not-found.tsx` renders correctly (confirmed via route smoke tests), but no log line records a 404 occurring — there's no way today to know if a real visitor is hitting broken internal links at scale. Candidate for Phase 8. |
| Asset/render errors | Covered indirectly by `tests/e2e/production-smoke.spec.ts`'s console-error assertion (currently homepage-only — see `regression-risk-register.md`'s "known gaps"), not by any production-time signal. |

## Lead pipeline (the one signal this phase built end-to-end)

`apps/landing/lib/lead-observability.ts` (new this phase) emits four structured, JSON-line, non-PII outcomes from `/api/book-demo/route.ts`:

- `lead_capture_success`
- `lead_capture_validation_failure`
- `lead_capture_upstream_failure`
- `lead_capture_timeout`

Each entry carries: `event`, `requestId`, `route`, `durationMs`, `timestamp`, and an optional `statusCode`. **Never** the lead payload itself (name/email/phone/company/free-text), never the HMAC signature or capture secret. Success logs to `console.log`; every failure category logs to `console.error` (so a container platform's default log-level routing would surface failures more prominently without any extra configuration). Verified via `tests/e2e/lead-reliability.spec.ts`'s controlled-failure-injection suite (malformed JSON, missing fields, honeypot rejection, rate-limit exhaustion, a real upstream-unavailable 500 in this environment, and the double-click dedup fix).

**Today's actual consumer: none — this is stdout/stderr JSON lines, provider-neutral by design.** Any log-aggregation platform (CloudWatch, Datadog, a self-hosted Loki/Grafana stack, or simply the hosting platform's own log viewer) can parse these lines by their `event` field without any code change — that's the explicit point of keeping this a plain structured-log interface rather than an SDK call to a specific vendor. Wiring a real destination is a Phase 8 infrastructure decision, not a code change to this interface.

## Performance (Web Vitals / RUM)

`apps/landing/lib/web-vitals.ts` + `components/analytics/web-vitals-reporter.tsx` (new this phase) collect real LCP/INP/CLS via the official `web-vitals` package and route them through the existing `track()` call as `web_vitals_lcp`/`web_vitals_inp`/`web_vitals_cls` events (route pattern, rounded value, rating bucket, navigation type — no PII, no literal URL). **Today's actual consumer: none** — `track()` forwards to an optional `window.__vercentlabsAnalyticsSink`, which no script currently attaches (see `analytics-event-contract.md` and scope decision 1 in `decision-log.md`: no analytics provider account exists to wire up honestly). Once a real provider is chosen, attaching it is a one-file change (implement `window.__vercentlabsAnalyticsSink`), not a rearchitecture.

## Search/system health

| Signal | Implementation status |
|---|---|
| Sitemap generation failure | **Not instrumented as a runtime alert** — `app/sitemap.ts` either succeeds or the route itself 500s (which would be covered by the general server-error gap above, once built). The route's correctness is currently verified at build/test time (`tests/e2e/production-smoke.spec.ts`, `phase6-routes.spec.ts`), not monitored at runtime. |
| Structured-data validity | **Not instrumented as a runtime alert.** Verified at test time (`tests/breadcrumbs.test.mjs` and equivalent JSON-LD unit coverage); no live Rich-Results-style validation runs against production. A Phase 8/post-launch candidate once Search Console access exists (see `search-console-readiness.md`). |
| Content validators (freshness, link integrity, cannibalization) | These already exist as `pnpm content:validate`/`content:links`/`content:freshness`/`content:cannibalization` scripts (Phase 6) — they are build/CI-time checks, not production runtime monitoring. No change this phase. |

## What has a real implementation vs. what's a documented integration point (summary)

| Category | Real implementation today | Documented integration point for later |
|---|---|---|
| Lead pipeline outcomes | ✅ Structured, non-PII, 4-outcome taxonomy, tested | Log destination (CloudWatch/Datadog/etc.) |
| Web Vitals (RUM) | ✅ Real collector, real typed events, tested payload shape | Analytics backend attached to `window.__vercentlabsAnalyticsSink` |
| General analytics (page views, CTA clicks, funnel events) | ✅ ~43-event typed contract, tested for PII-safety | Same analytics backend as above |
| Server/route errors | ❌ Framework-default only | Structured `server_error` log line (Phase 8 candidate) |
| 404 rate | ❌ Not tracked | Structured `not_found` log line or a periodic broken-link crawl (Phase 8 candidate) |
| Sitemap/structured-data health | ❌ Test-time only | Runtime validator + Search Console (Phase 8/post-launch) |

## Error boundary review

- **Root boundary:** `apps/landing/app/error.tsx` exists (confirmed in the Phase 7 client-component inventory) and is a real Client Component error boundary, not a stub.
- **Route-level errors:** Next.js App Router's file convention means any route can add its own `error.tsx`; the root one is the catch-all for routes that don't.
- **Form-failure states:** `demo-form.tsx` renders a real inline error message on both validation failure and submission failure (`demo_form_error` event fires with a safe `errorCategory`, never exposing the raw error) — confirmed via `tests/e2e/lead-reliability.spec.ts`'s failure-injection scenarios, which assert the UI shows a real user-facing message rather than crashing or hanging silently.
- **404:** Next.js's built-in not-found handling renders correctly (framework default, not custom-built this phase).
- **Backend timeout:** `isTimeoutError()` in `lib/lead-observability.ts` classifies a timeout distinctly from a generic upstream failure; the demo form's catch branch shows the same safe generic error message either way (it doesn't need to distinguish timeout from other failures at the UI level — only the internal log line does).
- **No stack traces or infrastructure identifiers are ever exposed to the browser** — confirmed by reading every catch branch in `route.ts` and `demo-form.tsx`; every user-facing message is a fixed, safe string.

## Non-PII guarantee (applies to every signal in this document)

Every logging/observability mechanism described above was designed and tested against the same constraint: never name, email, phone, company, free-text field value, CRM record ID, HMAC key, API secret, or capture secret. This is verified behaviorally, not just by code review, via `tests/e2e/pii-leakage.spec.ts` (analytics/Web Vitals payloads) and by direct inspection of every `logLeadCaptureEvent()` call site (lead observability payloads) — none accepts or forwards the request body.
