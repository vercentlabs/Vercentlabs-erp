# ADR-0010: WebAuthn + TOTP + recovery codes for MFA; no SMS, no email-as-strong-factor

## Status

Accepted and implemented (SP007, Prompt 002B).

## Context

NIST SP 800-63B-4 and the OWASP MFA Cheat Sheet both explicitly deprecate
SMS/voice OTP as a phishable, SIM-swap-vulnerable factor, and treat "a link
or code sent to the same email that logs you in" as no real second factor
at all (an attacker who already controls the mailbox controls both
factors). Root governance rule 20 also bars improvising scope: this
prompt's job was to pick and correctly implement a small number of REAL
factors, not a menu of every possible one.

## Decision

Three MFA methods, no others:

- **WebAuthn/passkeys** (`@simplewebauthn/server@14.0.2`, pinned exact
  version) - phishability-resistant by construction (the browser binds the
  credential to the actual origin). `platform/identity/src/commands/webauthn-commands.ts`
  implements registration and authentication ceremonies entirely through the
  library's `generateRegistrationOptions`/`verifyRegistrationResponse`/
  `generateAuthenticationOptions`/`verifyAuthenticationResponse` - no manual
  signature verification is ever written by hand (root prompt requirement:
  no hand-rolled cryptographic algorithm implementation).
- **TOTP** (`otpauth@9.5.2`, pinned exact version), RFC 6238, SHA-1/6-digit/
  30-second step, ±1 step window for clock skew. The shared secret is
  encrypted at rest with AES-256-GCM (Node's built-in `crypto` - an audited
  primitive, not a hand-rolled algorithm) via a versioned key-provider
  abstraction (`platform/identity/src/totp-key-provider.ts`:
  `TotpKeyProvider` interface, `EnvironmentTotpKeyProvider` reading
  `TOTP_ENCRYPTION_KEYS`/`TOTP_ENCRYPTION_CURRENT_KEY_VERSION`, fails closed
  with no default key - see ADR-0011's sibling reasoning). Replay is
  prevented by persisting `last_used_step` per credential and rejecting any
  code at or before that step (`verifyCodeAgainstCredential`,
  `platform/identity/src/commands/totp-commands.ts`).
- **Recovery codes**: 10 single-use codes per generation batch, ~100 bits
  of entropy each (Crockford-ish alphabet with ambiguous characters
  removed, 4 groups of 5 characters - `platform/identity/src/crypto/recovery-code.ts`),
  SHA-256-hashed at rest (never Argon2id - see ADR-0011 for why these are
  treated as HIGH-ENTROPY server-generated secrets, not human-chosen
  passwords), consumed via a single atomic conditional `UPDATE ...
  WHERE usedAt IS NULL RETURNING *` so two concurrent uses of the same code
  cannot both succeed (`consumeRecoveryCode`,
  `platform/identity/src/repository/credentials.ts`).

**No SMS. No voice OTP. No "click this link in your email" as a strong
factor.** Email is only ever used for identity/ownership verification
(invitation acceptance, email verification, password reset) - never counted
as an MFA factor.

**MFA policy**: a login with any confirmed MFA method enabled routes through
`MFA_REQUIRED` (`platform/identity/src/commands/authentication-commands.ts`,
`login`) rather than granting a session outright. TOTP/WebAuthn-completed
logins land at `AAL2`; a recovery-code-completed login lands at `AAL1`
(explicitly a lower-assurance path - a recovery code proves possession of a
backup secret, not a live phishing-resistant or replay-resistant factor).
Removing the last remaining authenticator (`removeTotp`, `removeCredential`
in `webauthn-commands.ts`) requires a step-up grant
(`requireStepUp(..., purpose: 'mfa_removal_reset')`), never a bare session -
see ADR on step-up below.

## Consequences

- Enrolling the FIRST authenticator only needs the session's own
  authentication to be recent (`requireRecentAuthentication`,
  `platform/identity/src/assurance.ts`) - there is nothing to prove
  possession of yet. Every SUBSEQUENT removal or recovery-code regeneration
  goes through the heavier step-up ceremony.
- `verifyTotpCode`, `verifyWebAuthnAuthenticationAssertion`, and
  `consumeRecoveryCodeIfValid` are shared verification primitives called
  from BOTH the login/MFA pipeline (`erp_auth_pipeline`) and step-up
  (`erp_identity_runtime`) - this dual-context sharing is exactly what the
  `erp_identity_runtime` grants added in
  `database/migrations/platform/0012_create_identity_auth_runtime_grants_and_rls.sql`
  had to be extended for (see the evidence file's bug log).
- `tests/integration/identity-auth-domain.integration.test.ts` proves, against
  real PostgreSQL: TOTP enroll -> MFA-required login -> replay rejection;
  recovery-code generate -> consume-once -> concurrent-use race resolves to
  exactly one winner; step-up via PASSWORD_TOTP and RECOVERY_CODE.
- WebAuthn ceremony coverage (real browser + virtual authenticator) is
  deferred to the Playwright E2E suite - a Node-only HTTP test cannot
  produce a genuine WebAuthn assertion. See the evidence file's "known
  limitations" section.
