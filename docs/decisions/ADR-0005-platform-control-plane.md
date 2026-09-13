# ADR-0005: A platform-operator control plane, separate from tenant scope

## Status

Accepted and implemented (SP001 organization commands/queries).

## Context

SP001 needs someone to create, activate, suspend, recover, and close
organizations - operations that are, by definition, cross-tenant (an
organization does not yet exist as a tenant when it's being created, and
suspending one is an action taken *on* a tenant from outside it). SP004-SP010
(authentication/authorization) do not exist yet, so there is no real
identity to grant this authority to. We still needed the domain layer and
API shaped correctly now, not retrofitted once SP004-SP010 lands.

## Decision

- `TrustedScope` is a discriminated union of `PlatformOperatorScope` and
  `OrganizationScope` (`packages/contracts/src/actor.ts`), not one loose
  object with optional fields. `PlatformOperatorScope` never carries an
  `organizationId` - it is cross-tenant by construction, not "tenant-scoped
  to nothing in particular".
- Every SP001 command/query explicitly checks
  `isPlatformOperatorScope(scope)` and throws `DomainForbiddenError`
  otherwise. Company/operating-unit (SP002/SP003) commands require
  `OrganizationScope` instead, via `requireOrganizationScopeMatching`.
- Today, in production, nothing can ever construct a `PlatformOperatorScope`
  - see [trusted-request-context.md](../architecture/trusted-request-context.md)
  and [platform-operator-boundary.md](../security/platform-operator-boundary.md)
  for the full reasoning. This ADR is about the *shape* of the control
  plane; those documents cover how it's guarded until SP004-SP010 exist.

## Consequences

- Future SP004-SP010 work grants `platform_operator` scope to some real
  identity/credential; it does not need to change any SP001-SP003 command,
  query, or controller - the seam is already the right shape.
- `platform.organizations` deliberately has no Row-Level Security policy
  (see [tenant-isolation.md](../security/tenant-isolation.md)) - it is
  authorized at the application layer via `isPlatformOperatorScope`, not
  filtered at the row level, since there is no `organization_id` to filter
  by on the tenant-boundary table itself.
- `tests/architecture/platform-api-boundaries.test.ts` enforces that no code
  outside the auth boundary can fabricate a `platform_operator` (or
  `organization`) scope literal, so this separation cannot silently erode as
  the codebase grows.
