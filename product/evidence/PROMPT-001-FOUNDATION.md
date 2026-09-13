# Prompt 1 Evidence: Engineering and Shared-Platform Foundation

## Summary

Built the engineering foundation for Vercentlabs ERP V2 on a new orphan
branch (`erp-v2/foundation`), separate from the repository's existing `main`
history (see "Repository state before this prompt" below). No business
modules and no shared-platform capability implementation were built. The
foundation is a pnpm/Turborepo modular monolith: `apps/web` (Next.js App
Router), `apps/api` (NestJS on Fastify, versioned `/api/v1`), `apps/worker`
(plain Node.js, BullMQ/Redis), 12 shared packages, 15 shared-platform
capability-boundary packages under `platform/`, a validated 36-capability
product register, reviewed SQL migrations (schema bootstrap only), Docker
Compose for local PostgreSQL 18 / Redis, architecture-enforcement tests, and
CI.

## Repository state before this prompt

The prompt's own instructions require inspecting repository state before
acting and stopping if it looks unclear. Before any work began:

- The working tree was fully wiped (0 files besides `.git`), with 2,892
  files shown as unstaged deletions relative to `HEAD` on `main` - an
  uncommitted, unexplained state.
- `main` (tracking `origin/main` on `github.com/vercentlabs/Vercentlabs-erp`)
  contained a large, unrelated prior CRM/landing/ERP codebase and history
  (hundreds of commits, dozens of `backup/*`/`safety/*` branches).

This was flagged to the user before any changes were made. Per the user's
explicit choice, the working tree was left wiped and a fresh orphan branch,
`erp-v2/foundation`, was created for this prompt's work - `main` and all
existing branches/history remain untouched and fully recoverable.

## Files created

305 files (verified via `git add -A --dry-run` immediately before writing
this document; see "Final git status" below for the exact command). Nothing
under `node_modules/`, `dist/`, `.next/`, `.turbo/`, or any `.env` file is
included - confirmed by inspecting `git status --ignored=matching` and by
grepping every one of the 305 candidate files for AWS-key, PEM-private-key
and `sk-`-style secret patterns (no matches).

Top-level structure created: `apps/{web,api,worker}`, `packages/*` (12),
`platform/*` (15), `product/{registers,requirements,acceptance,evidence}`,
`database/{migrations/{platform,tenant},seeds,fixtures}`,
`tests/{architecture,contracts,integration,security,performance,journeys}`,
`docs/{architecture,decisions,operations,security}`, `infrastructure/`,
`scripts/`, `.github/workflows/ci.yml`, plus root config
(`CLAUDE.md`, `README.md`, `package.json`, `pnpm-workspace.yaml`,
`turbo.json`, `.gitignore`, `.env.example`, etc.).

## Architecture decisions

- [ADR-0001: Modular monolith, not microservices](../../docs/decisions/ADR-0001-modular-monolith.md)
- [ADR-0002: REST + OpenAPI contracts, versioned at `/api/v1`](../../docs/decisions/ADR-0002-rest-openapi-contracts.md)
- [ADR-0003: One PostgreSQL deployment, RLS for tenant isolation](../../docs/decisions/ADR-0003-postgresql-tenancy-and-rls.md)
- [ADR-0004: Registers and documentation cannot self-certify implementation status](../../docs/decisions/ADR-0004-evidence-based-feature-status.md)

## Commands executed (in order, all against real tools/services)

```
pnpm install                                     # dependency install, twice (once after adding @fastify/static)
pnpm run format / format:check                   # prettier
pnpm run lint                                    # eslint, all 28 packages
pnpm run typecheck                                # tsc --noEmit, all 28 packages
pnpm run test                                     # vitest, all packages + tests/contracts + tests/security
pnpm run test:architecture                        # vitest, tests/architecture
pnpm run register:validate                        # tsx scripts/validate-register.ts
pnpm run build                                    # turbo run build, all 28 packages incl. next build
docker compose -f infrastructure/docker-compose.yml up -d   # PostgreSQL 18 + Redis 7
pnpm run db:migrate                               # against the real dev database
pnpm run test:integration                         # turbo test:integration + tests/integration, against real Postgres/Redis
node apps/api/dist/main.js                        # started the real compiled API
node apps/worker/dist/main.js                     # started the real compiled worker
pnpm --filter @vercentlabs/web start (built)      # started the real compiled web app
curl against /api/v1/health/live, /api/v1/health/ready, /api/v1/docs-json,
     worker's /health/live, /health/ready, and web's / and /nonexistent-route
git status / git add -A --dry-run / secret-pattern grep over all 305 files
```

Also ran the full pipeline twice more from a **completely clean build
state** (`rm -rf` every `dist/`, `.next/`, `.tsbuildinfo`, and `.turbo/`)
to prove the pass/fail totals below don't depend on leftover local state -
see "Defects found and fixed during verification" for what that surfaced.

## Exact pass/fail totals

All numbers below are from the final clean-state run.

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm run format:check` | Pass (0 files need formatting) |
| `pnpm run lint` | Pass - 28/28 packages, 0 errors, 0 warnings |
| `pnpm run typecheck` | Pass - 28/28 packages, 0 errors |
| `pnpm run test` (unit) | Pass - **83 tests across 34 files**, 0 failed |
| `pnpm run test:architecture` | Pass - **20 tests across 4 files**, 0 failed |
| `pnpm run register:validate` | Pass - 36/36 capabilities valid |
| `pnpm run build` | Pass - 28/28 packages/apps built |
| `pnpm verify` (all of the above, orchestrated) | **8/8 steps passed, 0 failed** |
| `pnpm run test:integration` (real PostgreSQL + Redis) | Pass - **5 tests across 3 files**, 0 failed |

Unit-test breakdown (34 files, 83 tests): 15 platform-module boundary tests
(1 each), `contracts` (14), `configuration` (8), `observability` (6),
`api-client` (3), `auth` (3), `database` (3), `design-tokens` (3), `api`
(5), `worker` (4), `web` (3, across 2 files), `permissions` (2), `testing`
(2), `ui` (1), `tests/security` (8, across 4 files), `tests/contracts` (3).

Architecture-test breakdown (4 files, 20 tests):
`register-integrity.test.ts` (11 - including 7 tests that feed deliberately
invalid registers to prove the validator actually rejects duplicate IDs,
missing IDs, unexpected IDs, invalid statuses, missing titles, missing
evidence, and unknown dependency references),
`no-frontend-database-imports.test.ts` (3), `platform-boundaries.test.ts`
(4), `contracts-framework-free.test.ts` (2).

Integration-test breakdown (3 files, 5 tests):
`apps/api/test/health.integration.test.ts` (1, readiness reports `ok` with
real Postgres+Redis), `apps/worker/test/heartbeat-queue.integration.test.ts`
(1, a real BullMQ job round-trips through real Redis),
`tests/integration/platform-tenant-migrations.test.ts` (3, platform/tenant
schemas and bookkeeping tables exist, and no business tables were created).

`pnpm test:e2e` (Playwright) was **not run** - see "Deferred / not run" below.

## Services actually started

- **PostgreSQL 18** (`postgres:18-alpine`) via Docker Compose, healthy,
  reachable at `localhost:5442` (see "Environment deviations" for why not
  5432) with both `vercentlabs_erp` and (init-script-created)
  `vercentlabs_erp_test` databases present.
- **Redis 7** (`redis:7-alpine`) via Docker Compose, healthy, reachable at
  `localhost:6379`.
- **`apps/api`**, real compiled build (`node apps/api/dist/main.js`),
  listening on `:3001`. Verified live:
  - `GET /api/v1/health/live` → `200 {"status":"ok"}`
  - `GET /api/v1/health/ready` → `200 {"status":"ok","checks":{"postgres":true,"redis":true}}`
  - `GET /api/v1/docs-json` → a valid OpenAPI 3.0 document listing both health routes
- **`apps/worker`**, real compiled build (`node apps/worker/dist/main.js`),
  health server on `:3002`. Verified live:
  - `GET /health/live` → `200 {"status":"ok"}`
  - `GET /health/ready` → after waiting for its 30s repeat interval,
    `200 {"status":"ok","checks":{"postgres":true,"redis":true,"heartbeatWorker":true},"lastHeartbeatAt":"2026-09-13T04:51:30.086Z"}` -
    a real BullMQ job was enqueued, processed, and its timestamp reflected.
- **`apps/web`**, real production build (`next build` + `next start`) on
  `:3000`. Verified live: `/` renders the heading, skip link, and (after a
  bug fix - see below) a live, per-request `apps/api liveness: ok` check;
  `/nonexistent-route` returns HTTP 404 with the not-found page.

All three processes were stopped cleanly after verification
(`taskkill` on their listening ports). PostgreSQL/Redis containers were left
running for continued local development; stop with `pnpm infra:down`.

## Migrations actually executed

`pnpm run db:migrate` against the real dev database
(`vercentlabs_erp`): applied `0000_bootstrap_platform_schema.sql` and
`0000_bootstrap_tenant_schema.sql`, confirmed idempotent on re-run
(`applied=0 skipped=1` for both on the second run). The same two migrations
were also applied to `vercentlabs_erp_test` via
`tests/integration`'s use of `@vercentlabs/database/testing`. In both
databases, `information_schema.tables` for the `platform`/`tenant` schemas
contains only the `_migrations` bookkeeping table - confirmed by
`tests/integration/platform-tenant-migrations.test.ts` - i.e. no
business-module tables exist.

## Defects found and fixed during verification

Running the pipeline for real (not just writing code that looked correct)
surfaced six genuine bugs, all fixed:

1. **Postgres 18 volume layout.** The image now expects a single mount at
   `/var/lib/postgresql` (not `.../data`); the old mount point crash-looped
   the container. Fixed in `infrastructure/docker-compose.yml`.
2. **`pino`/`ioredis`/`pg` default-import interop.** `import x from 'pkg'`
   type-checked but threw or silently mis-bound at real Node ESM runtime for
   these three CommonJS packages. Fixed by using each package's actual
   working import shape (`import { pino } from 'pino'`, `import { Redis }
   from 'ioredis'`, `import pg from 'pg'; const { Pool } = pg;`) - see
   comments at each call site.
3. **NestJS DI silently broken under esbuild-based tooling (tsx/vitest).**
   `HealthController`'s implicit constructor injection of `HealthService`
   resolved to `undefined` under `tsx`/`vitest` (though it worked under a
   real `tsc` build) because those tools don't reliably emit
   `design:paramtypes` metadata for every case. Root-caused by comparing
   real-`tsc` `dist/` output against the failure, then fixed with an
   explicit `@Inject(HealthService)` token, which doesn't depend on that
   metadata at all. `apps/api`'s `@Res()`-based readiness endpoint hit the
   same metadata gap in `@nestjs/swagger`'s document generator; refactored
   to avoid `@Res()` entirely (a `RawResponseException` the global filter
   passes through unchanged) rather than special-casing the dev tool.
4. **`next build` couldn't resolve workspace packages.** Workspace packages
   use explicit `.js`-suffixed relative imports (required by Node's
   `NodeNext` resolution), which webpack's default resolver doesn't map back
   to `.ts` source. Fixed via `resolve.extensionAlias` in
   `apps/web/next.config.ts`.
5. **Workspace packages pointed `package.json` `main`/`exports` at
   `.ts` source.** That resolves fine for `tsc`/`vitest`/webpack, but a
   real `node dist/main.js` production run of `apps/api`/`apps/worker`
   cannot load `.ts` files at all. Fixed by pointing every package's
   `main`/`types`/`exports` at its compiled `dist/` output, which in turn
   required `turbo.json`'s `typecheck` task to depend on `^build` (not
   `^typecheck`) since cross-package type resolution now needs the
   dependency's `.d.ts` to physically exist. Verified by clearing all
   `dist/`/`.next/`/`.turbo` state and re-running the entire pipeline from
   scratch twice.
6. **The foundation page was statically prerendered.** Next.js froze the
   apps/api liveness check as a build-time snapshot (captured before the
   API was running), so it always showed "unreachable" regardless of real
   API state. Fixed with `export const dynamic = 'force-dynamic'` - this
   page's entire purpose is a live check, so static prerendering was wrong
   for it specifically.

Two additional test-suite issues were caught and fixed (not application
bugs, but the tests were wrong): a redaction test used a container key
literally named `tokens`, which is itself flagged as sensitive and redacted
whole - the test was rewritten to use a non-sensitive container key so it
actually exercises array recursion, plus a new test that documents the
whole-key-redaction behavior explicitly. Also, `turbo.json`'s
`test:integration` task and root `test:integration`/`test:contracts`/
`test:security`/`test:architecture` scripts didn't pass through
`DATABASE_URL`/`REDIS_URL`/etc. or guarantee dependency packages were built
first; both were fixed (`passThroughEnv`, explicit `turbo run build &&`
prefixes).

## Environment deviations (disclosed, not hidden)

- **Node.js version**: the mandated architecture pins Node.js 24 LTS
  (`.nvmrc`/`.node-version` = `24.9.0`, `engines.node` =
  `>=24.0.0 <25.0.0`). This sandboxed environment has Node **v26.5.0**
  installed and no v24 binary available; all commands above actually ran
  under v26.5.0. `engine-strict` was deliberately left off so installs
  aren't blocked by this; pnpm prints a non-fatal `Unsupported engine`
  warning on every command as a result. This should be re-verified under
  real Node 24 LTS before relying on it in CI/production.
- **PostgreSQL port**: `infrastructure/docker-compose.yml`'s documented
  default is `5432`. This host already had an unrelated container
  (`resumeiq-postgres`, a different project) bound to `5432`, so this
  verification session started this project's Postgres on `5442` via
  `POSTGRES_PORT=5442 docker compose ... up -d` instead. The committed
  default remains `5432`; nothing in the repository was changed to
  permanently use `5442`.
- **Docker Desktop** was not running at the start of this session and was
  started for this verification (`Docker Desktop.exe`, confirmed ready via
  `docker info` ~10s later). Flagging this since starting a background
  service wasn't explicitly pre-authorized, though it was necessary to
  fulfil the prompt's own verification requirements (start PostgreSQL/Redis,
  run real migrations and integration tests).

## Unresolved failures

None. Every command listed above passed on the final run.

## Security considerations

See [docs/security/security-baseline.md](../../docs/security/security-baseline.md)
for the full list of what's implemented (typed error envelope with no
stack-trace leakage, automatic log redaction proven by tests, no raw
`console.log` outside redacting logger, CORS origin-restricted not
wildcarded, fail-fast env validation, no committed secrets, safe
test-database guard) and explicitly deferred (all of auth/authz/tenant
isolation, since SP001, SP004-SP009 remain `NOT_STARTED`).

## Deferred work (explicitly, not silently)

- **All 36 shared-platform capabilities** (SP001-SP036): specification
  only, no implementation - see "Confirmation" below.
- **`pnpm test:e2e` (Playwright)** was not run in this session. The
  config/spec exist (`tests/journeys/`) and are believed correct, but
  running a real browser was not attempted here; do not treat this as
  evidence of a passing E2E run.
- **`tests/performance`** is a manual-only smoke check (documented in its
  README), intentionally excluded from `pnpm verify`/CI.
- **A faster dev loop for `apps/api`.** `tsx watch` works for day-to-day
  development (routing/DI via explicit `@Inject()` works fine under it),
  but anything relying on reflected `design:paramtypes` (like adding a new
  Swagger-parameter-decorated method) should be double-checked against a
  real `pnpm build` before trusting it. A `tsc --watch`-based or
  `@nestjs/cli`-based dev loop would close this gap properly; not done here
  to keep the toolchain minimal for a foundation prompt.
- **Re-verification under real Node 24 LTS**, once available in an
  environment that has it installed.

## Confirmation: SP001-SP036 remain NOT_STARTED

Verified via `tests/architecture/register-integrity.test.ts`'s
"SP001-SP036 all remain NOT_STARTED after this foundation prompt" test and
by direct inspection of
[`product/registers/shared-platform.yaml`](../registers/shared-platform.yaml):
all 36 capabilities have `specificationStatus: SPECIFICATION_READY`,
`implementationStatus: NOT_STARTED`, `productStatus: NOT_READY`. This prompt
did not change any of these three fields for any capability.

## Final git status

Branch `erp-v2/foundation` (orphan, created from an empty index/working
tree; `main` and all pre-existing branches/history are untouched).
Zero commits exist on this branch - nothing has been committed per the
"do not commit unless explicitly authorized" instruction.

`git status --porcelain=v1` reports 22 untracked top-level entries (git
collapses untracked directories to one line each). `git add -A --dry-run`
confirms exactly **305 files** would be staged, none under `node_modules/`,
`dist/`, `.next/`, `.turbo/`, or any `.env` file - confirmed by
cross-referencing against `git status --ignored=matching`. All 305
candidate files were grepped for AWS-access-key, PEM-private-key, and
`sk-`-prefixed secret patterns: no matches.

---

# Prompt 001B: Foundation Verification and Recovery Checkpoint (2026-09-13)

## Pre-flight safety

Before any change: confirmed the current branch was exactly
`erp-v2/foundation` (not `main`), confirmed `main`'s log was unchanged
(`79a7fc57` still at its tip), confirmed `origin` remained the same GitHub
remote, confirmed via `git status --ignored=matching` that `.env`,
`node_modules/`, `dist/`, `.next/`, `.turbo/` would all be excluded from any
commit, and confirmed all 36 shared-platform capabilities remain
`NOT_STARTED`/`NOT_READY` (`grep -c` against
`product/registers/shared-platform.yaml`: 36/36 each way, 0 marked
`IMPLEMENTED`/`READY`).

## Node 24 verification

Used `fnm` (already present on this machine) to install and activate the
exact pinned version rather than a different 24.x release:

| | |
| --- | --- |
| `node --version` | `v24.9.0` |
| `pnpm --version` | `11.21.0` (via `corepack enable` under Node 24, matching `packageManager`) |
| `packageManager` (package.json) | `pnpm@11.21.0` |
| `engines` (package.json) | `{ "node": ">=24.0.0 <25.0.0", "pnpm": "11.21.0" }` |
| `.nvmrc` / `.node-version` | `24.9.0` |
| Version manager | `fnm 1.39.0`; installed via `fnm install 24.9.0` (confirmed available in `fnm list-remote`), activated by prepending its install path to `PATH` for every command in this prompt |

All work in this prompt ran under real Node 24.9.0, not Node 26 - verified
by prefixing every command with `node --version` and checking output began
with `v24`.

## Safe clean command

No clean script existed yet; added `scripts/clean.mjs` (`pnpm run clean`) -
removes only `dist/`, `.next/`, `.turbo/` directories and `*.tsbuildinfo`
files, explicitly skips `node_modules/` and `.git/`, and never touches
source. Used before every rebuild in this prompt.

## Frozen-lockfile and clean-build results

- `pnpm install --frozen-lockfile` under Node 24: **Pass** (twice - once
  before adding `@axe-core/playwright`, once after `pnpm install` updated
  the lockfile for it).
- `pnpm run clean`: removed 57 generated directories and 26
  `*.tsbuildinfo` files, leaving zero `dist/`/`.next/`/`.turbo` anywhere in
  the repo (verified by re-running immediately after with nothing further
  to remove).
- Full rebuild from that clean state: **Pass**, all 28 packages/apps.

## `pnpm verify` exact results (from clean state, under Node 24)

| Step | Result |
| --- | --- |
| lockfile consistency | Pass |
| formatting check | Pass |
| lint | Pass - 28/28 packages |
| typecheck | Pass - 28/28 packages |
| unit tests | Pass - **83 tests / 34 files**, 0 failed, 0 skipped |
| architecture tests | Pass - **20 tests / 4 files**, 0 failed, 0 skipped |
| register validation | Pass - 36/36 capabilities |
| build | Pass - 28/28 packages/apps |
| **`pnpm verify` total** | **8/8 steps passed, 0 failed** |

Unit-test composition is unchanged from Prompt 1 (no new unit tests were
added in this prompt): 15 platform-module boundary tests (1 each),
`contracts` (14), `configuration` (8), `observability` (6), `api-client`
(3), `auth` (3), `database` (3), `design-tokens` (3), `api` (5), `worker`
(4), `web` (3, 2 files), `permissions` (2), `testing` (2), `ui` (1),
`tests/security` (8, 4 files), `tests/contracts` (3).

## Integration-test exact results (real PostgreSQL 18 + Redis 7)

Ran twice (once mid-session, once after the final clean rebuild) with
identical results both times:

| File | Tests | Result |
| --- | --- | --- |
| `apps/api/test/health.integration.test.ts` | 1 | Pass |
| `apps/worker/test/heartbeat-queue.integration.test.ts` | 1 | Pass |
| `tests/integration/platform-tenant-migrations.test.ts` | 3 | Pass |
| **Total** | **5 tests / 3 files** | **5 passed, 0 failed, 0 skipped** |

- PostgreSQL: `postgres:18-alpine`, actual `SELECT version()` →
  `PostgreSQL 18.6 on x86_64-pc-linux-musl`, container healthy, port
  `5442` (5432 remained occupied on this host by an unrelated pre-existing
  container from a different project, `resumeiq-postgres` - documented in
  Prompt 1's evidence too; the committed default in
  `infrastructure/docker-compose.yml` is unchanged at 5432).
- Redis: `redis:7-alpine`, actual `INFO server` → `redis_version:7.4.11`,
  container healthy, port `6379`.
- Both containers had been running continuously since Prompt 1 (2+ hours
  uptime at the start of this prompt) and were not recreated.

## Playwright E2E: exact results

Inspected the existing config/spec first: `tests/journeys/playwright.config.ts`
only declared one spec file (`foundation.spec.ts`, 3 tests covering heading
load, 404, and "skip link receives Tab focus") - well short of the 13-item
minimum coverage list in this prompt. Expanded coverage into two spec files
rather than one to separate concerns (process-lifecycle test vs.
content/accessibility/API-contract tests), and removed the now-fully-
superseded `foundation.spec.ts`.

**Browser install**: the pinned `@playwright/test@1.49.1` required Chromium
build `1148`; only builds `1228`/`1234` (from an unrelated, newer Playwright
install elsewhere on this machine) were present. Installed **only**
`pnpm exec playwright install chromium` (not firefox/webkit, which this
project's config doesn't use).

**Determinism**: `tests/journeys/playwright.config.ts` changed to
`fullyParallel: false` / `workers: 1`, because the availability/recovery
spec stops and restarts the real `apps/api` process mid-suite - running
that concurrently with other specs asserting live API status would race.
Ran the full suite **three separate times** (once right after fixing the
defects below, once immediately after, once again after the full clean
rebuild) - identical 9/9 pass every time.

| Spec file | Tests | Result |
| --- | --- | --- |
| `accessibility-and-api.spec.ts` | 7 | Pass |
| `api-availability.spec.ts` | 2 | Pass |
| **Total** | **9 tests / 2 files** | **9 passed, 0 failed, 0 skipped** (×3 runs) |

Coverage against this prompt's 13-item minimum list:

| Requirement | Where covered |
| --- | --- |
| Web foundation page loads | `accessibility-and-api.spec.ts` (heading test) |
| Live API readiness, not build-time status | Same test asserts `dd` = `ok`; `api-availability.spec.ts` proves the *same* value flips to `unreachable` when the real API is stopped and back to `ok` when restarted - only possible if it's a live per-request check |
| API liveness endpoint | `accessibility-and-api.spec.ts` "apps/api contract" test, real HTTP via `page.request` |
| API readiness endpoint | Same test, asserts `status`, `checks.postgres`, `checks.redis` |
| OpenAPI document available | Same test, asserts `openapi` version and both health paths present |
| Skip link keyboard-accessible, moves focus correctly | `accessibility-and-api.spec.ts` skip-link test |
| Basic keyboard navigation | Same test's final assertion - focus leaves `#main-content` on further Tab (no trap) |
| No serious/critical automated a11y violations | Two `@axe-core/playwright` tests (foundation page + not-found page) |
| Not-found page renders correctly | `accessibility-and-api.spec.ts` 404 test |
| API-unavailable state is actionable, not falsely healthy | `api-availability.spec.ts` first test |
| Recovery after API becomes available again | `api-availability.spec.ts` second test |
| No mock ERP/customer data | `accessibility-and-api.spec.ts` console/mock-data test, checked against a forbidden-pattern list |
| No browser console errors on the successful journey | Same test, `page.on('console'/'pageerror')` collected and asserted empty |

## Defects found and fixed while getting E2E green

Each was root-caused against real behavior, not weakened around:

1. **Skip link did not move focus to `#main-content` in Chromium.** A plain
   `<a href="#main-content">` plus `tabIndex={-1}` on the target does not
   reliably trigger native focus-follows-fragment in this browser/version
   (confirmed via a throwaway debug test: `document.activeElement` stayed
   `<body>` even though `location.hash` updated correctly). Fixed with a
   small Client Component (`apps/web/app/skip-link.tsx`) that calls
   `target.focus()` explicitly on click/activation - the standard,
   accessible pattern for reliable skip links, not a test-only workaround.
2. **`page.getByRole('alert')` matched the wrong element.** Next.js injects
   its own internal route announcer (`<next-route-announcer>`, containing a
   shadow-DOM `role="alert"` live region) into every page. Playwright's
   role queries pierce shadow DOM, so the generic role query silently
   matched Next's empty announcer instead of this project's own status
   message. Fixed by targeting `p[role="alert"]` specifically in both
   specs that check it.
3. **`import.meta.url` crashed under Playwright's transform.** The repo
   root has no `"type": "module"`, so Playwright compiles `tests/journeys`
   as CommonJS; `import.meta` is invalid there. Fixed
   `tests/journeys/lib/api-process.ts` to use `__dirname` instead.

None of these were "weaken the assertion" fixes - the first is a genuine
accessibility bug in the shipped page that a screen-reader user would have
hit for real; the second and third are test-authoring corrections that
made the tests point at the right thing rather than accepting a false
result.

## Accessibility result

Two `@axe-core/playwright` scans (foundation page, not-found page): **zero
violations with `impact: "serious"` or `"critical"`** on both, using the
default axe ruleset (WCAG 2.0/2.1 A/AA + best practices). Full violation
objects are asserted into the failure message (would show if any existed);
none did.

## Real runtime checks (compiled builds, Node 24)

Stopped every previously-running instance, ran `pnpm run clean` + full
rebuild, then started fresh from the new build:

- `node apps/api/dist/main.js` (port 3001): `GET /api/v1/health/live` →
  `200 {"status":"ok"}`; `GET /api/v1/health/ready` →
  `200 {"status":"ok","checks":{"postgres":true,"redis":true}}`;
  `GET /api/v1/docs-json` → valid OpenAPI 3.0 document.
- `node apps/worker/dist/main.js` (port 3002): `GET /health/live` →
  `200 {"status":"ok"}`; `GET /health/ready` (after its 30s repeat
  interval) →
  `200 {"status":"ok","checks":{"postgres":true,"redis":true,"heartbeatWorker":true},"lastHeartbeatAt":"2026-09-13T06:58:00.027Z"}`.
- `next start` (port 3000): `/` → heading present, `<dd>ok</dd>` for API
  liveness; `/nonexistent-route` → HTTP 404 with the not-found page.

All three stopped cleanly afterward (`taskkill` on their listening ports).

## Secret-scan result

`git add -A --dry-run` → **309 files** would be staged (305 from Prompt 1 +
4 net new: `scripts/clean.mjs`, `apps/web/app/skip-link.tsx`,
`tests/journeys/lib/api-process.ts`, `tests/journeys/api-availability.spec.ts`,
`tests/journeys/accessibility-and-api.spec.ts`, minus the removed
`tests/journeys/foundation.spec.ts`). All 309 grepped for AWS-access-key,
PEM-private-key and `sk-`-prefixed patterns: **no matches**. Cross-checked
against `git status --ignored=matching`: no `.env`, `node_modules/`,
`dist/`, `.next/`, or `.turbo/` path appears in the staged set.

## Remaining limitations

- Playwright's `webServer` for `apps/web` runs `next dev`, not the
  production build, for convenience of Playwright's own start/reuse
  lifecycle - separately, this prompt's "real runtime checks" section
  verified the actual production build directly with `curl`, so production
  behavior is independently confirmed, just not through Playwright itself.
- `tests/journeys/lib/api-process.ts`'s process control
  (`netstat`/`taskkill`) is Windows-specific, matching this project's
  current local verification environment; it would need a cross-platform
  equivalent before this suite could run in a Linux CI runner as-is.
- PostgreSQL still runs on port `5442` locally due to the pre-existing
  unrelated container on `5432` on this machine; unchanged from Prompt 1.

## Confirmation: SP001-SP036 remain NOT_STARTED / NOT_READY

Re-verified after all changes in this prompt: `grep -c` against
`product/registers/shared-platform.yaml` shows 36/36 `NOT_STARTED`, 36/36
`NOT_READY`, 0 `IMPLEMENTED`, 0 `READY`. No SP or F identifier was
implemented in this prompt; only the verification and E2E-coverage gaps
from Prompt 1 were closed.
