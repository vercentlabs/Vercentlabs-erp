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

No code path in this prompt grants `kind: 'platform_operator'` to anything.
The only two `TrustedScopeProvider` implementations are:

- `FailClosedTrustedScopeProvider` (production): always returns `null`.
- `TestTrustedScopeProvider` (non-production only): resolves whatever a
  caller's `x-test-trusted-scope` header says, including
  `kind: 'platform_operator'`, purely so tests can exercise operator-only
  commands without SP004-SP010 existing yet.

In other words: **in a real deployment today, nothing can act as a platform
operator, because nothing can authenticate as anything at all.** This is
correct and intentional - SP004-SP010 do not exist, so no request should be
trusted, let alone trusted with operator authority.
`tests/architecture/platform-api-boundaries.test.ts` enforces this
structurally: no file outside `apps/api/src/platform/auth` (and test files)
may contain a literal `kind: 'platform_operator'`/`kind: 'organization'`
construction, and `TestTrustedScopeProvider` may only be referenced from
`platform-auth.module.ts` and test files.

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

Because `platform.organizations` has no RLS (see
[tenant-isolation.md](tenant-isolation.md)), a genuine platform-operator
scope can read/write every organization's row in that table by design -
that is what the role is for. It **cannot**, however, read or write
`platform.companies`/`platform.operating_units` rows across tenants for
free: those queries still go through `withOrganizationScope`, and every
company/operating-unit command besides organization-level ones requires an
`OrganizationScope`, not a `PlatformOperatorScope` - see
`requireOrganizationScopeMatching` in
`platform/organization/src/commands/company-commands.ts` and
`operating-unit-commands.ts`. A compromised operator credential is a serious
incident (full control over organization lifecycle), but it is not
automatically full control over every tenant's business data underneath
that organization.
