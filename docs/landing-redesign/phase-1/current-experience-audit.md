> Vercentlabs Landing Redesign — Phase 1, Workstream A
> Status: Findings recorded. This workstream's original scope ("audit every current public route") does not apply as written — see below. Adapted scope executed instead.

## Why this workstream is adapted

At the start of this session, `apps/landing` (the entire marketing site: 78 files, ~10,800 lines — every page, component, content file, and lead-handling module) was found **deleted from disk and staged for deletion in git, uncommitted**. This was flagged to the user before any further work proceeded. The user's explicit decision was: **leave it deleted, build from scratch** — do not restore it, and do not audit a "current" site that doesn't exist.

Consequently, Workstream A's per-route audit table (URL, title, H1, CTA, friction, SEO problems, etc.) is not producible — there are zero live routes to audit. This document instead records: (1) the exact state discovered and why it's safe, (2) what the deletion breaks elsewhere in the monorepo (found via the Frontend Architecture agent's investigation), and (3) the single site-wide classification that replaces the per-route table.

## State discovered (recorded for the record)

- `git status` showed all 78 `apps/landing` files as staged deletions (`D`), working tree empty (`apps/landing/` exists as an empty directory).
- Not committed — the last commit (`cfabc63`, "feature docs") only added a docs file. Fully recoverable at the time of discovery via `git restore --staged --worktree apps/landing`, had the user chosen restoration.
- No branch, stash, or reflog entry explained the deletion. The only superficially related branch, `agent/remove-my-website`, is unrelated (2026-07-17, already merged into `main`, removed a different and already-gone app called "my-website", not `apps/landing`).
- No destructive action was taken by this session before the user's decision was recorded; only read-only git commands were run during investigation.

## Site-wide classification

Per the brief's classification scheme (Keep / Improve / Rebuild / Merge / Redirect / Remove / Prevent indexing): the entire former route set is classified **Rebuild**. There is nothing to keep, improve, merge, or redirect from, because nothing is deployed. No `Prevent indexing` action is needed either — there is no live, indexable site to protect from crawling.

## What the deletion actually breaks (found via code, not assumption)

This is more consequential than "no landing site exists" — several other parts of the monorepo have a hard dependency on `apps/landing` existing, discovered during the Frontend Architecture investigation:

- **Production deployment is currently non-functional.** Repo-root `server.js` — the literal production entry point — does `require("./apps/landing/.next/standalone/apps/landing/server.js")`, with a comment noting Hostinger deploys the monorepo from this file. Until a new `apps/landing` exists with `output: "standalone"` and builds successfully, **the production boot path is broken**, independent of anything the marketing redesign changes about content or design.
- `infrastructure/docker/Dockerfile.landing` and `infrastructure/docker/compose.production.example.yml` both build/run a `landing` service from `apps/landing` — currently non-functional for the same reason.
- Root `package.json` has ten+ scripts (`dev`, `dev:landing`, `build:landing`, `lint:landing`, `typecheck:landing`, `format:landing`, `test:landing`, `test:landing:e2e`, `test:landing:browser`, `validate:production-env:landing`, `release:gate`) that reference `@vercentlabs/landing` — all will fail to resolve until a package with that name exists at `apps/landing`.
- `apps/web/.env.example` documents `CRM_CAPTURE_PROXY_SECRET` as a secret shared with `apps/landing` for signed lead delivery (see `apps/web/src/app/api/crm/public/capture/[key]/route.ts`) — the landing side of that contract doesn't exist to configure.
- `docs/VERCENTLABS_ERP_12_MODULE_FEATURE_REGISTER.md` cites dozens of now-deleted `apps/landing/src/...` files as "evidence" for platform capabilities (ERP-001 through ERP-023 especially) — that register is stale with respect to landing and should not be treated as current.

None of this is fixed in Phase 1 — restoring production requires the actual rebuilt application (Prompt 2 scaffold onward), which is out of this phase's scope by design ("the full homepage was not prematurely redesigned"). It is recorded here as a **known, real production risk** the user and later phases must be aware of, distinct from the marketing-strategy work this phase produces. See `phase-2-brief.md` for how Prompt 2 should sequence the scaffold to restore the production boot path as early as practical.

## Implication for this phase's other workstreams

Because there is no current experience, every other workstream in this phase (positioning, IA, conversion architecture, SEO/AEO/GEO, creative direction, homepage blueprint) is written as a **target architecture**, not a redesign-relative-to-baseline. This is noted at the top of each affected document rather than repeated here.
