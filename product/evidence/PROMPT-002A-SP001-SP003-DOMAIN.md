# Prompt 002A evidence: SP001-SP003 domain, database and API foundation

Date: 2026-09-13 (UTC)
Branch: `erp-v2/shared-platform`, based on `erp-v2/foundation` @
`877f0294ed5959ef08c1983c30aef2265c81fbd9`
Environment: Windows 11, Node.js v24.9.0 (fnm-pinned), pnpm 11.21.0,
PostgreSQL 18 (Docker, `vercentlabs-erp-postgres`, host port 5442), Redis 7
(Docker, `vercentlabs-erp-redis`, host port 6379)

This record covers **only** SP001 (organization/tenant lifecycle), SP002
(company/legal-entity structure), and SP003 (branch/site/operating-unit
context). SP004-SP010 (authentication/authorization) are explicitly **not**
implemented here. Per this prompt's instructions, SP001-SP003 are **not**
marked `IMPLEMENTED`/`PRODUCT_READY` in
[`product/registers/shared-platform.yaml`](../registers/shared-platform.yaml)
- they remain `NOT_STARTED`/`NOT_READY`, unchanged by this prompt. Final
certification is deferred to a future Prompt 002D once a real
authentication adapter exists to replace the fail-closed boundary described
below.

## 1. What was built

- **Database** (`database/migrations/platform/0001`-`0006`): `organizations`,
  `companies`, `operating_units` tables; `platform.idempotency_records`;
  `audit.audit_events` and `integration.outbox_events` (minimal SP014/SP015
  foundations, explicitly not the full capability); the least-privilege
  `erp_runtime` role with column-restricted `GRANT UPDATE`
  (`tenant_key`/`company_code`/`unit_code` are DB-enforced immutable); Row-
  Level Security on every tenant/shared-scope table except
  `platform.organizations` (no RLS by design - see
  `docs/security/tenant-isolation.md`); a `BEFORE INSERT OR UPDATE` trigger
  enforcing operating-unit parent/company/organization consistency and
  cycle rejection.
- **Domain packages**: `platform/tenancy` (SP001 - schema, state machine,
  repository, 6 commands, 2 queries) and `platform/organization` (SP002+
  SP003 - schema, shared state machine, repository, company + operating-unit
  commands/queries, cross-module organization guard).
- **Shared contracts**: `TrustedScope` discriminated union
  (`platform_operator`/`organization`), framework-free domain error
  vocabulary, cursor pagination, organization/company/operating-unit
  DTOs+request schemas (`packages/contracts/src/platform/*`).
- **Idempotency + optimistic concurrency** (`packages/database`):
  claim-then-effect-then-complete idempotency records (SAVEPOINT-isolated
  claim retry), `SET LOCAL`-scoped organization context, conditional
  `UPDATE ... WHERE version = $n` concurrency.
- **HTTP API** (`apps/api/src/platform`): `TrustedScopeProvider` seam
  (`FailClosedTrustedScopeProvider` for production,
  `TestTrustedScopeProvider` for everything else, guarded against ever
  running in production), `TrustedScopeGuard`, `PLATFORM_DB` connection
  (always via `erp_runtime`), 3 controllers exposing 19 versioned REST
  endpoints under `/api/v1/platform/*` (organizations, nested companies,
  nested operating units), Idempotency-Key/If-Match parsing helpers, zod
  request validation helpers, domain-error-to-HTTP mapping wired into the
  existing exception filter.
- **9 documentation files**: 3 architecture docs, 2 security docs, 1
  operations doc, 3 ADRs (0005-0007) - see section 6.

## 2. Pre-flight checks (performed before any implementation work)

| Check | Result |
|---|---|
| Commit hash of `erp-v2/foundation` | `877f0294ed5959ef08c1983c30aef2265c81fbd9` (confirmed via `git log`) |
| Node version | v24.9.0 (`node -v`) |
| pnpm version | 11.21.0 (`pnpm -v`) |
| `main` untouched | `79a7fc57b81574e139e3c2a86e9ce5751d035af7` (confirmed via `git rev-parse main` before and after this prompt's work - unchanged) |
| `erp-v2/foundation` pushed | Confirmed via `git ls-remote origin erp-v2/foundation` → `877f0294...` matches local |
| Working tree clean at start | Confirmed via `git status` |
| Branch `erp-v2/shared-platform` created off foundation | Confirmed |
| Pre-implementation `pnpm verify` | Passed (8/8) before any SP001-SP003 code was written |
| SP001/SP002/SP003 register status confirmed `NOT_STARTED`/`NOT_READY` | Confirmed via `product/registers/shared-platform.yaml` |

## 3. Database verification (real PostgreSQL, not simulated)

- Migrations `0001`-`0006` applied cleanly to the dev database
  (`vercentlabs_erp`) and independently to a throwaway `vercentlabs_erp_test`
  database via `setupTestDatabase`/`resetTestDatabase`
  (`packages/database/src/test-database.ts`), which drops and reapplies all
  four schemas (`platform`, `tenant`, `audit`, `integration`) from scratch
  on every integration test run - this is, in effect, a repeatability check
  executed dozens of times across this session's test runs, not a
  one-off.
- Confirmed applied migrations in the dev database:
  ```
  0000_bootstrap_platform_schema.sql
  0001_create_organizations.sql
  0002_create_companies.sql
  0003_create_operating_units.sql
  0004_create_idempotency_records.sql
  0005_create_audit_and_outbox.sql
  0006_create_runtime_role_and_rls.sql
  ```
- Confirmed `erp_runtime` role exists with `NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOBYPASSRLS NOREPLICATION` via direct `psql` query.
- Manual smoke test via `psql` and later cleaned up: created/activated an
  organization, a company, and an operating unit through the running
  compiled API, confirmed correct data via direct SQL, then deleted the
  rows (audit/outbox/idempotency/domain tables) to leave the dev database
  clean before final verification.

## 4. Automated test results (all executed this session, real - not fabricated)

### Unit tests (no external services)

| Suite | File(s) | Tests |
|---|---|---|
| `@vercentlabs/contracts` | `test/contracts.test.ts`, `test/platform.test.ts` | 38 passed |
| `@vercentlabs/database` | `test/uuid.test.ts`, `test/request-hash.test.ts`, `test/test-database-guard.test.ts` | 12 passed |
| `@vercentlabs/platform-tenancy` | `test/status.test.ts` (+ placeholder) | 21 passed |
| `@vercentlabs/platform-organization` | `test/status.test.ts` (+ placeholder) | 38 passed |
| `@vercentlabs/api` (unit) | `test/health.unit.test.ts`, `test/platform-auth.unit.test.ts` | 16 passed |

### Integration tests (real PostgreSQL/Redis, `TEST_DATABASE_URL` /
`vercentlabs_erp_test`)

| Suite | File | Tests |
|---|---|---|
| Domain layer | `tests/integration/organization-domain.integration.test.ts` | 10 passed |
| Domain layer | `tests/integration/company-operating-unit-domain.integration.test.ts` | 6 passed |
| RLS/isolation | `tests/integration/tenant-isolation-rls.integration.test.ts` | 9 passed |
| Migration bootstrap | `tests/integration/platform-tenant-migrations.test.ts` | 3 passed |
| **HTTP API** (real Nest app + real Postgres) | `apps/api/test/platform-api.integration.test.ts` | 21 passed |
| **HTTP API** (real compiled build, real process) | `apps/api/test/platform-openapi.integration.test.ts` | 3 passed |
| Health (pre-existing) | `apps/api/test/health.integration.test.ts` | 1 passed |

**Total real-Postgres integration tests: 53 passed, 0 failed.**

### Architecture tests

`tests/architecture/*.test.ts`: **26 passed** across 5 files, including the
new `platform-api-boundaries.test.ts` (6 tests): controllers never import
`drizzle-orm`/`pg` directly (only the `drizzle-orm/node-postgres` connection
type) or a sibling package's `schema.js`/`repository.js`; no file outside
`apps/api/src/platform/auth` (and test files) constructs a literal
`TrustedScope`; `TestTrustedScopeProvider` is referenced only from
`platform-auth.module.ts` and test files.

### Security tests

`tests/security/*.test.ts` (pre-existing static checks - CORS, no plaintext
secrets, redaction contract, no raw console logging): **8 passed**, no
regressions. Security-*negative* scenarios specific to SP001-SP003 (cross-
tenant IDOR, URL/scope spoofing, SQL-injection-shaped search input, oversized
pagination, forged/malformed trusted-scope headers, suspended/closed-org
write rejection, non-disclosure of resource existence) are covered as part
of `apps/api/test/platform-api.integration.test.ts` (real Nest app + real
Postgres, not mocked) - see that file's "Security-negative" section, 7
dedicated test cases, all passing.

### End-to-end (Playwright, foundation suite - regression check)

`pnpm test:e2e` (the Prompt 001B foundation journeys, unmodified):
**9 passed**, confirming the new `PlatformModule` wiring into `AppModule`
introduced no regression in `apps/web`'s existing accessibility, live-status,
and API-availability/recovery behavior.

### Performance (honest measurement, no fabricated capacity claim)

`tests/performance/platform-organizations-latency.performance.test.ts`,
run manually against the real compiled `apps/api` build (dev database,
single local machine, cold connection pool, 20 sequential requests to
`GET /platform/organizations?limit=25`):

```
organizations list p50=50.2ms p95=180.7ms (n=20)
```

This is a single-machine, cold-pool, unoptimized-index-cache measurement on
one developer workstation. It is not a load test, not a production
capacity figure, and not a claimed SLA - it exists to have *a* real number
on record rather than none.

### `pnpm verify` (full run, this session)

```
✓ lockfile consistency (pnpm install --frozen-lockfile)
✓ formatting check
✓ lint
✓ typecheck
✓ unit tests
✓ architecture tests
✓ shared-platform register validation
✓ build (web, api, worker, packages)

8/8 steps passed, 0 failed.
```

## 5. Genuine bugs found and fixed during real verification

This is the point of running real infrastructure instead of assuming code is
correct - six were found and fixed at the domain/database layer (see prior
session work), plus two more found during this session's HTTP-layer
verification:

1. **Idempotency claim retry aborted the whole transaction** - a plain
   `try/catch` around the claim `INSERT` left the enclosing PostgreSQL
   transaction aborted after a `unique_violation`, so the recovery `SELECT`
   in the `catch` block itself failed. Fixed by wrapping the claim in a
   drizzle nested transaction (a real `SAVEPOINT`).
2. **Idempotency-claim-before-existence-check ordering** -
   `createCompany`/`createOperatingUnit` validated the parent organization
   *inside* the idempotent transaction, so an invalid `organizationId` hit
   a raw foreign-key violation before the domain layer's own
   `DomainNotFoundError` check ran. Fixed by moving the organization-guard
   check before the idempotency claim.
3. **`resetTestDatabase` incomplete schema cleanup** - only dropped
   `platform`/`tenant`, orphaning `audit`/`integration` tables after
   `platform._migrations` bookkeeping was wiped. Fixed by also dropping
   `audit`/`integration` `CASCADE`.
4. **Stale test-fixture assertion** - `platform-tenant-migrations.test.ts`
   asserted zero non-bookkeeping tables, which was true after Prompt 1 but
   is legitimately false now. Updated to an explicit allowlist of the new
   SP001-SP003 tables, preserving the test's original intent (still fails
   on any real business-module table).
5. **`.env` pointed at the wrong PostgreSQL port** - this machine already
   runs an unrelated project's Postgres on the compose file's default port
   5432, so `vercentlabs-erp-postgres` had been started with
   `POSTGRES_PORT=5442`, but the local `.env` (gitignored, not committed)
   still said 5432, causing every integration test to fail with "password
   authentication failed" against the *wrong* database. Fixed by
   correcting `.env`'s `DATABASE_URL`/`TEST_DATABASE_URL`/`POSTGRES_PORT` to
   5442, matching `tests/journeys/lib/api-process.ts`'s pre-existing default
   (which already assumed 5442 - the `.env` value was the one that had
   drifted).
6. **Every lifecycle POST endpoint returned HTTP 201, not 200** - NestJS
   defaults any `@Post()` handler with no explicit `@HttpCode()` to 201
   (Created). `activate`/`suspend`/`recover`/`close` (organizations),
   `activate`/`deactivate`/`reactivate`/`close` (companies and operating
   units) all lacked an explicit `@HttpCode(200)`, so every one of them
   silently returned 201 despite the domain layer's `CommandResponse.status`
   correctly being `200`. Caught by
   `apps/api/test/platform-api.integration.test.ts`'s stale-version-conflict
   test (`expected 201 to be 200`), not by manual `curl` smoke testing,
   which had only inspected response bodies, not status codes. Fixed by
   adding `@HttpCode(200)` to all 8 affected handlers across the three
   controllers.

## 6. Documentation delivered

- `docs/architecture/organization-tenancy-model.md`
- `docs/architecture/trusted-request-context.md`
- `docs/architecture/platform-state-machines.md` (Mermaid state diagrams)
- `docs/security/tenant-isolation.md`
- `docs/security/platform-operator-boundary.md`
- `docs/operations/organization-lifecycle-recovery.md`
- `docs/decisions/ADR-0005-platform-control-plane.md`
- `docs/decisions/ADR-0006-transaction-local-rls-context.md`
- `docs/decisions/ADR-0007-idempotency-and-concurrency.md`
- Updated (for accuracy, not scope creep): `docs/decisions/ADR-0003-postgresql-tenancy-and-rls.md`
  and `docs/architecture/tenant-data-strategy.md`, both of which previously
  described RLS/tenant tables as "not implemented yet" - now inaccurate.

## 7. What is explicitly NOT done (by design, per this prompt's scope)

- SP004-SP010 (authentication/authorization) - not started. No code path
  can construct a real `TrustedScope` in production; every protected
  endpoint fails closed with HTTP 401.
- `apps/web` admin UI for organizations/companies/operating-units - not
  built. Only the existing fail-closed foundation page exists; no new
  screens were added, per this prompt's explicit restriction.
- SP001-SP003 register status - unchanged (`NOT_STARTED`/`NOT_READY`).
- Full SP014 (audit)/SP015 (outbox) capabilities - only minimal
  append-only writers exist, explicitly documented as such in
  `platform/audit/src/index.ts` and `platform/outbox/src/index.ts`; no
  outbox dispatcher, no audit query/reporting surface.
- Branch/company-level authorization narrower than "organization scope
  matches" - `OrganizationScope.companyId`/`operatingUnitId` exist as
  optional fields for a future authorization layer to read; no command
  enforces them yet (see `docs/architecture/organization-tenancy-model.md`).

## 8. Commit and push

Commit message: `feat(platform): establish tenant organization hierarchy`
Branch pushed: `erp-v2/shared-platform` only. `main` was never touched.
No force push. No pull request opened. SP004 work was not begun.
