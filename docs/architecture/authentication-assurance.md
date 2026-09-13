# Authentication assurance and step-up (SP007)

Isolated module: `platform/identity/src/assurance.ts` (deliberately
dependency-free of `totp-commands.ts`/`webauthn-commands.ts`/
`recovery-code-commands.ts` - see below). Command:
`platform/identity/src/commands/step-up-commands.ts`. Controller:
`apps/api/src/identity/controllers/step-up.controller.ts`. Error:
`StepUpRequiredError` (`packages/contracts/src/identity/domain-errors.ts`),
HTTP 403 `STEP_UP_REQUIRED`.

## Why this is a separate contract from authorization

`AuthenticatedIdentity.assuranceLevel`/`lastStepUpAt` describe **how
strongly** a session has proven who it is. They never describe **what**
that identity is allowed to do - that is SP008-SP010's job entirely. A
command that needs a step-up check still separately enforces whatever
authorization applies to the action; step-up never substitutes for it.

## The eleven action categories

```
tenant_lifecycle_change
company_closure
user_suspension_deactivation
role_permission_change
mfa_removal_reset
password_change
session_revocation_of_another_user
api_credential_management
billing_change
payroll_approval
financial_close
```

(`stepUpPurposeSchema`, `packages/contracts/src/identity/auth.ts`). This
prompt's own self-service surface only ever requests `mfa_removal_reset`
(removing an authenticator, regenerating recovery codes) and demonstrates
`password_change` in the domain integration test - the remaining
categories exist as the reusable contract for SP008-SP010 and later
business modules to call into without inventing their own step-up
mechanism.

## Two tiers, not one

- **`requireRecentAuthentication(authenticatedAt, maxAgeMs = 30min)`** -
  lighter weight. Used only for enrolling a FIRST authenticator: there is
  nothing to prove possession of yet, so proving the session's own
  authentication is recent is enough.
- **`requireStepUp(db, { userId, sessionId, purpose })`** - the full
  ceremony. Used for removing an EXISTING authenticator, regenerating
  recovery codes, and any future high-risk action. Requires an ACTIVE,
  unexpired grant in `auth.step_up_tokens` for that exact session and
  purpose.

Both throw `StepUpRequiredError` on failure, never silently degrade or
substitute a weaker check.

## Completing a step-up

```
POST /api/v1/identity/step-up/complete
  { method: 'PASSWORD_TOTP', purpose, password, code }
  { method: 'WEBAUTHN',      purpose, credential }
  { method: 'RECOVERY_CODE', purpose, code }
```

`completeStepUp` re-verifies the chosen factor using the SAME shared
verification functions the login pipeline uses
(`verifyTotpCode`/`verifyWebAuthnAuthenticationAssertion`/
`consumeRecoveryCodeIfValid`), then:

1. Inserts a short-lived, purpose-scoped grant into `auth.step_up_tokens`.
2. Upgrades the CALLING session's own `assurance_level` to `AAL2` and
   records `last_step_up_at`/`last_step_up_purpose` on that same row (see
   [session-model.md](session-model.md)).

A step-up grant is scoped to one session and one purpose - a grant for
`mfa_removal_reset` does not satisfy a `password_change` check, even on the
same session (`tests/integration/identity-auth-domain.integration.test.ts`
proves this explicitly).

## Why `assurance.ts` is isolated

`step-up-commands.ts` needs to import the TOTP/WebAuthn/recovery-code
verification functions (to re-verify a factor during step-up completion).
Those same modules need `requireStepUp`/`requireRecentAuthentication` (to
gate credential removal). Putting the two "require" functions inside
`step-up-commands.ts` itself would create a circular import the moment
`totp-commands.ts` tried to import back from it. `assurance.ts` contains
ONLY the two pure `require*` functions and imports nothing from any command
file - both sides import from it, and it imports from neither.

## Never returns authenticator material

`StepUpRequiredError.acceptableMethods` lists only method NAMES
(`'PASSWORD_TOTP' | 'WEBAUTHN' | 'RECOVERY_CODE'`) - never a challenge,
secret, or any other authenticator material. The HTTP error envelope
surfaces `purpose`/`acceptableMethods` via `error.meta`
(`apps/api/src/common/filters/all-exceptions.filter.ts`), letting a client
UI know what to ask the user for next without a separate lookup call.
