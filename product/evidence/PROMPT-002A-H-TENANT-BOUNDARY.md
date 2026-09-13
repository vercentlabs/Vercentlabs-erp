# Prompt 002A-H evidence: tenant-boundary and test-authentication hardening

Date: 2026-09-13 (UTC)
Branch: `erp-v2/shared-platform`, on top of commit `a4aa22ca503bbdb72b2c3e110ad99f95d57aad58`
("feat(platform): establish tenant organization hierarchy")
Environment: Windows 11, Node.js v24.9.0 (fnm-pinned), pnpm 11.21.0,
PostgreSQL 18 (Docker, `vercentlabs-erp-postgres`, host port 5442), Redis 7
(Docker, `vercentlabs-erp-redis`, host port 6379)

This prompt audits and corrects three concerns identified after Prompt
002A shipped. It does not begin SP004, does not implement user
authentication or an administration UI, does not modify `main`, and does
not change any SP001-SP036 completion status.

## 1. Original risks

1. **`platform.organizations` had no Row-Level Security.** Every other
   tenant/shared-scope table (`platform.companies`,
   `platform.operating_units`, `platform.idempotency_records`,
   `audit.audit_events`, `integration.outbox_events`) had RLS; the table
   that IS the tenant boundary itself did not. Isolation for it relied
   entirely on application-layer `isPlatformOperatorScope` checks, with no
   database-layer defense-in-depth. A single missed check anywhere would
   have exposed every organization to any caller holding an `erp_runtime`
   connection.
2. **`TestTrustedScopeProvider` was reachable outside automated tests.**
   `PlatformAuthModule` selected it whenever `NODE_ENV !== 'production'` -
   meaning a plain local `dev` run, a misconfigured staging deployment, or
   simply forgetting to set `NODE_ENV` would silently accept the
   `x-test-trusted-scope` header and let a caller become a platform
   operator with one HTTP header.
3. **The 19-path / 25-operation API surface had not been checked against
   an explicit required-operations list.**

## 2. Exact findings (executable proof, before any fix)

Run against the dev database's `platform.organizations` table as it existed
at the end of Prompt 002A, using the real `erp_runtime` role:

| # | Probe | Result | Verdict |
|---|---|---|---|
| 1 | `erp_runtime`, no `app.current_organization_id` set, `SELECT * FROM platform.organizations` | Returned **2** rows (all seeded organizations) | **VULNERABLE** |
| 2 | `erp_runtime` scoped to organization A, `SELECT ... WHERE id = <organization B>` | Returned **1** row (organization B, not A) | **VULNERABLE** |
| 3 | `erp_runtime` scoped to organization A, `UPDATE ... SET display_name WHERE id = <organization B>` | **Succeeded** | **VULNERABLE** |
| 4 | `erp_runtime`, direct `INSERT INTO platform.organizations (...)` | **Succeeded** | **VULNERABLE** |
| 5 | `erp_runtime`, `UPDATE ... SET tenant_key = ...` | Rejected: `permission denied for table organizations` | Safe (column-level `GRANT` already excluded `tenant_key`) |

Findings 1-4 are the exact vulnerability this prompt fixes. Finding 5
confirms the pre-existing column-level immutability protection for
`tenant_key` was already correct and needed no change.

`PlatformAuthModule`'s provider-selection branch, read directly from
source before the fix:

```ts
useClass: process.env['NODE_ENV'] === 'production' ? FailClosedTrustedScopeProvider : TestTrustedScopeProvider
```

Any `NODE_ENV` value other than the literal string `'production'` -
`'development'`, `'test'`, `undefined`, or a typo like `'developement'` -
activated the header-driven test adapter.

## 3. Migrations and policies added

`database/migrations/platform/0007_harden_organizations_tenant_boundary.sql`
(new, forward-only; no already-applied migration was edited):

- Creates `erp_platform_admin` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS NOREPLICATION`), a role distinct from `erp_runtime`.
- Grants `erp_platform_admin` `USAGE` on `platform`/`audit`/`integration`
  schemas, and the same `audit.audit_events`/`integration.outbox_events`/
  `platform.idempotency_records` grants `erp_runtime` has (organization
  commands write to all three in the same transaction as the organization
  mutation, regardless of which role executes them).
- Enables and forces RLS on `platform.organizations`.
- `REVOKE INSERT, UPDATE ON platform.organizations FROM erp_runtime` -
  outright, not narrowed - `erp_runtime` has no legitimate remaining reason
  to write this table.
- `CREATE POLICY organizations_tenant_runtime_read_own ... FOR SELECT TO
  erp_runtime USING (id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)` -
  `erp_runtime` may still read, but only its own scoped organization's row.
- `CREATE POLICY organizations_platform_admin_full_access ... TO
  erp_platform_admin USING (true) WITH CHECK (true)` - an explicit,
  auditable policy scoped to this one role, preferred over `BYPASSRLS` per
  this prompt's instructions.
- Grants `erp_platform_admin` `SELECT, INSERT` and column-restricted
  `UPDATE` (excluding `tenant_key`/`created_at`/`created_by`) on
  `platform.organizations` - the same immutable-column list `erp_runtime`
  previously had, now on the role that actually performs these writes.
- Grants `erp_platform_admin` **nothing** on `platform.companies` or
  `platform.operating_units` - a leaked admin credential cannot reach
  tenant business data.

Applied to a fresh disposable test database (via `setupTestDatabase`,
which runs `0000`-`0007` in order) and, independently, to the dev database
already at the Prompt 002A state (`0000`-`0006` already applied):

```
[migrate] platform: applied=1 skipped=7
[migrate] platform applied: 0007_harden_organizations_tenant_boundary.sql
```

Post-migration, probes 1-4 above were re-run against the same dev database
and now return the corrected (safe) result - see section 5.

## 4. Database roles and privileges (final state)

| Role | Superuser/Bypass RLS | `platform.organizations` | `platform.companies` / `platform.operating_units` | `audit`/`integration`/`idempotency_records` |
|---|---|---|---|---|
| `erp_runtime` | No / No | `SELECT` own row only (RLS); no `INSERT`/`UPDATE` at all | Full CRUD, RLS-scoped (unchanged from Prompt 002A) | `SELECT`/`INSERT` (append-only), RLS-scoped |
| `erp_platform_admin` | No / No | `SELECT`/`INSERT`/column-restricted `UPDATE`, RLS policy `USING(true)` (cross-tenant) | **No grant at all** | `SELECT`/`INSERT` (append-only), same shared-table policies |
| migration/admin role | Yes (superuser, used only for migrations) | n/a | n/a | n/a |

## 5. Tenant vs. platform connection model

`apps/api` now runs **two** connection pools, both `@Global()` from
`PlatformDatabaseModule`:

- `PLATFORM_DB` (`PlatformDatabaseService`, `erp_runtime`) - injected by
  `CompaniesController` and `OperatingUnitsController`.
- `PLATFORM_ADMIN_DB` (`PlatformAdminDatabaseService`, `erp_platform_admin`)
  - injected **only** by `OrganizationsController`.

The choice is a compile-time `@Inject(...)` token per controller, never
derived from a request header, cookie, query parameter, or body field.
`tests/architecture/platform-api-boundaries.test.ts` enforces this
structurally (only `OrganizationsController` may reference
`PLATFORM_ADMIN_DB`; the token is not read from any client-supplied
source).

Post-fix probe results (same probes as section 2, re-run against the
patched schema):

```
1) erp_runtime, NO scope set -> visible rows: 0 (expect 0)
2) erp_runtime scoped to A, SELECT org B by id -> rows: 0 (expect 0)
2b) erp_runtime scoped to A, SELECT org A (own) -> rows: 1 (expect 1)
   update org B threw: permission denied for table organizations
3) erp_runtime scoped to A, UPDATE org B -> succeeded: false (expect false)
   direct insert threw: permission denied for table organizations
4) erp_runtime direct INSERT -> succeeded: false (expect false)
5) erp_platform_admin sees all orgs -> rows: 2 (expect >=2)
6) erp_platform_admin INSERT -> succeeded: true (expect true)
   admin tenant_key update threw: permission denied for table organizations
7) erp_platform_admin UPDATE tenant_key -> succeeded: false (expect false)
```

Every finding from section 2 is now the opposite of the original
vulnerable result, confirmed by direct SQL, not by application-level
behavior alone.

## 6. Test-provider activation model (final)

`PlatformAuthModule` now registers `FailClosedTrustedScopeProvider`
**unconditionally** - no `NODE_ENV` branch exists in the file at all:

```ts
providers: [
  { provide: TRUSTED_SCOPE_PROVIDER, useClass: FailClosedTrustedScopeProvider },
  TrustedScopeGuard,
],
```

`TestTrustedScopeProvider` becomes active in exactly one way: a test's own
`Test.createTestingModule({ imports: [AppModule] })
.overrideProvider(TRUSTED_SCOPE_PROVIDER).useClass(TestTrustedScopeProvider)`
call (see `apps/api/test/platform-api.integration.test.ts`). Its
constructor's `NODE_ENV === 'production'` throw remains as an independent
second layer of defense.

Verified, against the real compiled `apps/api/dist/main.js` (not
vitest-transformed source), that a forged `x-test-trusted-scope` header is
rejected (401) under all four required conditions -
`apps/api/test/platform-openapi.integration.test.ts`:

```
✓ a normal API startup under production rejects a forged trusted-scope header (401)
✓ a normal API startup under development rejects a forged trusted-scope header (401)
✓ a normal API startup under test (no explicit test-module override) rejects a forged trusted-scope header (401)
✓ a normal API startup under missing NODE_ENV rejects a forged trusted-scope header (401)
```

Only `apps/api/test/platform-api.integration.test.ts`'s explicit
`overrideProvider` composition ever accepts the test header - proven by
every test in that file requiring it to pass at all (21 tests, all real
HTTP calls through the guard).

`tests/architecture/platform-api-boundaries.test.ts` adds two structural
checks preventing regression: `TestTrustedScopeProvider` is never imported
by any non-test file (including `platform-auth.module.ts` itself), and
`platform-auth.module.ts` must contain the literal `useClass:
FailClosedTrustedScopeProvider` with no `process.env` reference anywhere in
the file.

## 7. Endpoint coverage matrix (SP001-SP003)

All required operations already existed after Prompt 002A - no missing
endpoint was found, so no new route was added. "DB role" reflects the
Prompt 002A-H change (organizations now route through
`erp_platform_admin`).

### Organization (SP001) - `platform/tenancy`

| Operation | Method | Route | Controller method | Command/query | DB role | Scope | Idempotency | Concurrency | Audit action | Outbox event | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Create | POST | `/platform/organizations` | `create` | `createOrganization` | `erp_platform_admin` | `platform_operator` | Required | n/a (new resource) | `organization.create` | `organization.created` | integration ×4, API ×5 |
| Get | GET | `/platform/organizations/{id}` | `getOne` | `getOrganization` | `erp_platform_admin` | `platform_operator` | n/a | n/a | n/a | n/a | API ×2 |
| List | GET | `/platform/organizations` | `list` | `listOrganizations` | `erp_platform_admin` | `platform_operator` | n/a | n/a | n/a | n/a | API ×3 |
| Update metadata | PATCH | `/platform/organizations/{id}` | `updateDisplayMetadata` | `updateOrganizationDisplayMetadata` | `erp_platform_admin` | `platform_operator` | Required | Required (`If-Match`) | `organization.update_display_metadata` | `organization.display_metadata_updated` | API ×1 |
| Activate | POST | `/platform/organizations/{id}/activate` | `activate` | `activateOrganization` | `erp_platform_admin` | `platform_operator` | Required | Required | `organization.activate` | `organization.activated` | integration ×3, API ×3 |
| Suspend | POST | `/platform/organizations/{id}/suspend` | `suspend` | `suspendOrganization` | `erp_platform_admin` | `platform_operator` | Required | Required | `organization.suspend` | `organization.suspended` | integration+API |
| Recover | POST | `/platform/organizations/{id}/recover` | `recover` | `recoverOrganization` | `erp_platform_admin` | `platform_operator` | Required | Required | `organization.recover` | `organization.recovered` | (unit-level covered by shared lifecycle assertions) |
| Close | POST | `/platform/organizations/{id}/close` | `close` | `closeOrganization` | `erp_platform_admin` | `platform_operator` | Required | Required | `organization.close` | `organization.closed` | integration ×2, API ×2 |

### Company (SP002) - `platform/organization`, nested under an organization

| Operation | Method | Route | Controller method | Command/query | DB role | Scope | Idempotency | Concurrency | Audit action | Outbox event | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Create | POST | `/platform/organizations/{orgId}/companies` | `create` | `createCompany` | `erp_runtime` | `organization` | Required | n/a | `company.create` | `company.created` | integration ×2, API ×3 |
| Get | GET | `/platform/organizations/{orgId}/companies/{companyId}` | `getOne` | `getCompany` | `erp_runtime` | `organization` | n/a | n/a | n/a | n/a | API ×2 |
| List | GET | `/platform/organizations/{orgId}/companies` | `list` | `listCompanies` | `erp_runtime` | `organization` | n/a | n/a | n/a | n/a | (covered via list-organizations pattern; company-specific list not separately asserted - see limitations) |
| Update metadata | PATCH | `/platform/organizations/{orgId}/companies/{companyId}` | `update` | `updateCompany` | `erp_runtime` | `organization` | Required | Required | `company.update_metadata` | `company.metadata_updated` | (unit + shared lifecycle) |
| Activate | POST | `.../activate` | `activate` | `activateCompany` | `erp_runtime` | `organization` | Required | Required | `company.activate` | `company.active` | integration ×1 |
| Deactivate | POST | `.../deactivate` | `deactivate` | `deactivateCompany` | `erp_runtime` | `organization` | Required | Required | `company.deactivate` | `company.inactive` | integration ×1 |
| Reactivate | POST | `.../reactivate` | `reactivate` | `reactivateCompany` | `erp_runtime` | `organization` | Required | Required | `company.reactivate` | `company.active` | (unit-level) |
| Close | POST | `.../close` | `close` | `closeCompany` | `erp_runtime` | `organization` | Required | Required | `company.close` | `company.closed` | integration ×1 |

### Operating unit (SP003) - `platform/organization`, nested under a company

| Operation | Method | Route | Controller method | Command/query | DB role | Scope | Idempotency | Concurrency | Audit action | Outbox event | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Create | POST | `.../operating-units` | `create` | `createOperatingUnit` | `erp_runtime` | `organization` | Required | n/a | `operating_unit.create` | `operating_unit.created` | integration ×2, API ×2 |
| Get | GET | `.../operating-units/{id}` | `getOne` | `getOperatingUnit` | `erp_runtime` | `organization` | n/a | n/a | n/a | n/a | API ×1 |
| List | GET | `.../operating-units` | `list` | `listOperatingUnits` | `erp_runtime` | `organization` | n/a | n/a | n/a | n/a | (covered via pattern; see limitations) |
| Update metadata | PATCH | `.../operating-units/{id}` | `update` | `updateOperatingUnit` | `erp_runtime` | `organization` | Required | Required | `operating_unit.update_metadata` | `operating_unit.metadata_updated` | (unit-level) |
| Activate | POST | `.../activate` | `activate` | `activateOperatingUnit` | `erp_runtime` | `organization` | Required | Required | `operating_unit.activate` | `operating_unit.active` | (unit-level) |
| Deactivate | POST | `.../deactivate` | `deactivate` | `deactivateOperatingUnit` | `erp_runtime` | `organization` | Required | Required | `operating_unit.deactivate` | `operating_unit.inactive` | (unit-level) |
| Reactivate | POST | `.../reactivate` | `reactivate` | `reactivateOperatingUnit` | `erp_runtime` | `organization` | Required | Required | `operating_unit.reactivate` | `operating_unit.active` | (unit-level) |
| Close | POST | `.../close` | `close` | `closeOperatingUnit` | `erp_runtime` | `organization` | Required | Required | `operating_unit.close` | `operating_unit.closed` | (unit-level) |
| Resolve hierarchy/children | GET | `.../operating-units/{id}/children` | `children` | `resolveOperatingUnitChildren` | `erp_runtime` | `organization` | n/a | n/a | n/a | n/a | integration ×1, API ×1 |

**Path vs. operation count reconciliation:** the OpenAPI document groups
by path, not by method+path pair - `/platform/organizations` alone carries
both `POST` (create) and `GET` (list), counted once in the document's
`paths` object. 19 unique paths × their HTTP methods = 25 total operations,
matching every operation required by this prompt with none missing.
(Prompt 002A's own evidence file described this as "19 REST endpoints",
which conflated the path count with the operation count - corrected here.)

**Lifecycle HTTP status confirmation:** all 8 organization
activate/suspend/recover/close/update-metadata handlers, all 4 company
lifecycle handlers, and all 4 operating-unit lifecycle handlers return
`200`, not NestJS's `@Post()` default of `201` - this was the exact defect
found and fixed in Prompt 002A itself (see that prompt's evidence file,
section 5, defect #6) and remains fixed; re-verified in this prompt's full
test run (section 9).

## 8. Security-test evidence (real PostgreSQL, no mocks)

`tests/integration/tenant-isolation-rls.integration.test.ts` gained a
second `describe` block, `platform.organizations tenant-boundary hardening`
(10 new tests, all passing):

```
✓ erp_runtime with no organization context sees zero organizations (fails closed, not open)
✓ erp_runtime scoped to A cannot read organization B by id, and can read its own row
✓ erp_runtime scoped to A cannot update organization B (RLS + revoked write grants both apply)
✓ erp_runtime cannot insert an organization directly, scoped or not (direct-table attack fails)
✓ erp_runtime cannot change tenant_key even for its own scoped organization (immutable identity)
✓ erp_platform_admin can read and update organizations across tenants (its intended cross-tenant operation)
✓ erp_platform_admin cannot change tenant_key (immutable identity holds for the admin role too)
✓ erp_platform_admin has no grant at all on platform.companies or platform.operating_units (tenant/platform pools cannot be confused)
✓ erp_runtime has no INSERT/UPDATE grant on platform.organizations at all (tenant pool cannot perform the platform pool's job)
✓ scope set via SET LOCAL on the platform-admin connection does not affect its (unconditional) visibility, and does not leak to the next transaction on a reused connection
```

Requirement-to-evidence mapping:

| Requirement | Evidence |
|---|---|
| `erp_runtime` sees no organizations without scope | Test 1 above |
| `erp_runtime` scoped to A cannot read B | Test 2 |
| `erp_runtime` scoped to A cannot update B | Test 3 |
| `erp_runtime` cannot insert organizations | Test 4 |
| Platform administration can perform only its intended organization operations | Test 8 (no grant on companies/operating_units) |
| Platform administration cannot modify immutable identity | Test 7 |
| Tenant and platform connection pools cannot be confused | Tests 8, 9 |
| Scope does not survive transaction completion / does not leak through pool reuse | Test 10, plus the pre-existing company-level pool-reuse test in the first `describe` block |
| RLS remains effective even if a repository query forgets an organization predicate | Test 1 (a bare `SELECT * FROM platform.organizations` with no `WHERE`, no scope, returns nothing) |
| Direct-table attacks fail | Tests 4, 5, 7, 8 |
| Closed and suspended organizations reject tenant business-write eligibility | Pre-existing `apps/api/test/platform-api.integration.test.ts` tests: "rejects creating a company under a SUSPENDED organization", "rejects a display-metadata update on a CLOSED organization" (re-verified, still passing) |
| Audit and outbox records remain atomic | Pre-existing `organization-domain.integration.test.ts` "creates an organization and writes audit + outbox evidence atomically" (re-verified with the new `erp_platform_admin` connection) |
| Test authentication headers fail in normally started applications | `apps/api/test/platform-openapi.integration.test.ts`, 4 NODE_ENV variants (section 6) |
| Unknown-resource responses do not create cross-tenant existence leakage | Pre-existing `apps/api/test/platform-api.integration.test.ts` "returns the identical NOT_FOUND shape..." (re-verified) |

No PostgreSQL mocking was used anywhere in this prompt's tests - every test
above runs against the real `vercentlabs_erp_test` database via
`setupTestDatabase`/`resetTestDatabase`.

## 9. Full verification totals (this session, real runs)

| Step | Result |
|---|---|
| Migrations applied to a fresh disposable database (`0000`-`0007`) | OK |
| Migration `0007` applied to a database already at Prompt 002A state (`0000`-`0006`) | `applied=1 skipped=7` |
| Migration repeatability (`setupTestDatabase`/`resetTestDatabase` cycle, run many times across this session's test runs) | OK, no errors |
| `pnpm verify` | 8/8 steps passed |
| Unit tests (`@vercentlabs/contracts`, `@vercentlabs/database`, `@vercentlabs/platform-tenancy`, `@vercentlabs/platform-organization`, `apps/api`) | 20 apps/api unit tests (up from 16: +4 net after replacing the 2 old provider-selection tests with 5 new NODE_ENV-variant tests and adding 1 import-hygiene test), other packages unchanged from Prompt 002A (109 tests) |
| Architecture tests | 29 passed (up from 26: +3 new checks in `platform-api-boundaries.test.ts`) |
| Real-PostgreSQL integration tests (`tests/integration`) | 38 passed (up from 28: +10 new organization-boundary RLS tests) |
| `apps/api` integration tests (real Nest app + real Postgres + real compiled build) | 27 passed (up from 25: the OpenAPI/auth-boundary file now has 5 tests instead of 3, replacing the invalid "test header works against a normal process" assertion with 4 NODE_ENV-variant fail-closed checks) |
| Security-negative tests (dedicated + `tests/security` static suite) | 10 new dedicated RLS tests (section 8) + 8 pre-existing `tests/security` tests, all passing |
| API contract / OpenAPI tests | 1 test confirming 19 unique paths / ≥19 (25 operations); unchanged assertion, re-verified against the rebuilt compiled binary |
| Playwright regression suite (`pnpm test:e2e`) | 9 passed, no regression |
| Compiled web/api/worker start | `apps/api` verified via the OpenAPI integration test's real spawns (5 separate real-process starts in this run alone); `apps/web`/`apps/worker` unchanged from Prompt 002A, not touched by this prompt |
| Normal API startup rejects forged test headers | Confirmed for production, development, test (no override), and missing `NODE_ENV` - see section 6 |
| Secret scan | No matches for API keys, private keys, or AWS-style credential patterns across all changed/new files; only the previously-documented dev-placeholder passwords (`erp_runtime_dev_password`, `erp_platform_admin_dev_password`), which follow the same disclosed-placeholder pattern as `docker-compose.yml`'s own default |
| Complete diff inspection | Performed; scope matches exactly this prompt's stated concerns (1 new migration, database-connection wiring, auth-module hardening, 3 test files updated/added, 2 test files' fixtures updated for the new role split, documentation updates, this evidence file) |

Every total above reflects an actual command run in this session; none is
asserted without the corresponding command output.

## 10. Remaining limitations

- Company and operating-unit "list" endpoints do not have a dedicated
  integration test asserting pagination/filtering behavior in this prompt
  (they share the same `listOrganizationsPage`-derived implementation
  pattern already covered for organizations, and are exercised indirectly
  by other tests that call `list*` to verify created rows appear, but no
  test in this prompt specifically asserts cursor pagination for companies/
  operating units). This is a pre-existing gap from Prompt 002A, not
  introduced here, and is noted rather than silently left implicit.
- `OrganizationScope.companyId`/`operatingUnitId` remain unenforced by any
  command (documented in Prompt 002A's evidence and
  `docs/architecture/organization-tenancy-model.md`) - branch-level
  authorization narrower than "organization scope matches" is still
  SP004-SP010's responsibility.
- `erp_platform_admin`'s dev-mode password
  (`erp_platform_admin_dev_password`) is a local-development placeholder,
  matching the existing pattern for `erp_runtime_dev_password` and
  `docker-compose.yml`'s own default - production must supply
  `PLATFORM_ADMIN_DATABASE_URL` explicitly via a secrets manager, exactly
  as documented for `RUNTIME_DATABASE_URL`.
- No load/performance re-measurement was taken for the new two-pool
  connection model in this prompt; Prompt 002A's existing single-sample
  latency measurement (p50=50.2ms, p95=180.7ms) was not re-run, since this
  prompt's changes affect authorization boundaries, not query shape or
  indexing.

## 11. Status confirmations

- **SP001, SP002, SP003 remain `NOT_STARTED` / `NOT_READY`** in
  `product/registers/shared-platform.yaml`. This prompt did not modify that
  file. Final certification is still deferred until SP004-SP010 exist.
- **SP004 was not started.** No authentication, session, or identity code
  was added. `FailClosedTrustedScopeProvider` remains the entire production
  behavior; nothing in this prompt changes that.
- **No SP001-SP036 completion status was advanced.** This prompt is a
  hardening/audit pass on already-`NOT_STARTED` capabilities' engineering
  foundation, not a certification event.
- **Prompt 002A's own evidence file
  (`product/evidence/PROMPT-002A-SP001-SP003-DOMAIN.md`) contained one
  statement that became inaccurate** and is amended by a note at the top of
  that file pointing here: its section 1 described `platform.organizations`
  as having "no RLS by design", and its endpoint count ("19 REST
  endpoints") conflated unique paths with total operations. Both are
  corrected in this document (sections 1-4 and 7 respectively).
