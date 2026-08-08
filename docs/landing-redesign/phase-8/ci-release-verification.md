# Phase 8 CI Release Verification

## Decision: add a real, focused CI pipeline

A real GitHub remote exists (`https://github.com/vercentlabs/Vercentlabs-erp.git`, confirmed via `git remote -v`), and no `.github/` directory existed before this phase — so adding CI is a legitimate, supportable option here, not an invented credential-requiring integration. No CI credentials were created — GitHub Actions on a public/standard GitHub repository runs with GitHub's own provided runner and token, nothing this phase needed to provision.

## Two workflows, split by cost/frequency (per the governing brief's own guidance)

### `.github/workflows/landing-ci.yml` — required PR check, runs on every relevant push

Path-filtered to `apps/landing/**`, `packages/landing-content/**`, and the lockfile — this monorepo also contains `apps/web`, `apps/mobile`, and `services/api`, each with a much larger and unrelated test surface; this workflow never runs for changes that don't touch landing.

Covers: `pnpm lint:landing`, `pnpm typecheck:landing`, `pnpm test:landing` (36 unit tests), `pnpm --filter @vercentlabs/landing-content test` (121 unit tests), a real production build (`pnpm build:landing`), and a Chromium-only smoke pass (`production-smoke.spec.ts` + `accessibility.spec.ts`) — deterministic, fast (~10-15 minutes), and covers exactly the checks this phase's own final regression pass relies on for correctness (not the full 578+ multi-browser suite).

### `.github/workflows/landing-release-verification.yml` — manual trigger + weekly schedule

The full, expensive suite: all Playwright specs across all 5 browser projects (Chromium/Firefox/WebKit desktop+mobile), plus a real Lighthouse baseline run. Triggered manually (`workflow_dispatch`) before an actual release, and weekly on a schedule (Monday 03:00 UTC) to catch drift between releases — not on every commit, which would be both slow and costly for marginal benefit on a site that doesn't change every day.

## Why axe-core is only in the fast workflow, not deferred to weekly

Accessibility regressions are exactly the kind of defect this project's own `regression-risk-register.md` treats as release-blocking, not a "nice to catch eventually" concern — so `accessibility.spec.ts` runs in the fast, every-PR workflow rather than only in the weekly deep pass, even though it adds a few minutes.

## What this CI does NOT do

- It does not gate merges automatically requiring a human to configure branch protection rules in GitHub's own repository settings — that's a repository-administration action outside what committing a workflow file can do, and outside this phase's authority to configure (would require GitHub admin access this session doesn't have and shouldn't assume).
- It does not deploy anything — no deployment step exists in either workflow. Deployment remains a separate, manual (or future-CD) process.
- It was not actually run against GitHub's real runners this session (this repo is local-only, 43+ commits ahead of `origin/main`, nothing pushed — see the Git strategy section of the final report). The workflow YAML syntax and command references were verified by hand against this repo's real `package.json` scripts (every command referenced — `lint:landing`, `typecheck:landing`, `test:landing`, `build:landing` — is a real, already-existing, already-tested script), not invented.

## Absence explicitly accepted, not silently assumed

Per the workstream's own instruction ("Add CI only if repository/project conventions support it... or the absence is explicitly accepted"): CI is added because the conventions genuinely support it (a real GitHub remote, an established `package.json` script naming convention this workflow reuses verbatim). If Vercentlabs' actual deployment process doesn't use GitHub Actions (e.g., relies entirely on the Hostinger/Docker path documented in `deployment-rehearsal.md`), these workflow files remain valid, low-risk, opt-in quality gates — they can be deleted or left dormant without affecting the deployment path itself.
