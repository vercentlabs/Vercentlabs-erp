# Production Deployment — Resolved Architecture

## The defect (found in Phase 1, repaired in Phase 2)

Repo-root `server.js` is the production entry point Hostinger boots the monorepo from:

```js
// server.js
require("./apps/landing/.next/standalone/apps/landing/server.js");
```

With `apps/landing` deleted, this `require` failed — production deployment was non-functional independent of any marketing content or design work. This phase's zero-th priority was restoring it.

## How it's resolved

1. **`apps/landing/next.config.mjs` sets `output: "standalone"`.** Next.js's file-tracing, given the monorepo's `pnpm-workspace.yaml` at the repo root (auto-detected as the tracing root), emits the standalone server at `apps/landing/.next/standalone/apps/landing/server.js` — the exact nested path `server.js` expects. **Verified directly**: after `pnpm build:landing`, `ls apps/landing/.next/standalone/apps/landing/server.js` confirmed the file exists at that exact path.
2. **Standalone output does not include static assets or `public/`** (Next.js only traces what `server.js` needs to boot, not build-time-generated static files or the public folder). `apps/landing/scripts/prepare-standalone.mjs` copies `.next/static` → `.next/standalone/apps/landing/.next/static` and `public/` → `.next/standalone/apps/landing/public`, mirroring exactly what `infrastructure/docker/Dockerfile.landing` already does in its `COPY` steps — this script lets the same preparation happen outside Docker (local validation, CI) without duplicating logic.
3. **End-to-end verification performed**: built the app, ran `prepare-standalone.mjs`, then booted the actual repo-root `server.js` (`PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production node server.js`) — not `next start`, the real production entry point — and confirmed via `curl`:

| Check | Result |
|---|---|
| `GET /` | `200`, correct security headers present |
| `GET /design-system` | `200`, `X-Robots-Tag: noindex, nofollow` present |
| `GET /robots.txt` | `200`, correct `Disallow: /design-system` |
| `GET /sitemap.xml` | `200`, valid XML |
| `GET /manifest.webmanifest` | `200` |
| `GET /icon.svg` | `200` |
| `GET /_next/static/chunks/*.js` | `200` (static assets served correctly) |
| `GET /this-does-not-exist` | `404` (real 404 page, not a crash) |

This was re-run after every fix during this phase (4 full rebuild-and-reboot cycles) — the final state is a genuinely working, tested production boot path, not an assumption.

## Environment configuration

`apps/landing/.env.example` documents `NEXT_PUBLIC_SITE_URL` (canonical/sitemap/OG base URL) and `NEXT_PUBLIC_APP_URL` (apps/web's URL, used for the header/footer "Sign in" link — different origin, so Next's `Link` prefetching correctly skips it). `CRM_CAPTURE_PROXY_SECRET` is documented but not yet read by any code — reserved for Phase 3's lead-capture form.

## Security headers

`next.config.mjs` sets a CSP adapted from `apps/web`'s proven-working policy: `default-src 'self'`, no third-party origins (this app needs none — no payment checkout, unlike `apps/web`), plus COOP/CORP/Referrer-Policy/X-Content-Type-Options/X-Frame-Options/Permissions-Policy, and HSTS in production. **`'unsafe-inline'` is required in `script-src` in every environment** — Next.js emits its own inline bootstrap/hydration `<script>` tags on every page; omitting it (this phase's first attempt) breaks the app in production. A stricter nonce-based CSP would need middleware to mint a per-request nonce, which is out of scope for this phase — flagged for `phase-3-brief.md`.

## Docker / compose

`infrastructure/docker/Dockerfile.landing` and `infrastructure/docker/compose.production.example.yml` were inspected and require no changes — their `COPY`/`CMD` steps already match the standalone output shape `apps/landing` now actually produces. Not rebuilt/re-tested via Docker itself this phase (no Docker runtime available in this environment) — the equivalent copy-and-boot sequence was validated directly via `prepare-standalone.mjs` + `node server.js` instead, which exercises the identical file layout the Docker image would produce.

## Root script integration

Added `start:landing` (was missing) alongside the existing `dev:landing`/`build:landing`/`lint:landing`/`typecheck:landing`/`format:landing`/`test:landing`/`test:landing:e2e`/`test:landing:browser` scripts, all of which now resolve correctly since `@vercentlabs/landing` exists. `apps/landing/package.json` additionally exposes `prepare:standalone` and `start:standalone` (build-independent local production-boot commands) for future CI/validation use.
