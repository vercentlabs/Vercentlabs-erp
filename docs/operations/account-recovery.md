# Account recovery (SP007)

Commands: `platform/identity/src/commands/password-commands.ts`
(`requestPasswordReset`, `validateResetToken`, `completePasswordReset`).
Controller: `apps/api/src/identity/controllers/verification.controller.ts`.

## Password reset flow

```
POST /api/v1/identity/password/request-reset       { email }
POST /api/v1/identity/password/validate-reset-token { token }
POST /api/v1/identity/password/complete-reset       { token, newPassword }
```

1. **Request.** `requestPasswordReset` looks up the email. If - and only
   if - a real, `ACTIVE` account with that email exists, a single-use,
   SHA-256-hashed opaque token is minted (`auth.password_reset_tokens`)
   and emailed via the configured `EmailProvider`. **Whether or not the
   account exists, the HTTP response is identical**: `202 { requested:
   true }`. No timing difference is introduced either - both branches do
   comparable database work.
2. **A second request invalidates the first.** `invalidateOtherPasswordResetTokens`
   marks every OTHER unconsumed token for that user invalidated the moment
   a new one is issued - only the newest requested token is ever valid,
   closing the window where an old, possibly-leaked reset link stays live
   indefinitely.
3. **Validate (optional, for UI).** `validateResetToken` reports whether a
   token is currently usable, without consuming it - lets a reset-password
   page show "this link has expired" before the user types a new password.
4. **Complete.** `completePasswordReset` re-validates the token
   (unconsumed, not invalidated, not expired), atomically consumes it (a
   conditional `UPDATE ... WHERE consumed_at IS NULL RETURNING *` - single
   use, race-safe), sets the new password hash, and revokes **every**
   session for that user (`bumpSecurityStampAndRevokeSessions`) - any
   session that existed before the reset, including one an attacker may
   have been holding, is dead immediately.

## No security questions, anywhere

There is no security-question mechanism in this system, in the reset flow
or anywhere else. Security questions have low, guessable, and often
publicly-discoverable answer entropy and are explicitly excluded by
current OWASP/NIST guidance.

## Open-redirect prevention

The password-reset and email-verification flows never accept or honor a
client-supplied redirect target. `validateResetToken`/`completePasswordReset`
operate purely on the opaque token; there is no `returnTo`/`redirect`
parameter anywhere in these request schemas
(`packages/contracts/src/identity/auth.ts`) for a malicious link to abuse.

## Email verification and resend

```
POST /api/v1/identity/email/verify              { token }
POST /api/v1/identity/email/resend-verification { email }
```

Accepting a mailed invitation link IS the email-ownership proof
(`acceptInvitation` sets `verified_at` directly) - `verify`/`resend` exist
for the case where an email needs to be (re-)confirmed independently of
invitation acceptance (e.g. a forced re-verification after some
administrative action). `resend-verification` follows the same
identical-response anti-enumeration shape as password reset.

## Email delivery

All of the above depends on `EmailProvider`
(`platform/identity/src/email/email-provider.ts`). Production - and every
other environment, including local development - registers
`FailClosedEmailProvider` unconditionally
(`apps/api/src/identity/email/email-provider.module.ts`); there is no
`NODE_ENV` branch that silently treats an email as "sent" without a real
provider configured. SP018 (the real transactional-email platform) is
`NOT_STARTED` - until it exists, any environment that actually needs emails
delivered must explicitly wire a real provider. Tests use
`InMemoryEmailProvider` via an explicit
`Test.createTestingModule(...).overrideProvider(EMAIL_PROVIDER).useValue(...)`
override - the same explicit-test-override pattern established for
`TRUSTED_SCOPE_PROVIDER` in Prompt 002A-H.

## Credential-compromise response

See [credential-compromise-response.md](credential-compromise-response.md).
