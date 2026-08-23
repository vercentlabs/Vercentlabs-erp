# Phase 8 Decision Log

Evidence classifications: MEASURED / REPRODUCED / OBSERVED / INFERRED / HYPOTHESIS, plus launch severity: BLOCKER / HIGH / MEDIUM / LOW / ACCEPTED-RISK.

## 1. REPRODUCED, then FIXED — `infrastructure/docker/Dockerfile.landing` failed to build at all

**Finding:** `docker build -f infrastructure/docker/Dockerfile.landing .` failed deterministically with `ENOENT: no such file or directory, open '/app/patches/brace-expansion@5.0.9.patch'` during `pnpm install --frozen-lockfile`. Root cause: `pnpm-workspace.yaml` declares a real `patchedDependencies` entry (`brace-expansion@5.0.9: patches/brace-expansion@5.0.9.patch`) whose patch file genuinely exists in the repo, but the Dockerfile's pre-install `COPY` stage never copied the `patches/` directory into the build context before running `pnpm install`. A second, related gap: `packages/landing-content/package.json` — a real workspace dependency of `apps/landing` (confirmed via `apps/landing/package.json`'s `"@vercentlabs/landing-content": "workspace:*"`) — was also missing from the same pre-install `COPY` list.
**Decision:** Added `COPY patches ./patches` and `COPY packages/landing-content/package.json packages/landing-content/package.json` to the Dockerfile's build stage, in the same position as the other pre-install package.json copies.
**Verification:** Rebuilt from scratch — full multi-stage build completed successfully (`pnpm build:landing` ran inside the container, producing all 74 routes). Ran the resulting image (`docker run`), confirmed real `200` responses from `/`, `/book-demo`, `/modules/manufacturing`, `/compare/vercentlabs-vs-odoo`, `/sitemap.xml`, `/robots.txt` against the live container on port 3060, then cleaned up the test container/image.
**Severity:** Was BLOCKER (container-based deployment was completely non-functional — no one had ever actually built this image before this phase). Now fixed and verified. This is not a Phase 7 or earlier-phase regression — it's a defect in `infrastructure/docker/Dockerfile.landing` itself that had never been exercised, in the same category as the 5 dead nav/footer links Phase 7 found: a real, load-bearing artifact nobody had actually tried using.
**Note:** `Dockerfile.web`, `Dockerfile.worker`, `Dockerfile.migration` were not audited — out of this phase's `apps/landing`-focused scope, but likely worth the same check given the shared root cause (workspace patch files are a monorepo-wide config, not landing-specific). Flagged for whoever owns those images.

## 2. REPRODUCED — Two compounding WebKit-specific gaps in the skip link, both fixed

**Finding:** Phase 8's new cross-browser smoke suite (`tests/e2e/cross-browser-smoke.spec.ts`) ran the exact skip-link focus check Phase 7 verified working (`phase-7/decision-log.md` item 11) against `desktop-firefox`, `desktop-webkit`, and `mobile-webkit`. It passed on Firefox but **failed on both WebKit projects**. A debug trace (`page.evaluate` reading `document.activeElement` after each step) found two distinct, compounding causes:
1. **WebKit's default keyboard-navigation mode excludes plain `<a>` links from the Tab order entirely** — only form controls and buttons. The debug trace showed the very first `Tab` press in WebKit landed on a header `<button>`, never on the skip link at all (real Safari behavior: "Full Keyboard Access" — which includes links in the Tab order — is off by default; this test environment's WebKit reproduces that same default).
2. Separately, even when focused and activated via a real click, WebKit does not reliably move keyboard focus to a `tabindex="-1"` fragment target the way Chromium/Firefox do (the same class of gap Phase 7 fixed for the `<main>` target itself, but here affecting the *link's own* focusability).
**Decision:** Converted the skip link into a small client component (`components/layout/skip-link.tsx`) with `tabIndex={0}` (forces it into the Tab order regardless of engine defaults) and an explicit `.focus()` call on `#main-content` after click (via `requestAnimationFrame`, running after the browser's own default navigation/scroll) — making both behaviors consistent across all three engines instead of depending on each browser's native handling.
**Verification:** REPRODUCED as fixed via a direct debug trace: `after tab, focused element class: skip-link` (confirms Tab now reaches the link first in WebKit) and `after enter: {"id":"main-content","tag":"MAIN",...}` (confirms focus lands correctly). Full cross-browser smoke suite re-run across all 5 projects (see this phase's Cycle 3 rehearsal) to confirm no regression.
**Severity:** Was a real WCAG 2.4.1 gap specifically for Safari/WebKit users with default keyboard settings (a meaningful share of real traffic, especially mobile) that neither this project's Chromium-only Phase 1-7 testing nor a config lacking WebKit coverage would ever have caught — exactly the kind of defect cross-browser testing exists to find. Item 1 above (links excluded from Tab order) is also a useful general reminder: any other custom-interaction pattern relying on `<a>`-is-Tab-reachable-by-default should be checked the same way before being assumed WebKit-safe.

## 3. OBSERVED — Dead-code/asset check: zero orphaned product screenshots

**Finding:** Cross-referenced every file in `public/product/*.png` (14 files) against `lib/product/screenshots.ts`'s registry (the single place screenshot IDs map to real file paths). Exact 1:1 match — every file is referenced, every reference resolves to a real file. Combined with the already-passing unit test `"every module's referenced screenshot id actually belongs to that module"`, this confirms no orphaned or broken screenshot asset exists.
**Decision:** No cleanup needed. Not an exhaustive full-codebase dead-code sweep (out of proportion for this phase's remaining time budget) — scoped to the highest-risk asset category (product screenshots, the largest binary assets in the repo) per the workstream's own instruction against broad speculative cleanup.

## Cycle 2 — 3 parallel independent reviewers dispatched, findings investigated below

Per the plan: a `frontend-quality-reviewer` (dedicated agent, release-engineering + code-quality pass) plus 2 embedded-persona `general-purpose` reviews (Security, Legal/Trust) — all against the live, working build. Every finding was independently re-verified before any fix landed.

## 4. BLOCKER, REPRODUCED — Privacy Policy's contact/rights mechanism didn't actually work on the live page

**Finding (Cycle 2, legal/trust review):** `/privacy`'s "Your rights" and "Contact us" sections referenced "the email address below" and "the address listed in our company identity documentation" — but `COMPANY_IDENTITY` (defined in `metadata.js` specifically to supply this) was never imported or rendered by `legal.js`. Independently reproduced via a live `curl`+`grep` against the rendered page showing zero email/domain-contact strings anywhere in the actual output. A real visitor had no working way to exercise a data-subject right.
**Decision:** `legal.js` now imports `COMPANY_IDENTITY` and interpolates the real `privacyContactEmail`/`supportContactEmail` directly into both pages' relevant sections.
**Verification:** `typecheck`/`lint` clean; rebuild+reboot confirmed the real addresses now render on the live page (tracked for Cycle 3's full rebuild).
**Severity:** Was BLOCKER — a legal page promising a right with no functioning mechanism to exercise it is worse than not promising it at all. Fixed.

## 5. HIGH, REPRODUCED — `/api/book-demo` rate limiting was trivially bypassable via `X-Forwarded-For` spoofing

**Finding (Cycle 2, security review):** `lib/request.ts`'s `clientIp()` trusted the raw client-supplied `X-Forwarded-For` header unconditionally. Live-reproduced: 6 POSTs each with a distinct spoofed header never tripped the rate limit; 6 unspoofed requests from the same connection did, on attempt 4. This also transitively defeated `apps/web`'s own per-client CRM fingerprint (`SHA-256(clientIp|userAgent)`), since the spoofable IP fed directly into it.
**Decision:** Replaced `clientIp()` with the exact secure-by-default pattern already established in `apps/web/src/core/security.ts` — trust no client-suppliable header unless `TRUSTED_PROXY_IP_HEADER` is explicitly configured (naming a header a known, trusted reverse proxy is guaranteed to set itself). Added the same env var (plus `TRUSTED_PROXY_CLIENT_INDEX`) to `.env.example`, and wired `TRUSTED_PROXY_IP_HEADER=x-forwarded-for` into `playwright.config.ts`'s test-server boot so existing rate-limit tests (which simulate distinct clients via that exact header) continue to work correctly — mirroring exactly how a real trusted-proxy deployment would configure it, not a test-only bypass.
**Reason selected:** Reusing an already-proven pattern from the same monorepo, rather than inventing a new one, for both consistency and correctness.
**Real consequence, disclosed:** until `TRUSTED_PROXY_IP_HEADER` is configured for the actual production topology, the rate limit is effectively global (shared across all visitors) rather than per-visitor — a deliberate, safer default (a too-strict global limit is a fixable usability issue; a spoofable per-IP limit is a security hole). **Flagged as a required pre-launch configuration step**, not silently left as a permanent global limit — see `launch-readiness-scorecard.md`.
**Verification:** `typecheck` clean; full behavioral re-verification tracked as part of Cycle 3's regression pass (the existing `lead-reliability.spec.ts` rate-limit test must still pass with per-test IP isolation working).
**Severity:** Was HIGH — a real, exploitable bypass of the only automated-abuse control on the public lead-capture endpoint. Fixed.

## 6. MEDIUM, MEASURED — Both new GitHub Actions workflows omitted `permissions:`

**Finding (Cycle 2, security review):** Neither `.github/workflows/landing-ci.yml` nor `landing-release-verification.yml` declared a `permissions:` block, inheriting the repo/org default `GITHUB_TOKEN` scope — a standing least-privilege gap, even though no current step in either workflow uses `secrets.*` or performs a write action.
**Decision:** Added `permissions: contents: read` to both workflows.
**Severity:** MEDIUM, preventative — no active exploit exists today, but this closes the gap before any future step could silently inherit broader-than-needed scope.

## 7. MEDIUM, OBSERVED — Two documentation-accuracy corrections (no code change, wording only)

**Finding (Cycle 2, security review):**
1. `security-header-audit.md`'s original draft called `apps/web`'s HMAC replay-window validation "out of scope to re-audit" while still asserting the overall scheme was replay-resistant — an unverified claim stated with unearned confidence. Cycle 2 review independently checked `apps/web`'s actual endpoint and confirmed it genuinely does enforce a 5-minute signature window with `timingSafeEqual` comparison — the underlying claim was correct, but the audit process hadn't actually verified it before asserting it.
2. `structured-data-final-audit.md`'s original CSP section conflated "80/80 tests show zero console errors across 5 browser engines" with "CSP verified" in a way that could be read as claiming XSS-blocking — but `script-src 'self' 'unsafe-inline'` structurally cannot block an injected inline script (that's what `'unsafe-inline'` permits), so a zero-console-error result only proves no *regression* in Next.js's own required inline-script usage, not resistance to script injection.
**Decision:** Both documents corrected — item 1 now cites the actual verified evidence (file, line numbers, the specific constants/functions checked) instead of hand-waving; item 2 now explicitly states what the 80/80 result does and does not prove.
**Severity:** MEDIUM as a documentation-integrity issue (this project's whole evidence-classification discipline depends on not overstating what was actually checked) — zero code-level severity, since neither underlying technical fact was wrong, only how confidently an unverified one was initially stated.

## 8. Cycle 3 final regression result: 658/658 passing, zero failures — the cleanest full run this entire programme has produced

After all Cycle 2 fixes landed (contact-mechanism BLOCKER, rate-limit-bypass HIGH, CI permissions, documentation corrections), a completely clean rebuild (`rm -rf .next && pnpm build`) and a fresh server boot with `TRUSTED_PROXY_IP_HEADER=x-forwarded-for` (matching the real trusted-proxy configuration the rate-limit fix now requires for per-visitor isolation) produced:

- Unit tests: 36/36 (`apps/landing`) + 121/121 (`landing-content`), `typecheck`/`lint` clean.
- Full Playwright suite, all 5 browser/device projects: **658/658 passing, zero failures** — not even the environment-induced flakiness (`networkidle` timeouts under heavy parallel load) that appeared in every prior full-suite run this session. Directly verified the rate-limit security fix behaves correctly end-to-end: unspoofed rapid requests correctly hit the limit (`429` on request 6 of 6); requests with the now-explicitly-trusted `x-forwarded-for` header correctly get per-value bucket isolation (the intended behavior once a real trusted-proxy header is configured), while an *unconfigured* deployment would safely share one global bucket instead of trusting spoofable input.
- Docker: rebuilt from scratch with the security fix included, verified successful (`docker build` exit 0), image cleaned up.

This is the authoritative Cycle 3 result this phase's completion report relies on.
