# Authentication flows (SP005/SP006/SP007)

Controllers: `apps/api/src/identity/controllers/auth.controller.ts`,
`verification.controller.ts`. Commands:
`platform/identity/src/commands/authentication-commands.ts`,
`password-commands.ts`, `invitation-commands.ts`,
`email-verification-commands.ts`.

## Login (password-first, optional MFA second factor)

```
POST /api/v1/identity/auth/login  { email, password }
```

1. `login()` looks up the email (`erp_auth_pipeline`, unscoped - a lookup
   BY email cannot itself be user-scoped), checks rate limits
   (`auth.authentication_attempts`), verifies the account can accept a
   session (`canCreateSession`, `status.ts`), verifies the email is
   verified, and verifies the password (Argon2id).
2. Any failure at any of those steps throws the SAME
   `AuthenticationFailedError` -> HTTP 401, generic message. The real
   reason is recorded in `auth.authentication_attempts` only.
3. If the password is correct and MFA is NOT enabled: a session is created
   (`createFullSession`) at `AAL1`, and `AuthController.login` sets the
   session cookie and returns `{ outcome: 'AUTHENTICATED', assuranceLevel }`.
4. If MFA IS enabled (a confirmed TOTP credential or an active WebAuthn
   credential): a short-lived `mfaToken` is minted
   (`auth.mfa_login_tokens`) and the response is
   `{ outcome: 'MFA_REQUIRED', mfaToken, availableMethods }` - no cookie is
   set yet.

## Completing an MFA login

```
POST /api/v1/identity/auth/mfa/webauthn/begin  { mfaToken }   (only for method: WEBAUTHN)
POST /api/v1/identity/auth/mfa/complete        { mfaToken, method, code | credential }
```

`beginMfaWebAuthnChallenge` resolves the `mfaToken` to a user WITHOUT
consuming it (a wrong or abandoned WebAuthn attempt must not burn the
token) and returns a normal WebAuthn authentication challenge scoped to
that user's registered credentials. `completeMfaLogin` verifies the
supplied factor (TOTP/WebAuthn/recovery code), consumes the `mfaToken`
exactly once on success, and creates the session - `AAL2` for TOTP/WebAuthn,
`AAL1` for a recovery code (see [ADR-0010](../decisions/ADR-0010-webauthn-totp-and-recovery.md)).

## Logout

```
POST /api/v1/identity/auth/logout       - revokes the CURRENT session only
POST /api/v1/identity/auth/logout-all   - revokes EVERY session for the user
```

Both require `SessionAuthGuard` and clear the session cookie.

## Password change (authenticated self-service)

```
POST /api/v1/identity/auth/password/change  { currentPassword, newPassword }
```

Requires the CURRENT password (not step-up - a user always knows their own
current password by definition). Revokes every session for the user,
**including the one making this request** - the caller's own cookie is
dead the instant this succeeds, which is why `AuthController.changePassword`
also clears it in the same response.

## Invitation acceptance / email verification / password reset

```
POST /api/v1/identity/invitations/accept          { token, displayName, password }
POST /api/v1/identity/email/verify                { token }
POST /api/v1/identity/email/resend-verification   { email }
POST /api/v1/identity/password/request-reset      { email }
POST /api/v1/identity/password/validate-reset-token { token }
POST /api/v1/identity/password/complete-reset     { token, newPassword }
```

All run under `erp_auth_pipeline` (no session exists yet) via
`VerificationController`. `request-reset` and `resend-verification` return
the identical response (`202 { requested: true }`) whether or not the
account exists - see [account-recovery.md](../operations/account-recovery.md).
There is deliberately no HTTP endpoint to CREATE an invitation in this
prompt - see [identity-model.md](identity-model.md)'s closing section.

## What is NOT built in this prompt

- Passwordless first-factor login via WebAuthn alone (i.e. signing in with
  only a passkey, no password step first). The commands built here treat
  WebAuthn strictly as a second factor and as a step-up method; a
  standalone "identify yourself by presenting a passkey with no prior
  password step" flow would need a way to resolve a credential to a user
  without already knowing their email, which is a separate design surface
  left for a future prompt. See the evidence file's "known limitations".
