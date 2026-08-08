# Phase 8 Deployment Rehearsal

## Two real deployment paths exist in this repository

1. **Direct Node process (Hostinger)** — `server.js` at the repo root, whose own comment states: "Hostinger deploys this monorepo from its root. The landing production server is emitted by Next.js inside the standalone workspace output during build." This is a single-line `require()` of the real standalone server. **Rehearsed and passing this phase** (and repeatedly throughout Phase 7): `pnpm build:landing` → `node .next/standalone/apps/landing/server.js` (equivalently, `node server.js` from the repo root, which requires the same file) → real HTTP 200s across every representative route.
2. **Docker container** (`infrastructure/docker/Dockerfile.landing`) — a real multi-stage build producing a minimal `node:24-alpine` runtime image. **Found broken, fixed, and rehearsed this phase** (`decision-log.md` item 1): the image previously failed to build at all (`ENOENT` on a required `patches/` file never copied into the build context). Fixed, then verified end-to-end: real `docker build` → real `docker run` → real `200` responses from `/`, `/book-demo`, `/modules/manufacturing`, `/compare/vercentlabs-vs-odoo`, `/sitemap.xml`, `/robots.txt` against the live container — then cleaned up.

Kubernetes manifests and Terraform configuration also exist under `infrastructure/` — **not rehearsed this phase** (no Kubernetes cluster or cloud credentials available in this sandbox; out of scope for a local rehearsal). These presumably consume the same Docker image now confirmed to build correctly, but the actual K8s deployment/Terraform apply was not exercised.

## What a real rehearsal confirmed, with evidence

- **Build:** `pnpm build:landing` completes successfully, producing all 74 real routes (confirmed via the build's own route-listing output, re-run multiple times this phase after each source change).
- **Standalone preparation:** `scripts/prepare-standalone.mjs` correctly copies `.next/static` and `public/` into the standalone output — verified because every server boot this phase served real CSS/JS/images correctly (a missing static-asset copy would have produced visibly broken, unstyled pages, which never occurred).
- **Root server entrypoint:** `node server.js` (equivalently, `node .next/standalone/apps/landing/server.js`, which it requires) correctly boots and serves the real production build — rehearsed dozens of times this session across Phases 7 and 8.
- **Docker:** fixed and rehearsed this phase, see above.

## Staging

**No real staging environment exists or was made available this session** — `STAGING NOT AVAILABLE`, stated plainly per the workstream's own instruction, not silently assumed. What this phase substituted: the actual production build/container run locally (port 3050 for the direct-Node path, port 3060 for the Docker rehearsal), which is the closest available approximation to a real staging deploy without one being provisioned.

## Health check

No dedicated `/health` or `/api/health` route exists in `apps/landing`. The workstream's own guidance applies directly here: "If the landing does not need a dedicated health route because the deployment checks the root server, document that." A real, minimal health signal already exists implicitly — any `200` response from `/` (or any real page) confirms the Next.js server process is alive and correctly serving, which is what this phase's own repeated smoke-testing relied on throughout. No meaningless `200 OK`-only health endpoint was added, per the workstream's explicit instruction against one that "cannot detect startup dependencies" — since `apps/landing` has no external dependency (no database, no required upstream service to be *available* for the app to boot; the CRM capture endpoint is only contacted per-request, not at startup), a full-page `200` is already a meaningful signal for this specific app's actual dependency graph.

## What remains unrehearsed (real, disclosed gaps)

- Kubernetes/Terraform deployment path.
- A true staging environment.
- The actual Hostinger deployment mechanism's specific trigger (git push, webhook, manual deploy button) — not documented anywhere in this repository, and not something this session could rehearse without real Hostinger access.
