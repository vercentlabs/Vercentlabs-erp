# Phase 8 Security Header, CORS, and Abuse-Protection Audit

Security response headers and CSP are covered in `structured-data-final-audit.md`'s dedicated sections (verified live, cross-browser). This document covers CORS/origin behavior and rate-limiting/abuse protection for the lead-capture path specifically.

## CORS / origin — the lead-capture request is server-to-server, not browser-to-server

`lib/crm-capture.ts`'s `deliverDemoRequest()` runs entirely on `apps/landing`'s own server (confirmed: it's imported only from `app/api/book-demo/route.ts`, a server-only route handler, never from a `"use client"` component — a repo-wide grep for its import confirms this). The actual browser-facing request is `POST /api/book-demo` on `apps/landing`'s own origin — same-origin by construction, so no CORS policy is even relevant to the browser's half of this flow. The second hop (`apps/landing`'s server → `apps/web`'s CRM capture endpoint) is a server-to-server `fetch()`, which browsers' CORS enforcement doesn't apply to at all; the actual trust mechanism there is the HMAC signature described below, not CORS.

## Authentication of the lead-delivery request (HMAC)

Every request to `apps/web`'s CRM capture endpoint is signed: a timestamp, a SHA-256 fingerprint of the client's IP+user-agent, and an HMAC-SHA256 signature (keyed by `CRM_CAPTURE_PROXY_SECRET`, confirmed server-only — never appears in any client bundle, verified via grep) over `{timestamp}.{fingerprint}.{body}`. This means:

- A request can't be forged without knowing the shared secret.
- **Replay protection — independently REPRODUCED by Cycle 2 security review, not just assumed:** `apps/web/src/app/api/crm/public/capture/[key]/route.ts` enforces `SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000` (a 5-minute signature validity window), regex-validates the timestamp/fingerprint header format, and uses `timingSafeEqual` for constant-time signature comparison (avoiding a timing side-channel). This phase's first draft of this document incorrectly called this "out of scope to re-audit" while still asserting it worked — Cycle 2 review correctly flagged that as an unverified claim; it has now actually been checked and confirmed correct.
- **Residual, accepted risk:** a captured, valid signed request remains replayable for its full 5-minute window (no nonce/idempotency check beyond the timestamp bound) — this would require an attacker to already have a valid captured signature (via log exposure or a MITM position), and the worst outcome is a duplicate CRM lead record, not data exposure. **ACCEPTED-RISK** — not fixed this phase; a nonce-based idempotency key would close this but adds real complexity for a low-likelihood, low-severity scenario.
- The request also carries a 10-second timeout (`AbortSignal.timeout(10_000)`), preventing a hung upstream connection from blocking the landing server's own request-handling capacity indefinitely.

**The signing secret is never exposed client-side** — confirmed directly (not assumed): `process.env.CRM_CAPTURE_PROXY_SECRET` is read only inside `lib/crm-capture.ts`, which is never imported by any Client Component, and Next.js's own build-time bundling only inlines `NEXT_PUBLIC_*`-prefixed variables into client bundles — this variable doesn't have that prefix, so it's structurally excluded from ever reaching the browser regardless of import graph mistakes.

## Rate limiting and abuse protection

`lib/rate-limit.ts` applies a simple per-IP limit (5 requests per 15-minute window) to `/api/book-demo`, confirmed via the route handler's own `checkRateLimit(\`book-demo:${ip}\`, 5, 15 * 60 * 1000)` call. Phase 7 found and fixed a real gap here (unbounded in-memory Map growth — see `phase-7/decision-log.md` item 15, now fixed with lazy pruning). This is intentionally a low-friction control, not a CAPTCHA — consistent with the governing brief's own instruction not to introduce invasive CAPTCHA automatically.

### REPRODUCED and FIXED — rate limiting was trivially bypassable via `X-Forwarded-For` spoofing

**Finding (Cycle 2 security review, independently reproduced with a live test):** `lib/request.ts`'s `clientIp()` previously trusted the raw client-supplied `X-Forwarded-For` header unconditionally (`request.headers.get("x-forwarded-for")` — a header any HTTP client, including a direct unproxied attacker, can set to any value). A live test sending 6 POSTs to `/api/book-demo`, each with a distinct spoofed `X-Forwarded-For` value, never triggered the rate limit (`429`); 6 unspoofed requests from the same real connection did trigger it starting on request 4 — proving the limiter was keying off attacker-controlled input.

**Fix:** `clientIp()` now follows the exact same secure-by-default pattern already established in `apps/web/src/lib/security.ts`'s own `clientIp()` — it trusts **no** client-suppliable header at all unless `TRUSTED_PROXY_IP_HEADER` is explicitly configured (naming a specific header a known, trusted reverse proxy is guaranteed to set/overwrite itself, never the raw client). Until that's configured for the real production deployment, every request rate-limits into one shared, safe bucket (`"unavailable"` in production, `"local"` in dev) rather than trusting a spoofable value. See `environment-contract.md` and `.env.example` for the new `TRUSTED_PROXY_IP_HEADER`/`TRUSTED_PROXY_CLIENT_INDEX` variables.

**Real consequence, disclosed:** until `TRUSTED_PROXY_IP_HEADER` is configured for the actual production deployment topology, the rate limit becomes effectively **global** (5 requests per 15 minutes across all visitors combined, not per-visitor) rather than silently insecure. This is a deliberate, safer default — a global limit that's too strict is a usability problem (fixable by configuring the trusted-proxy header once the real deployment topology is known); a per-IP limit that trusts attacker input is a security hole. **This must be configured before launch** if per-visitor rate limiting is actually desired in production — tracked as a launch-readiness item.

**Known, pre-existing, documented limitation, not fixed this phase:** the rate limiter is also in-memory and single-process (stated in the file's own doc comment) — it resets on redeploy and doesn't coordinate across multiple server instances. If the real production deployment runs more than one instance behind a load balancer, this limiter provides materially weaker protection than its numbers suggest even once `TRUSTED_PROXY_IP_HEADER` is correctly configured. Flagged as a real, open architectural question — see `deployment-rehearsal.md` and `launch-readiness-scorecard.md`.

## Additional abuse protection already in place (confirmed via Phase 7 testing, re-verified unchanged this phase)

- **Honeypot fields** (`websiteUrl`, `companyWebsiteHidden`) — a filled honeypot is rejected outright, confirmed via `tests/e2e/lead-reliability.spec.ts`'s existing test, re-passing in this phase's Cycle 3 regression.
- **Body-shape validation** — a `null`/non-object JSON body now returns a controlled `400` rather than crashing (Phase 7 fix, `phase-7/decision-log.md` item 13), confirmed via `tests/e2e/lead-reliability.spec.ts`'s regression test.
- **No PII in abuse-adjacent logs** — `lib/lead-observability.ts`'s structured logging never includes the request body, confirmed by its type signature (structurally cannot carry it) and re-verified via `tests/e2e/pii-leakage.spec.ts`, re-passing this phase.

## Conclusion

No new abuse-protection gap was found this phase requiring a code change. The one open architectural question (multi-instance rate-limit coordination) is a real, disclosed, unresolved item — not fixed, because it depends on a production deployment topology decision (single vs. multi-instance) that hasn't been made yet, and building a shared-store rate limiter (e.g., Redis-backed) speculatively, without knowing whether it's actually needed, would be exactly the kind of premature complexity this project's own engineering discipline avoids.
