# MFA and account recovery (SP007)

See [ADR-0010](../decisions/ADR-0010-webauthn-totp-and-recovery.md) and
[authentication-assurance.md](../architecture/authentication-assurance.md)
for the design rationale and step-up contract. This document is the
operational/reference summary of the three MFA methods and the recovery
flow.

## WebAuthn / passkeys

- Library: `@simplewebauthn/server@14.0.2` (pinned exact version) - all
  ceremony verification (`verifyRegistrationResponse`,
  `verifyAuthenticationResponse`) is delegated to the library; nothing here
  parses or verifies a signature by hand.
- Registration requires a recent authentication
  (`requireRecentAuthentication`) for the FIRST credential, or a full
  step-up for an ADDITIONAL one once MFA is already active.
- A counter regression on an existing credential is recorded (not treated
  as an automatic account-takeover signal) - multi-device/synced passkeys
  are explicitly allowed by the FIDO spec to have a counter that never
  increments; only a single-device credential regressing would be genuinely
  suspicious, and even then this never triggers an automatic lockout.
- Removing a credential requires step-up
  (`purpose: 'mfa_removal_reset'`).

## TOTP

- Library: `otpauth@9.5.2` (pinned exact version). SHA-1, 6 digits, 30
  second period, ±1 step window for clock skew.
- The shared secret is encrypted at rest with AES-256-GCM (Node's built-in
  `crypto`) via a versioned key provider
  (`platform/identity/src/totp-key-provider.ts`). `TOTP_ENCRYPTION_KEYS` is
  a JSON map of key-version -> base64 32-byte key;
  `TOTP_ENCRYPTION_CURRENT_KEY_VERSION` selects which one new secrets are
  encrypted under. There is **no default key** - a missing configuration
  fails the application closed at startup, in every environment including
  local development (only `.env.example`'s placeholder value documents the
  expected shape; a real key must be generated and set explicitly).
- Replay prevention: `last_used_step` is persisted per credential; any code
  whose computed step is at or before that value is rejected, even if it
  would otherwise validate.
- Removing the credential requires step-up.

## Recovery codes

- 10 codes per generation batch, ~100 bits of entropy each (Crockford-ish
  alphabet with visually ambiguous characters removed, formatted as 4
  groups of 5 characters for human transcription).
- SHA-256-hashed at rest (`recovery-code.ts`, `token-hash.ts`) - NOT
  Argon2id, since these are high-entropy, server-generated secrets, not
  human-chosen passwords (see ADR-0011's distinction).
- Each code is single-use, consumed via one atomic conditional `UPDATE ...
  WHERE used_at IS NULL RETURNING *` - two concurrent redemption attempts
  for the same code can never both succeed
  (`tests/integration/identity-auth-domain.integration.test.ts` proves this
  under a real race).
- Using a recovery code to complete an MFA login lands the session at
  `AAL1`, not `AAL2` - it proves possession of a backup secret, not a live
  phishing-resistant factor.
- Regenerating a batch requires step-up; the FIRST generation does not
  (nothing to prove possession of yet).

## MFA policy

- A user may enroll multiple authenticators of different kinds
  simultaneously (TOTP and one or more passkeys).
- The last remaining authenticator can only be removed through the
  recovery flow's own guardrails - `removeTotp`/`removeCredential` both
  require step-up, and step-up itself requires proving a DIFFERENT
  currently-valid factor (password + TOTP, WebAuthn, or a recovery code) -
  a user can never accidentally strip their own account down to zero
  factors from a single unauthenticated action.
- No SMS, no voice OTP, no email-as-a-strong-factor, ever.

## What is deferred

Real browser WebAuthn ceremony coverage (an actual authenticator
signing a challenge) requires a genuine browser + virtual authenticator and
is covered by the Playwright E2E suite, not the Node-only HTTP integration
tests - see the evidence file's "known limitations" section.
