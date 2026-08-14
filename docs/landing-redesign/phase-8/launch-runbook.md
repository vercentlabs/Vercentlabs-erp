# Phase 8 Launch Runbook

Every step below reuses this repository's own real commands (`package.json` scripts, actual file paths) — nothing here is an invented deployment-specific command. Where a step depends on infrastructure this session couldn't access (real Hostinger deploy trigger, real DNS/CDN config), that's stated plainly rather than guessed.

## T-24 hours

- [ ] Run the full release-verification suite (`pnpm build:landing`, full Playwright including cross-browser, axe, Lighthouse — or trigger `.github/workflows/landing-release-verification.yml` manually) against the exact commit intended for release.
- [ ] Confirm legal review status of `/privacy` and `/terms` — see `legal-readiness.md`'s open-items table (registered address, LLPIN, governing-law venue, and limitation-of-liability wording). Workspace contact mailboxes were confirmed on 2026-08-14.
- [ ] Confirm production environment variables are set correctly — **specifically `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL`**, the one real "silently falls back to localhost" risk identified in `environment-contract.md`.
- [ ] Confirm the production canonical domain resolves and DNS is configured (out of this session's ability to verify directly — flagged, not assumed).
- [ ] Confirm `CRM_CAPTURE_FORM_KEY`/`CRM_CAPTURE_PROXY_SECRET` are set to real production values matching `apps/web`'s configuration for the correct receiving organization.
- [ ] Re-run the demo-lead rehearsal (`conversion-launch-validation.md`'s method) against a real, live `apps/web` instance — this session's own rehearsal could only reach the "upstream unavailable" branch, since no live `apps/web` was available; a real pre-launch rehearsal must confirm an actual lead record is created and then cleaned up.

## T-1 hour

- [ ] Final build from the exact release-candidate commit SHA (recorded in `final-release-report.md`).
- [ ] Confirm the rollback reference (the last known-good commit SHA, per `rollback-plan.md`) is documented and accessible to whoever is on call.
- [ ] Deploy via the real, established mechanism (Hostinger's own deploy trigger, or the Docker path if that's what's actually used — see `deployment-rehearsal.md`).
- [ ] Confirm the deployed process is actually running and serving (a real `200` from `/`).

## T+5 minutes

- [ ] Homepage loads (`200`, hero renders, no console errors).
- [ ] `/book-demo` loads and the form renders.
- [ ] Submit one real synthetic test lead (clearly marked as a test — e.g., an email domain like `+launch-test@` or a name containing "TEST") and confirm it's actually delivered to the CRM this time (unlike this session's rehearsal, which could only confirm the failure path).
- [ ] Static assets (screenshots, fonts fallback, CSS) load correctly — no broken images, no unstyled content flash.
- [ ] Canonical URL on the homepage reads the real production domain, not `localhost`.
- [ ] `/robots.txt` and `/sitemap.xml` both return real content pointing at the real production domain.
- [ ] Spot-check structured data on the homepage (a real Rich Results Test or manual JSON-LD inspection) reflects the real domain in its `url`/`@id` fields.

## T+1 hour

- [ ] Check for any unexpected 5xx in whatever log surface is actually available (see `analytics-rum-readiness.md`'s note that general error monitoring beyond the lead-delivery path is a real, disclosed gap — watch logs manually if no dedicated sink exists yet).
- [ ] Confirm any real leads submitted so far were delivered correctly (check the CRM directly).
- [ ] If an analytics/RUM provider was wired for launch, confirm events are actually arriving.
- [ ] Spot-check a handful of the 69 crawled routes from `final-route-inventory.md` against the real production domain (not just localhost, which is all this session could verify).

## T+24 hours

- [ ] Submit the sitemap to Google Search Console (see `search-console-readiness.md` from Phase 7 for the exact procedure) if not already done.
- [ ] Check for any indexing errors or crawl anomalies once Search Console has had time to process.
- [ ] Review CRM lead volume/quality for the first day — no baseline exists to compare against (this is day one), but this establishes the actual starting point future phases can measure against.
- [ ] Review any error signal that did surface, and triage.

## Who does this

This runbook does not assign a specific on-call owner — that's an organizational decision for Vercentlabs to make, not something this phase can determine from repository content alone.
