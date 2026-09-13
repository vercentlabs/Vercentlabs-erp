# Organization, company and operating-unit tenancy model

Status: SP001 (organization/tenant lifecycle), SP002 (company/legal-entity
structure) and SP003 (branch/site/operating-unit context) domain, database
and API foundations are implemented and verified against real PostgreSQL -
see [`product/evidence/PROMPT-002A-SP001-SP003-DOMAIN.md`](../../product/evidence/PROMPT-002A-SP001-SP003-DOMAIN.md).
They remain `NOT_STARTED`/`NOT_READY` in
[`product/registers/shared-platform.yaml`](../../product/registers/shared-platform.yaml)
until SP004-SP010 (authentication/authorization) exist to protect them for
real; see [ADR-0004](../decisions/ADR-0004-evidence-based-feature-status.md).

## The three entities

```
Organization (SP001, platform.organizations)
  └─ Company (SP002, platform.companies)         [1 organization : N companies]
       └─ OperatingUnit (SP003, platform.operating_units)
            └─ OperatingUnit (self-referencing parent_operating_unit_id)
```

- **Organization** is the tenant boundary. Every row anywhere in the system
  that is tenant-owned ultimately scopes to exactly one organization.
  `tenantKey` is the human-assigned, immutable (DB-enforced, see
  [tenant-isolation.md](../security/tenant-isolation.md)) external
  identifier; `id` is the internal UUID used everywhere else.
- **Company** is a legal entity inside an organization: it owns a
  `countryCode`, `baseCurrency`, `timeZone` and `taxRegistrations` - the
  attributes that later financial/compliance modules need a stable anchor
  for. A company can never move between organizations.
- **OperatingUnit** represents a branch, site, or generic operating unit
  (`unitType`) inside a company. Operating units can nest under a parent
  operating unit *within the same company* -
  `platform.enforce_operating_unit_consistency()` (a database trigger, see
  `database/migrations/platform/0003_create_operating_units.sql`) rejects a
  parent from a different company or organization, and rejects a cycle, at
  the database layer - not only in application code.

None of these three tables model users, roles, or permissions. That is
SP004-SP010's job. This layer answers "which tenant/company/unit does this
record belong to", not "who is allowed to touch it".

## Why company and operating-unit are a separate package from organization

`platform/tenancy` owns SP001 only. `platform/organization` owns SP002+SP003
together (they share a lifecycle shape and are always read/written in the
same request context). `platform/organization` depends on `platform/tenancy`
only through its public exports (`findOrganizationById`, re-exported as
`OrganizationRow`) - see `platform/organization/src/organization-guard.ts`.
It never queries `platform.organizations` directly. This is the standing
project rule that modules interact through public commands/queries, not
private tables (root governance rule 8), applied for the first time to real
tenant-owned tables.

## Creating a company or operating unit checks the parent organization's state

`loadOrganizationAcceptingNewCompanies` (in `organization-guard.ts`) is
called *before* `createCompany`/`createOperatingUnit` claim an
Idempotency-Key: a `SUSPENDED` or `CLOSED` organization cannot accept new
companies or operating units. Existing companies/units are not
retroactively affected by a parent status change - only the *create* path
is guarded this way, matching the state machines documented in
[platform-state-machines.md](platform-state-machines.md).

## What is intentionally out of scope here

- **Row-level or field-level authorization** below "does this trusted scope's
  `organizationId` match" is SP004-SP010's responsibility.
  `OrganizationScope.companyId`/`operatingUnitId` exist in the contract
  (`packages/contracts/src/actor.ts`) as optional *further-scoping* hints for
  a future authorization layer to read; no command in this prompt enforces
  them yet.
- **Branch-level RBAC** (e.g. "this user may only act within operating unit
  X") - deferred to the same authorization work.
- **Any UI beyond a fail-closed protected-route boundary** in `apps/web` -
  see [trusted-request-context.md](trusted-request-context.md).
