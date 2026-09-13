# Credential compromise response (SP005/SP006/SP007)

What actually happens, today, when a specific credential or session is
believed compromised - and what still requires SP008-SP010 (an
administrative UI/role model) to operate at scale.

## A user suspects their password is compromised

They can, right now, self-service:

1. `POST /api/v1/identity/auth/password/change` (if they still have their
   current password) - immediately revokes every session for the account,
   including the one making the request.
2. `POST /api/v1/identity/password/request-reset` (if they don't, or want
   to force it via email) - completing the reset also revokes every
   session (see [account-recovery.md](account-recovery.md)).

Either path regenerates `identity.users.security_stamp`
(`bumpSecurityStampAndRevokeSessions`,
`platform/identity/src/commands/password-commands.ts`), which independently
invalidates any session `SessionAuthGuard` might otherwise still accept -
two layers, not one, for the same event.

## A user suspects a specific device/session is compromised

```
GET  /api/v1/identity/sessions               - see every active session, with
                                                 last-seen time, IP, user agent
POST /api/v1/identity/sessions/revoke         - kill one specific session
POST /api/v1/identity/sessions/revoke-others  - kill every OTHER session,
                                                 keeping only the current one
```

Revocation is immediate - `SessionAuthGuard` checks `revoked_at` on every
single request, not on the next token-expiry boundary.

## A user suspects an authenticator (passkey/TOTP) is compromised

Removing any MFA authenticator requires step-up
(`purpose: 'mfa_removal_reset'`) - proving a DIFFERENT currently-valid
factor first, so a stolen device alone cannot be used to also strip the
account's other protections. See
[authentication-assurance.md](../architecture/authentication-assurance.md).
Regenerating recovery codes (`POST /api/v1/identity/mfa/recovery-codes/regenerate`)
invalidates every code from every earlier batch, in case a previously
generated/downloaded batch is the thing believed compromised.

## What an operator/administrator can do (domain layer only, today)

`suspendUser` (`platform/identity/src/commands/*`, exercised in
`tests/integration/identity-auth-domain.integration.test.ts`) immediately
revokes every session for a user and moves their lifecycle status to
`SUSPENDED`, blocking all future logins with the same generic
`AuthenticationFailedError` a wrong-password attempt would produce (never
revealing "this account exists and is suspended" to the caller). **This
command has no HTTP endpoint in this prompt** - SP001-SP003's
administration surface, and any future "suspend this user" admin action,
stays fail-closed to ordinary authenticated users until SP008-SP010
supplies a real role/permission model to gate it. Until then, this is only
reachable via direct database-role access (e.g. an operator running a
script against `erp_auth_pipeline`), which is an accepted, explicitly
documented gap - see the evidence file's "known limitations" and "SP008-
SP010 dependencies" sections.

## What still requires SP008-SP010

- An admin-facing UI or API to suspend/deactivate a user, force-revoke
  their sessions, or force a password reset on someone else's behalf.
- Any bulk/fleet-wide credential-compromise response (e.g. "revoke every
  session issued before timestamp X across the whole organization").
- Audit-log review tooling beyond direct database queries against
  `audit.audit_events`.
