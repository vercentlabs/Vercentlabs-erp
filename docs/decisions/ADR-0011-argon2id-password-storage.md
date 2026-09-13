# ADR-0011: Argon2id for password storage; length-only policy; local compromised-password check

## Status

Accepted and implemented (SP005, Prompt 002B).

## Context

OWASP's Password Storage Cheat Sheet and NIST SP 800-63B-4 converge on the
same guidance: Argon2id is the preferred password hash, composition rules
(forced special characters, forced rotation) measurably push users toward
weaker, predictable passwords and must not be imposed, and a password
should be checked against a KNOWN-COMPROMISED list rather than an
arbitrary complexity rule. The root prompt also forbids hand-rolling any
cryptographic algorithm - a hash function is exactly the kind of primitive
that must come from a maintained library, never a bespoke implementation.

## Decision

**Argon2id** via the `argon2` npm package (native binding; approved via
`pnpm-workspace.yaml`'s `allowBuilds.argon2: true`). Parameters were
benchmarked on the actual development machine
(`platform/identity/test/password-hasher.test.ts` documents the measured
timing), landing on `m=65536 KiB (64 MiB)`, `t=3`, `p=4` (~73-76ms per
hash) - RFC 9106's own recommendation band for an interactive login path.
The resulting PHC-format hash string (`$argon2id$v=19$m=65536,t=3,p=4$...`)
is self-describing: `needsRehash()` (`platform/identity/src/crypto/password-hasher.ts`)
compares a stored hash's embedded parameters against the CURRENT target
parameters and transparently rehashes on the next successful login if they
differ (`login`, `platform/identity/src/commands/authentication-commands.ts`) -
this is how the parameters can be strengthened later without a forced
password reset for every user.

**Password policy**: 15-256 characters, length only
(`packages/contracts/src/identity/auth.ts`'s `passwordSchema`). No
composition rules. Unicode and spaces are accepted as-is; NFC (canonical
composition - deliberately not NFKC, which would collapse visually distinct
compatibility characters) normalization is applied once, at the hashing
boundary (`platform/identity/src/crypto/password-normalize.ts`), never
silently truncated. The 256-character ceiling is an operational abuse guard
on Argon2id's input size, not a composition rule.

**Compromised-password check**: a LOCAL blocklist
(`platform/identity/src/crypto/password-blocklist.ts`) checked against
every new/changed password - no external network call (no live
"pwned passwords" API lookup), so the check can never leak even a hashed
prefix of a user's password to a third party and never fails open due to a
network outage.

**Rate limiting / credential-stuffing defense**: `auth.authentication_attempts`
(append-only, keyed by the normalized email as `identity_key` - works even
for an unknown account) backs `assertNotRateLimited`
(`platform/identity/src/commands/authentication-commands.ts`), bounding
attempts per identity and per IP within a rolling window
(`RATE_LIMIT_POLICY`, `platform/identity/src/session-policy.ts`). This is
always a BOUNDED, time-limited throttle (`RateLimitedError`, HTTP 429 with
a `Retry-After` header) - never a permanent account lock. Lockout is
modeled entirely separately from lifecycle state (see ADR-0008): a
suspended/deactivated account is a distinct, administrator-driven state,
never something a failed-login counter can trigger on its own.

**Account-enumeration resistance**: every failed authentication path -
unknown email, wrong password, suspended, unverified email, deactivated,
wrong MFA code - throws the SAME `AuthenticationFailedError`
(`packages/contracts/src/identity/domain-errors.ts`) with the SAME generic
message. The real reason is recorded only internally, in
`auth.authentication_attempts` and the audit trail, for legitimate
operational/security use - never surfaced to the caller.

## Consequences

- Argon2id parameters are a single named constant
  (`platform/identity/src/crypto/password-hasher.ts`), reviewable and
  changeable in one place; `needsRehash` makes strengthening them later a
  transparent, gradual migration rather than a forced mass reset.
- Password verification, hashing, and rehash-detection are the ONLY places
  a raw password ever exists in memory outside the HTTP request body itself
  - `platform/identity/test/password-hasher.test.ts` (9 tests) proves
  round-tripping, wrong-password rejection, case/space sensitivity (no
  silent normalization inside `hashPassword` itself), and Unicode/combining-
  character handling, all against the real `argon2` binding, not a mock.
- `tests/integration/identity-auth-domain.integration.test.ts` proves the
  generic-error behavior and rate-limit-adjacent paths (suspended,
  wrong-password) end to end against real PostgreSQL.
