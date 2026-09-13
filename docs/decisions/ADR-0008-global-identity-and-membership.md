# ADR-0008: A global identity model, separate from tenant membership and from any role

## Status

Accepted and implemented (SP004, Prompt 002B).

## Context

SP001-SP003 established organizations/companies/operating units as
tenant-scoped entities under `platform`/`tenant` schemas. Prompt 002B needed
to add real people who can authenticate - but a person is not naturally
scoped to one organization the way a company is: the same human may belong
to more than one organization over time (or, eventually, at once), and
"who this person is" must survive even if every membership they hold is
later removed.

A second, sharper problem: root governance rule 15 forbids marking an SP
complete without acceptance evidence, and SP008-SP010 (roles, permissions,
platform-operator authority) are explicitly out of scope for this prompt.
Any identity model built now had to be structurally incapable of smuggling
in a shadow authorization system - an `isAdmin` boolean, a `role` column, or
any field that later collides with what SP008 is supposed to own.

## Decision

Identity lives in its own `identity` schema, entirely separate from
`platform`/`tenant`:

- `identity.users` - one immutable UUID per human, global status
  (`INVITED`/`ACTIVE`/`SUSPENDED`/`DEACTIVATED`), a `security_stamp` UUID
  that changes on any security-relevant event, and NO role/permission field
  of any kind (see `platform/identity/src/schema/identity.ts`,
  `platform/identity/src/status.ts`).
- `identity.user_email_addresses` - `email_normalized` is globally unique
  (not per-organization), with deterministic normalization (lowercase +
  trim only - explicitly **not** Gmail-style dot/plus-address collapsing,
  since that is a provider-specific heuristic, not a real equivalence; see
  `platform/identity/src/normalize-email.ts`). Exactly one row per user may
  have `is_primary = true` (a partial unique index).
- `identity.organization_memberships` - links a user to an organization
  with only a status (`ACTIVE`/`REMOVED`) and timestamps. No role, no
  permission, no company/branch scoping. This is deliberately the ENTIRE
  membership model until SP008 exists.
- `identity.user_invitations` / `identity.user_lifecycle_history` - an
  invitation is org-scoped (it always creates a membership row on
  acceptance) but the resulting user identity is global.

`AuthenticatedIdentity` (`packages/contracts/src/identity/session-context.ts`)
is the only thing SP004-SP007 ever hands to a controller: `userId`,
`sessionId`, `assuranceLevel`, `authenticatedAt`, `lastStepUpAt`, and
`organizationMemberships` (an array of organization ids the user currently
holds an ACTIVE membership for - membership only, never a permission). It is
a completely separate type from `TrustedScope`
(`packages/contracts/src/actor.ts`), which remains the SP001-SP003
control-plane's own authorization primitive, still guarded by
`FailClosedTrustedScopeProvider`/`TrustedScopeGuard`, untouched by this
prompt.

Lockout is modeled separately from lifecycle: a `SUSPENDED` user has a
`status_reason` but rate-limiting/lockout bookkeeping lives in
`auth.authentication_attempts`, keyed by the normalized email
("identity_key"), not on the `users` row - a user is never "locked" as a
lifecycle state, only rate-limited for a bounded window (see ADR-0011 and
`docs/security/password-security.md`).

## Consequences

- Any future SP008 role/permission model attaches to
  `identity.organization_memberships` (or a new table referencing it) -
  it never needs to touch `identity.users` at all, and nothing in
  SP004-SP007 assumes a role exists.
- A user can be invited to a second organization without creating a second
  identity - `acceptInvitation` for an already-existing verified email
  attaches a new membership row rather than erroring (see
  `platform/identity/src/commands/invitation-commands.ts`).
- Two new least-privilege database roles enforce this boundary at the SQL
  level: `erp_auth_pipeline` (unscoped - pre-authentication lookups by email
  or token) and `erp_identity_runtime` (RLS-scoped on a new
  `app.current_user_id` session variable, set via
  `withUserScope`/`SET LOCAL`, exactly mirroring `app.current_organization_id`
  from ADR-0006). See `database/migrations/platform/0012_create_identity_auth_runtime_grants_and_rls.sql`.
