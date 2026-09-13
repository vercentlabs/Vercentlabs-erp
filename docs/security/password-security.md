# Password security (SP005)

See [ADR-0011](../decisions/ADR-0011-argon2id-password-storage.md) for the
full design rationale. This document is the operational/reference summary.

## Storage

- Algorithm: Argon2id (`argon2` npm package, native binding - never a
  hand-rolled hash).
- Parameters (benchmarked on real hardware, see
  `platform/identity/test/password-hasher.test.ts`): `m=65536 KiB` (64
  MiB), `t=3`, `p=4` (~73-76ms per hash).
- Stored as a single self-describing PHC-format string
  (`$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`) in
  `auth.password_credentials.password_hash`. Parameters can be strengthened
  later without a forced reset: `needsRehash()` detects a stored hash whose
  embedded parameters no longer match the current target, and `login()`
  transparently rehashes with the plaintext still in scope from that same
  request.

## Policy

- 15-256 characters. Length only - no required uppercase/digit/symbol.
- Unicode and spaces are accepted as typed. NFC (canonical composition, not
  NFKC) normalization is applied once, immediately before hashing
  (`platform/identity/src/crypto/password-normalize.ts`) - never silently
  truncated.
- Checked against a LOCAL compromised-password blocklist
  (`platform/identity/src/crypto/password-blocklist.ts`). No external
  network call is ever made for this check - a hashed prefix of a user's
  password is never sent anywhere, and the check can never fail open due to
  a third-party outage.

## Rate limiting / credential stuffing

- `auth.authentication_attempts` (append-only, keyed by the normalized
  email as `identity_key`, so it works even against an unknown account) is
  checked before every password verification (`assertNotRateLimited`,
  `platform/identity/src/commands/authentication-commands.ts`).
- Bounded per-identity and per-IP windows (`RATE_LIMIT_POLICY`,
  `platform/identity/src/session-policy.ts`). Exceeding either throws
  `RateLimitedError` - HTTP 429 with a `Retry-After` header
  (`apps/api/src/common/filters/all-exceptions.filter.ts`).
- **Never a permanent lock.** There is no "too many attempts, account
  locked forever" state. Lockout is time-bounded rate-limiting only,
  entirely separate from `identity.users.status` (see
  [identity-model.md](../architecture/identity-model.md)).

## Account-enumeration resistance

Every failed login path - unknown email, wrong password, suspended,
unverified email, deactivated - throws the identical
`AuthenticationFailedError` with the identical message. A client (or an
attacker probing for valid emails) cannot distinguish any of these cases
from the HTTP response. The real reason is recorded only in
`auth.authentication_attempts` and the audit trail
(`audit.audit_events`, via `recordAuditEvent`), for legitimate
operational/security use.

## What is explicitly NOT done

- No composition rules (no forced special character, no forced digit).
- No forced periodic password rotation.
- No security questions anywhere in the recovery flow (see
  [account-recovery.md](../operations/account-recovery.md)).
- No live third-party "have I been pwned"-style network lookup.
