# Phase 8 Redirect and 404 Audit

Full crawl methodology and route classification: `final-route-inventory.md`. This document isolates the two specific checks this workstream calls out.

## Redirects

**Exactly one redirect exists in the application:** `/product/security` → `/security`, a permanent `308`, verified via `curl -o /dev/null -w "%{redirect_url}"` against the live production build. One hop, no chain, no loop. No other route in the 69-route crawl produced a 3xx response. No new redirect was added this phase — the 5 dead links Phase 7 removed were removed from navigation, not redirected, since none of them ever pointed at real content to redirect *from*.

## 404 behavior

Verified directly against the live production build: `GET /this-does-not-exist` returns a real HTTP `404` (not a `200` disguised as an error page, and not a redirect to the homepage). The response body renders useful site navigation and the message "We couldn't find that page" — confirmed both via direct `curl` inspection and via `tests/e2e/production-smoke.spec.ts`'s existing automated test, re-run against this phase's final build.

**No missing route silently redirects to the homepage.** This matters specifically because the governing brief warns against exactly that anti-pattern ("do not redirect every 404 to the homepage... a real missing route should remain 404") — confirmed this codebase does not do that.
