# Phase 7 Lead Reliability Audit

## Path under test

```
Browser form (demo-form.tsx)
  → client-side validation (lib/demo-form-validation.ts)
  → POST /api/book-demo (app/api/book-demo/route.ts)
    → rate limiting (lib/rate-limit.ts)
    → honeypot check
    → HMAC-signed request construction (lib/crm-capture.ts)
    → CRM capture endpoint (apps/web, when running)
  → structured outcome logging (lib/lead-observability.ts)
  → response to browser
  → analytics event (demo_form_submit / _success / _error)
  → navigation to /book-demo/thank-you (on success)
```

## Scenarios tested — all REPRODUCED via `tests/e2e/lead-reliability.spec.ts`

| Scenario | Method | Result |
|---|---|---|
| Valid submission | Real form fill + submit | 201, navigates to thank-you page, `product_demo_complete` fires once (deduped by `requestId` via `sessionStorage`). |
| Malformed JSON body | Direct API call with a raw `Buffer` containing invalid JSON (not a string — Playwright re-serializes strings, see `decision-log.md` item 4) | Handled gracefully — no unhandled 500 crash; a controlled 4xx/validation response. |
| Missing required fields | Direct API call with an incomplete body | Controlled validation-failure response, not a crash. |
| Honeypot field filled | Direct API call with the honeypot field populated | Rejected — the request never reaches CRM delivery. |
| Rate-limit exhaustion | 6 rapid sequential requests from a synthetic per-test client IP (`uniqueClientHeaders()` helper, avoiding cross-test contamination in the shared in-memory rate limiter) | First N succeed/route normally, subsequent requests receive 429, confirming the limiter actually engages. |
| Upstream unavailable | This environment has no `apps/web` server running, so `deliverDemoRequest`'s real fetch to the CRM capture endpoint genuinely fails with connection-refused, surfacing as a real 500 (MEASURED — confirmed via direct `curl`, see `decision-log.md` item 2) | No crash into an unhandled exception — the outer catch block in `route.ts` returns a controlled error response and logs `lead_capture_upstream_failure` (or `_timeout` if `isTimeoutError()` classifies it as such). |
| Client-level 502 handling | Simulated via `page.route()` interception | Demo form shows a real, safe, user-facing error message — not a blank state or an unhandled promise rejection. |
| Network abort during submission | Simulated via `page.route()` abort | Same — safe error message shown, `demo_form_error` fires with `errorCategory: "network"`. |
| Rapid double-click (duplicate submission) | Genuine synchronous double `element.click()` in one JS tick (not two sequentially-awaited clicks, which masks the race — see `decision-log.md` item 1) | **Found a real P0 bug, fixed this phase.** Before the fix: 2 POST requests from one double-click (a `useState`-only guard raced against React's batching). After: exactly 1 request, verified via a route-level request counter. |
| Literal `null` (or any non-object) JSON body | `curl -X POST --data "null"` — syntactically valid JSON that isn't an object | **Found a second real bug in Cycle 2 review, fixed this phase.** `JSON.parse("null")` succeeds, so `validateDemoForm(null)` was reached and threw on property access, crashing into an uncaught, unlogged, non-JSON 500. Fixed via a type guard immediately after parsing (`decision-log.md` item 13); verified post-fix: returns a controlled `400` with the standard `{ok, requestId, error}` shape. |
| Client-supplied `attribution` object overwriting trusted fields | Cycle 2 source review: `customData`'s spread order let `body.attribution.requestId`/`.source` silently overwrite the server-trusted values before forwarding to the CRM | **Found and fixed this phase** (`decision-log.md` item 14) — reordered the spread so trusted fields always win regardless of client input. |

## Requirements checklist (per the governing brief)

- ✅ Validation failures are controlled (never an unhandled exception).
- ✅ Malformed requests do not crash into unhandled 500s (the malformed-JSON and missing-field scenarios both return controlled responses).
- ✅ No duplicate submission from a button double-click (fixed this phase — was previously broken).
- ✅ No secrets exposed in any response body or log line (`lead-observability.ts` never logs the HMAC key, capture secret, or lead payload — verified by reading every call site, not just by convention).
- ✅ No raw lead payload logged — `logLeadCaptureEvent()`'s type signature (`LeadCaptureOutcome`, `requestId`, `durationMs`, `statusCode`) structurally cannot carry the form payload.
- ✅ Request/correlation ID available — every log entry carries `requestId`, generated once per request and threaded through the whole handler.
- ✅ Safe operational failure category emitted — the 4-outcome taxonomy (`success`/`validation_failure`/`upstream_failure`/`timeout`) is the exact shape the brief asked for.

## What this audit does NOT claim

- **No exactly-once CRM-delivery guarantee.** The double-click fix prevents the *client* from sending two requests for one user action, but this is not the same as end-to-end exactly-once delivery semantics (e.g., a client retry after a timeout whose original request actually succeeded server-side could still produce two CRM records — a distributed-systems problem outside this phase's scope, and outside what a marketing-site landing form can solve unilaterally without idempotency-key support on the CRM capture endpoint itself, which lives in `apps/web`, not this repo).
- **Analytics failure cannot block CRM delivery — verified by design, not by a dedicated fault-injection test.** `lib/analytics.ts`'s `track()` function wraps its body in a `try/catch` that swallows all errors, and it's called *after* the CRM delivery attempt in `demo-form.tsx`'s submit flow, not before or interleaved with it — so even if `track()` threw, it could not prevent the CRM request already in flight from completing. No test intentionally breaks `window.__vercentlabsAnalyticsSink` to reproduce this behaviorally; it's an INFERRED conclusion from reading the actual call order and the try/catch, not a REPRODUCED one.
- **No production-scale load test.** All scenarios above are single-request or small-burst (6 requests) — this audit says nothing about behavior under real concurrent production traffic.

## Additional fix from Cycle 2 review: rate-limiter memory growth

`lib/rate-limit.ts`'s in-memory bucket Map previously retained every unique rate-limit key forever (only resetting count/resetAt in place, never deleting the entry) — an undocumented, real risk of unbounded growth in a long-running production process. Fixed via lazy pruning of expired entries on each call (`decision-log.md` item 15). Not a crash risk in the short term, but a real gap in "no path degrades unboundedly over time."

## Remaining production-integration needs (for `phase-8-brief.md`)

- A real log destination for the `lead_capture_*` structured events (currently stdout/stderr only — see `observability-plan.md`).
- A decision on whether the CRM capture endpoint should support an idempotency key to close the exactly-once gap noted above, once real traffic makes that risk concrete rather than theoretical.
