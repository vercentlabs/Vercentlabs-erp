# The platform-operator boundary

A `platform_operator`-kind `TrustedScope` (see
[trusted-request-context.md](../architecture/trusted-request-context.md)) is
the only scope permitted to create, activate, suspend, recover, close, get,
or list organizations (`platform/tenancy`'s commands/queries all start with
`if (!isPlatformOperatorScope(input.scope)) throw new DomainForbiddenError(...)`).
It is deliberately the most powerful scope in the system - cross-tenant by
definition - so it needs its own explicit boundary discussion, separate from
ordinary organization-scoped tenant isolation.

## There is no way to become a platform operator today

No code path in a normally started process grants `kind:
'platform_operator'` to anything. `PlatformAuthModule` registers
`FailClosedTrustedScopeProvider` unconditionally - not "in production", not
"unless a header says otherwise": **always**, regardless of `NODE_ENV`.
`TestTrustedScopeProvider` (which would resolve a caller's
`x-test-trusted-scope` header, including `kind: 'platform_operator'`) is
never referenced by `PlatformAuthModule` at all; the only way it becomes
active is a test's own explicit
`Test.createTestingModule(...).overrideProvider(TRUSTED_SCOPE_PROVIDER).useClass(TestTrustedScopeProvider)`
call (see
[trusted-request-context.md](../architecture/trusted-request-context.md)).

**Prompt 002A-H correction:** an earlier version of `PlatformAuthModule`
selected `TestTrustedScopeProvider` whenever `NODE_ENV !== 'production'` -
meaning a plain local `dev` run, a misconfigured staging deployment, or
simply forgetting to set `NODE_ENV` would have silently accepted the test
header and let a caller become a platform operator by sending one HTTP
header. This was found and fixed before it ever shipped past this
repository - see
[product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md](../../product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md).
`apps/api/test/platform-openapi.integration.test.ts` now proves, against
the real compiled build, that a forged header is rejected under
production, development, test (without an explicit override), and a
missing `NODE_ENV` alike.

In other words: **in a real deployment today, nothing can act as a platform
operator, because nothing can authenticate as anything at all.** This is
correct and intentional - SP004-SP010 do not exist, so no request should be
trusted, let alone trusted with operator authority.
`tests/architecture/platform-api-boundaries.test.ts` enforces this
structurally: no file outside `apps/api/src/platform/auth` (and test files)
may contain a literal `kind: 'platform_operator'`/`kind: 'organization'`
construction; `TestTrustedScopeProvider` may only be imported from its own
definition file and test files (never `platform-auth.module.ts`); and
`platform-auth.module.ts` must register `FailClosedTrustedScopeProvider` as
a static `useClass`, with no `NODE_ENV` branch anywhere in the file.

## What SP004-SP010 must decide (not decided here)

This prompt does not decide *how* a real user or service becomes a platform
operator - that is an SP004-SP010 design question (a distinct role/claim on
an authenticated identity, a separate service credential, etc.). What this
prompt fixes in place, so that future decision has a stable target: the
`PlatformOperatorScope` shape itself, and the fact that every operator-only
command checks for it explicitly rather than inferring elevated access from
the absence of an `organizationId` or some other implicit signal.

## Why platform-operator scope never carries an `organizationId`

`PlatformOperatorScope` has no `organizationId` field at all (see the type
in `packages/contracts/src/actor.ts`) - not an optional one, an absent one.
An operator command that needs to act on a specific organization (e.g.
`activateOrganization`) takes `organizationId` as an explicit input
parameter, resolved from the URL path, not from the scope. This prevents a
class of bug where "operator scope with organizationId X" could be
misread as "tenant-scoped to X" by code that only checks for the field's
presence rather than the scope's `kind`.

## Blast radius if this boundary were ever breached

A genuine platform-operator scope, once it exists (post-SP004-SP010), can
read/write every organization's row in `platform.organizations` by design -
that is what the role is for, now backed by an explicit RLS policy scoped
to the `erp_platform_admin` database role rather than no RLS at all (see
[tenant-isolation.md](tenant-isolation.md)). It **cannot**, however, read or
write `platform.companies`/`platform.operating_units` rows across tenants
for free, for two independent reasons:

1. **Application layer**: those queries still go through
   `withOrganizationScope`, and every company/operating-unit command besides
   organization-level ones requires an `OrganizationScope`, not a
   `PlatformOperatorScope` - see `requireOrganizationScopeMatching` in
   `platform/organization/src/commands/company-commands.ts` and
   `operating-unit-commands.ts`.
2. **Database layer**: `erp_platform_admin` - the role a compromised
   operator credential would actually be exploiting - has **no grant at
   all** on `platform.companies` or `platform.operating_units`. Even a
   direct-SQL attack using leaked `erp_platform_admin` credentials, bypassing
   the application entirely, gets `permission denied` on both tables (see
   `tests/integration/tenant-isolation-rls.integration.test.ts`).

A compromised operator credential is a serious incident (full control over
organization lifecycle), but it is not automatically full control over
every tenant's business data underneath that organization - that separation
now holds at the database level, not only in application code.
