# Identity model (SP004)

Real, checked-in schema: `database/migrations/platform/0008_create_identity_schema.sql`.
Domain package: `platform/identity/src/schema/identity.ts`,
`repository/users.ts`, `repository/invitations.ts`,
`commands/invitation-commands.ts`.

## Why identity is global, not tenant-scoped

SP001-SP003 modeled organizations/companies/operating units as
tenant-scoped entities. A person is not: the same human can be invited to
more than one organization, and their identity (and its history) must
survive independently of any one membership. See
[ADR-0008](../decisions/ADR-0008-global-identity-and-membership.md) for the
full reasoning.

## Tables

```
identity.users
  id                 uuid primary key
  status             ACTIVE | INVITED | SUSPENDED | DEACTIVATED
  status_reason      text, nullable
  display_name       text, nullable
  security_stamp     uuid, regenerated on any security-relevant event
  version             integer (optimistic concurrency)
  created_at / updated_at / deactivated_at / suspended_at
  created_by / updated_by

identity.user_email_addresses
  id               uuid primary key
  user_id          uuid -> identity.users
  email_original   text (as the user typed it)
  email_normalized text, GLOBALLY UNIQUE (lowercase + trim only - see below)
  is_primary       boolean (partial unique index: at most one true per user)
  verified_at      timestamptz, nullable

identity.organization_memberships
  id               uuid primary key
  user_id          uuid -> identity.users
  organization_id  uuid  (references platform.organizations, cross-schema
                          by convention, not a role/permission of any kind)
  status           ACTIVE | REMOVED
  created_at / removed_at

identity.user_invitations
  id               uuid primary key
  organization_id  uuid
  email_normalized text
  token_hash       text (SHA-256 of a single-use opaque token; the raw
                         token is NEVER stored)
  status           PENDING | ACCEPTED | EXPIRED | REVOKED
  expires_at       timestamptz
  accepted_at      timestamptz, nullable

identity.user_lifecycle_history
  append-only log of every status transition, who caused it, and why.
```

## No `isAdmin`, no role, no permission

Nothing in this schema or in `AuthenticatedIdentity`
(`packages/contracts/src/identity/session-context.ts`) encodes a role or a
permission. `organization_memberships` is deliberately a membership record
and nothing more - SP008 owns the entire role/permission model and attaches
to this table (or a new one referencing it) without needing to change
anything here.

## Email normalization

`platform/identity/src/normalize-email.ts` normalizes to lowercase and
trims whitespace - and nothing else. There is **no** Gmail-style
dot-removal or plus-addressing collapse: `a.b@gmail.com` and `ab@gmail.com`
are treated as distinct addresses, because that equivalence is a
provider-specific heuristic, not a real one, and silently merging two
addresses a user believes are different is itself a security-relevant
surprise.

## Invitations

`createInvitation` (`platform/identity/src/commands/invitation-commands.ts`)
mints a single-use, high-entropy opaque token (`generateOpaqueToken` /
`hashToken`, `crypto/token-hash.ts`), storing only its SHA-256 hash.
`acceptInvitation`:

1. Looks up the invitation by token hash, rejecting an unknown/expired/
   already-accepted token with `InvalidOrExpiredTokenError`.
2. Atomically claims the invitation (a conditional `UPDATE ... WHERE status
   = 'PENDING' RETURNING *`) so two concurrent accept attempts for the same
   token can only ever let one through -
   `tests/integration/identity-auth-domain.integration.test.ts` proves this
   under a real concurrent race.
3. Creates the user (if the email is new) or attaches a new membership (if
   the email already belongs to an existing identity), sets the email
   `verified_at` (accepting a mailed invitation link IS the ownership
   proof), and creates the password credential.

## Lockout is not a lifecycle state

A `SUSPENDED`/`DEACTIVATED` user is an explicit, administrator-driven
lifecycle transition, recorded in `user_lifecycle_history`. Failed-login
rate-limiting (`auth.authentication_attempts`) is a completely separate,
time-bounded mechanism - see
[ADR-0011](../decisions/ADR-0011-argon2id-password-storage.md) and
[password-security.md](../security/password-security.md). A user is never
"locked out" as a `users.status` value.

## What SP004 does not do (yet)

There is no HTTP endpoint for `createInvitation`, `suspendUser`, or any
other administrative lifecycle command in this prompt - SP001-SP003's
administration surface stays fail-closed to ordinary authenticated users
until SP008-SP010 supplies a real role/permission model. These commands
exist and are fully tested at the domain layer
(`tests/integration/identity-auth-domain.integration.test.ts`) but are only
reachable today via direct command invocation (e.g. from a future admin
tool or a script run by a platform operator with database access), never
via a public route.
