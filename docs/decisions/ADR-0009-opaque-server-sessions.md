# ADR-0009: Opaque server-side sessions, never JWT or localStorage

## Status

Accepted and implemented (SP006, Prompt 002B).

## Context

SP006 requires session/device security strong enough to support revocation
(logout, logout-all, admin-forced revocation on suspension, security-stamp
invalidation) at any time, for any session, immediately. A JWT-based
"session" cannot do this without a separate revocation-list side channel
that then becomes the real source of truth anyway - at which point the JWT
itself is redundant complexity, not a simplification. `localStorage` is
also excluded outright: it is readable by any script on the page, making it
directly exposed to XSS in a way an `HttpOnly` cookie is not.

## Decision

A session is a real, mutable row in `auth.sessions`
(`database/migrations/platform/0010_create_auth_sessions_and_tokens.sql`):
`id`, `user_id`, `token_hash`, `security_stamp` (copied from the user at
creation), `assurance_level` (`AAL1`/`AAL2`), `authenticated_at`,
`last_seen_at`, `expires_at` (24h absolute), `inactivity_expires_at` (1h
inactivity), `revoked_at`/`revocation_reason`.

The token itself: `generateOpaqueToken()`
(`platform/identity/src/crypto/token-hash.ts`) produces a ≥256-bit
cryptographically random value. The RAW value is shown to the client
exactly once - as the cookie value at login/MFA-completion - and the server
only ever stores its SHA-256 hash (`hashToken`, same file). A leaked
database backup therefore never yields a usable session token, and a
timing-safe hash lookup replaces the need for a timing-safe raw-token
comparison.

Cookie mechanics (`apps/api/src/identity/auth/session-cookie.ts`):
`httpOnly: true`, `secure: true` outside the explicit
`SESSION_COOKIE_INSECURE_LOCAL_HTTP=true` local-HTTP-development escape
hatch, `sameSite: 'lax'` (defense in depth only - see ADR below on CSRF),
`path: '/'`, no `Domain` attribute, and the `__Host-` name prefix whenever
`Secure` is set (`__Host-vlerp_session`; falls back to `vlerp_session` only
for local plain-HTTP dev, since browsers reject a `Secure` cookie entirely
over plain HTTP).

Validation (`apps/api/src/identity/auth/session-auth.guard.ts`,
`SessionAuthGuard`) is a real, un-cached database read on every request: no
cookie -> 401; unknown/expired/revoked row -> 401; the row's
`security_stamp` no longer matching the user's current one -> 401 (implicit
invalidation - a password change, suspension, or MFA reset invalidates
every existing session even if none of them were explicitly revoked, since
`bumpSecurityStampAndRevokeSessions` also explicitly revokes them - the
stamp check is the second, independent layer). `last_seen_at` is only
written when it is more than 5 minutes stale, to avoid a write on every
single request.

Session lifecycle commands (`platform/identity/src/commands/session-commands.ts`,
`authentication-commands.ts`) cover create (login/MFA-completion), rotate
(assurance upgrade on step-up - a NEW `assurance_level`/`last_step_up_at`
on the SAME row, not a new token, since step-up elevates an existing
session rather than replacing it), logout (one session), logout-all (every
session for the user), list, and revoke (one or "all but this one").

## Consequences

- Revocation is immediate and real: `revoked_at IS NOT NULL` is checked on
  every single request, not eventually-consistent via token expiry.
- Every session mutation goes through `erp_identity_runtime` under
  `withUserScope`, so RLS enforces that a user can only ever see or revoke
  their own sessions at the database layer, independent of application-code
  correctness (`database/migrations/platform/0012_create_identity_auth_runtime_grants_and_rls.sql`).
- `tests/integration/identity-auth-domain.integration.test.ts` proves, against
  real PostgreSQL: suspend-revokes-sessions, password-change-revokes-sessions,
  password-reset-revokes-sessions, list/revoke/revoke-others, and
  logout vs. logout-all's differing blast radius.
