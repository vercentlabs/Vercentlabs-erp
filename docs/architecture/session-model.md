# Session model (SP006)

Schema: `database/migrations/platform/0010_create_auth_sessions_and_tokens.sql`
(`auth.sessions`). Guard: `apps/api/src/identity/auth/session-auth.guard.ts`.
Cookie mechanics: `apps/api/src/identity/auth/session-cookie.ts`. Commands:
`platform/identity/src/commands/session-commands.ts`,
`authentication-commands.ts`.

See [ADR-0009](../decisions/ADR-0009-opaque-server-sessions.md) for why
sessions are opaque server-side rows rather than JWTs.

## The cookie

- Name: `__Host-vlerp_session` normally; `vlerp_session` only when
  `SESSION_COOKIE_INSECURE_LOCAL_HTTP=true` (local plain-HTTP development -
  browsers reject a `Secure` cookie over plain HTTP entirely, and `__Host-`
  requires `Secure`).
- `httpOnly: true` - never readable by page JavaScript.
- `secure: true` outside the local-HTTP escape hatch.
- `sameSite: 'lax'` - **defense in depth only**. The real CSRF protection is
  Origin-header validation (`CsrfGuard`); see
  [session-and-csrf-security.md](../security/session-and-csrf-security.md).
- `path: '/'`, no `Domain` attribute.
- The raw token is a ≥256-bit cryptographically random value
  (`generateOpaqueToken`, `platform/identity/src/crypto/token-hash.ts`),
  shown to the client exactly once (set as the cookie value at login/MFA
  completion). The server only ever stores its SHA-256 hash
  (`token_hash` column) - never the raw value.

## Validation (`SessionAuthGuard`, every protected route)

On every request:

1. No cookie -> 401.
2. Hash the presented token, look up `auth.sessions` by `token_hash`.
   Unknown, or `revoked_at IS NOT NULL` -> 401.
3. `expires_at` (24h absolute) or `inactivity_expires_at` (1h since last
   activity) in the past -> 401.
4. The owning user is not `ACTIVE` -> 401.
5. The session's stored `security_stamp` no longer matches the user's
   CURRENT `security_stamp` -> 401 ("session no longer valid" - implicit
   invalidation: a password change, suspension, or credential reset
   regenerates the user's stamp, so every session created before that event
   fails this check even if it was never explicitly revoked as a
   belt-and-suspenders second layer alongside the explicit revocation that
   `bumpSecurityStampAndRevokeSessions` also performs).
6. If more than 5 minutes have passed since `last_seen_at`, it is updated
   (avoids a write on every single request).
7. `request.identity` is populated with the real `AuthenticatedIdentity`
   (`userId`, `sessionId`, `assuranceLevel`, `authenticatedAt`,
   `lastStepUpAt`, `organizationMemberships`) - read via
   `@CurrentIdentity()` in every controller.

There is no default/open identity on any failure path - every branch above
throws `UnauthorizedException`.

## Assurance levels

- `AAL1`: password-only, or a recovery-code-completed MFA login.
- `AAL2`: TOTP- or WebAuthn-completed MFA login, or a session that has
  completed a step-up ceremony (`upgradeSessionAssurance` sets
  `assurance_level`, `last_step_up_at`, `last_step_up_purpose` on the SAME
  session row - step-up elevates an existing session, it does not issue a
  new one).

## Session CRUD

```
GET  /api/v1/identity/sessions               list this user's active sessions
POST /api/v1/identity/sessions/revoke        revoke one specific session by id
POST /api/v1/identity/sessions/revoke-others revoke every session except the caller's
POST /api/v1/identity/auth/logout            revoke the caller's own session
POST /api/v1/identity/auth/logout-all        revoke every session for the user
```

All run under `erp_identity_runtime` via `withUserScope`, so PostgreSQL RLS
(not just application code) guarantees a user can only ever see or revoke
their own sessions - see
`database/migrations/platform/0012_create_identity_auth_runtime_grants_and_rls.sql`.
`revokeOwnSession` returns the identical `DomainNotFoundError` whether the
session id is unknown or belongs to another user - RLS already makes the
underlying `SELECT` return no row for another user's session either way.
