# Phase 8 Brief — Final Repo Audit, Launch Readiness, and Release

Phase 8 is the final hardening/release phase for the landing-site redesign programme. **It should not become another redesign phase** — no new pages, no visual overhaul, no content batch, unless something found during Phase 8's own audit work turns out to be release-blocking. Its job is to take the site from "feature-complete and measured" (where Phase 7 leaves it) to "ready to actually deploy."

## Repository

- **Final git audit:** confirm the full commit history from Phases 1-7 is coherent, no stray WIP commits, no accidentally-committed secrets or generated artifacts (`.next/`, `test-results/`, `.lighthouse-reports/` should all remain gitignored — verify they still are after Phase 7's additions).
- **Dependency audit:** `pnpm audit` across the workspace; review whether `lighthouse`/`chrome-launcher` (added as devDependencies in Phase 7 for the baseline script) have any known vulnerabilities, and confirm they're devDependencies only (not shipped in the production bundle — verify via the standalone build output).
- **Secret scan:** confirm `.env.local` is gitignored and was never committed; confirm no HMAC key, capture secret, or API key appears anywhere in committed source or docs.
- **Stale files / dead code:** Phase 7's `regression-risk-register.md` and various decision logs reference a few small things worth a final look — e.g., confirm no leftover ad hoc test files from Phase 7's investigation work were accidentally committed (`_adhoc-*.spec.ts` pattern — both were deleted before commit, verify via `git log`/`git status`).
- **Generated artifacts:** confirm `.lighthouse-reports/` (new gitignore entry from Phase 7) is actually excluded, and that no raw Lighthouse JSON report or Playwright trace/video was accidentally staged.

## Landing ↔ ERP product alignment

- Re-verify every product screenshot in `apps/landing/public/product/` still matches the current state of `apps/web`'s real UI (screenshots were captured at some point in an earlier phase — confirm they haven't drifted from what the actual product now looks like, per `product-intelligence.md`'s "verify against real code" standing rule).
- Re-verify the "1,039 implemented capabilities" / "12 modules" / "945 module + 94 platform" figures still match `packages/landing-content`'s capability registry (a unit test already enforces internal consistency — confirm no phase since then changed the underlying count without updating the landing copy).
- Confirm every internal link from a landing page to the real `apps/web` application (if any exist) resolves correctly once both apps are actually deployed together.

## Production configuration

- **Environment validation:** `NEXT_PUBLIC_SITE_URL` must be set to the real production domain (`https://www.vercentlabs.com` per `.env.example`) before the first production build — Phase 7 found this defaults to `localhost:3000` when unset, which is correct local behavior but would be a real bug if forgotten in the actual deployment config.
- **CSP:** re-verify after Phase 8's own changes (if any) using the same method Phase 7 established — `production-smoke.spec.ts`'s now-11-route console-error check. Do not loosen the CSP to silence an error; find the specific origin/script requirement instead (Phase 7's own explicit rule).
- **CORS/origin, trusted-forwarding headers:** verify `lib/request.ts`'s `clientIp()` logic (used by the rate limiter) correctly handles the real production reverse-proxy setup (if one exists) — an incorrect trusted-header assumption could let a client spoof their rate-limit bucket.
- **Rate limits:** `lib/rate-limit.ts` is explicitly documented as in-memory/single-process — confirm this is acceptable for the real production deployment topology (a multi-instance deployment would need a shared store, e.g. Redis, or the limiter provides no real protection across instances). This is a real, unresolved architectural question Phase 7 didn't need to answer but Phase 8 should.
- **`playwright.config.ts`'s `reuseExistingServer` gap** (found and worked around, not fixed, in Phase 7 — see `decision-log.md` item 8): add a real verification step (e.g., asserting on a response header only the production build sets) before trusting a reused server in CI or local runs.

## SEO launch

- Real Search Console/Bing Webmaster Tools account setup, domain verification, sitemap submission — see `search-console-readiness.md` for the exact procedure once real access exists.
- Confirm `robots.ts`/`sitemap.ts` output the real production domain once `NEXT_PUBLIC_SITE_URL` is set correctly (currently shows `localhost:3000` in this local build — expected, not a bug, but must be re-verified against a real production build before launch).
- Open Graph / favicon / web manifest: spot-check `opengraph-image.tsx`'s output renders correctly once real fonts/colors are confirmed in a production context (uses the real `COLOR_TOKENS.mutedInk` post-Phase-7-fix — verify visually one more time).

## Conversion

- Real CRM delivery: this session's environment never had `apps/web` running, so every CRM delivery attempt during Phase 7 testing resulted in a real connection-refused 500 (correct behavior for this environment — see `decision-log.md` item 2). Phase 8 (or actual deployment) needs a real end-to-end test with `apps/web` actually running to confirm the HMAC-signed capture flow works against a live target, not just that it fails gracefully when the target is absent.
- Analytics/Web Vitals: still have zero real backend consumer (`window.__vercentlabsAnalyticsSink` is unattached) — Phase 8 should make the actual provider decision (or explicitly decide to launch without one and revisit post-launch) rather than leaving it open-ended indefinitely.
- Lead observability: structured logs exist but go nowhere (stdout/stderr only) — Phase 8 should decide on a real log destination appropriate to the actual hosting platform.

## Legal/trust

- Confirm privacy policy, terms, and cookie-notice pages (if planned) exist and are linked from the footer — not audited this phase, out of Phase 7's scope.
- Confirm company identity/contact information on `/security` and the footer is accurate and current.
- Re-confirm no claim anywhere in the site (copy, testimonials, stats) violates `landing-content.md` rule #1 — this has been enforced continuously since Phase 1 via `content-integrity.test.mjs`'s fabricated-statistic-pattern scan; Phase 8 should do one final manual skim of the highest-visibility pages (homepage, comparison page) as a human sanity check on top of the automated guard.

## QA

- **Complete route inventory:** re-run the full route smoke suite (`module-routes.spec.ts`, `phase5-routes.spec.ts`, `phase6-routes.spec.ts`, plus Phase 7's additions) against a real staging deployment, not just localhost.
- **Dead-link crawl:** a full internal-link crawl across all ~74 routes hasn't been done as a single automated pass this phase (Phase 6's `internal-link-architect` agent covers structural link-graph review, not a live HTTP-status crawl) — worth adding as a Phase 8 script.
- **Cross-browser:** this entire program (Phases 1-7) has only ever been tested against Chromium (via Playwright's `chromium` engine, both desktop and mobile-emulated projects). **Zero testing has occurred on Firefox, Safari/WebKit, or a real mobile device.** This is a real, disclosed gap — Phase 8 should add at minimum a WebKit Playwright project and run the core conversion-path tests against it before launch, given Safari's meaningful market share and its historically different CSS/JS engine behavior.
- **Accessibility/performance/security headers:** re-run Phase 7's full measurement suite one more time against the actual staging/production deployment (not localhost) as a final pre-launch check — lab numbers can differ meaningfully once real network latency, a real CDN, and real TLS termination are in the path.

## Deployment

- Confirm the Docker/deployment compatibility Phase 2's `production-deployment.md` documented still holds — re-verify `output: "standalone"` + `prepare-standalone.mjs` + the repo-root `server.js` boot sequence against whatever the actual hosting platform is (the docs reference a Hostinger deployment path — confirm this is still the real target).
- Staging validation: deploy to a real staging environment (not just localhost) and re-run the production smoke suite there.
- Health check endpoint: confirm one exists (or add one) for the hosting platform's own uptime monitoring.
- Rollback procedure: document how to revert to the previous deployed version if Phase 8's release introduces a regression — not currently documented anywhere in this repo.

## Git/release

- This phase (Phase 7) ends with a clean, local-only commit history, NOT pushed to `origin/main` — see the completion report for the exact commit list and count-ahead-of-origin.
- Phase 8 should decide the actual push/PR/release plan: direct push to `main`, or a PR-based review flow — this hasn't been decided anywhere in the existing docs and is a real open decision for whoever runs Phase 8.
- No git tag/version scheme currently exists for this repo — Phase 8 should decide whether to introduce one for release tracking.

## Post-launch monitoring plan (to prepare, not execute, since the site isn't live yet)

- **First 24 hours:** watch for 5xx spikes (once server-error logging exists — a Phase 8 candidate per `observability-plan.md`'s gap list), watch real CRM lead delivery for the first real submissions, confirm Search Console domain verification succeeds.
- **First 7 days:** first real Web Vitals field data should start appearing in the RUM pipeline once real traffic accumulates (assuming a provider was wired per the "Conversion" section above) — compare against this phase's lab baseline (`baseline-measurements.md`) as a first field-vs-lab sanity check.
- **First 30 days:** first meaningful Search Console coverage/indexing data; first CRO signal (real `demo_form_start`→`demo_form_success` completion rate) if analytics went live — compare against nothing (no historical baseline exists) but start tracking as the actual baseline going forward.

## What Phase 8 should explicitly NOT do

Per this brief's own opening instruction and consistent with Phase 7's scope discipline: no new page templates, no visual redesign, no new content batch, no premature A/B experiment (`experiment-framework.md`'s own conclusion still holds until real traffic exists). Phase 8's job is repository/production/release hardening, not further product-copy work.
