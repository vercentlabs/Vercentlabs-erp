# Security baseline

This documents the security posture actually implemented in this
engineering-foundation prompt. It is not a claim that authentication,
authorization or tenant isolation are implemented yet - they are not (SP001,
SP004-SP009 are `NOT_STARTED`). It documents the foundation those
capabilities will be built on.

## What exists today

- **Typed error envelope with no stack-trace leakage.** `apps/api`'s
  `AllExceptionsFilter` returns `{ error: { code, message, correlationId? }
  }` for every non-2xx response; internal error details are logged
  server-side (with secrets redacted, see below), never sent to the client.
- **Structured logging with automatic secret redaction.**
  `@vercentlabs/observability` redacts field names matching a documented
  list (password, secret, token, authorization, apiKey, credential,
  privateKey, sessionId, cookie, creditCard, cvv, clientSecret, ...) both
  via pino's `redact` paths and a deep-clone fallback for arbitrary payload
  shapes. Proven by tests in `packages/observability/test` and guarded
  against regression by `tests/security/redaction-contract.test.ts`.
- **No raw `console.log`/`console.info` in `apps/api` or `apps/worker`
  source**, enforced by `tests/security/no-raw-console-logging.test.ts`, so
  nothing can bypass the redacting logger. `console.error` remains for
  unrecoverable bootstrap failures only.
- **CORS is explicitly origin-restricted**, driven by the
  `API_CORS_ORIGINS` environment variable, never a wildcard - checked by
  `tests/security/cors-not-wildcard.test.ts`.
- **Fail-fast environment validation.** `@vercentlabs/configuration`
  refuses to start in `production` if required configuration is missing;
  safe defaults are applied only outside `production`.
- **No secrets committed.** `.env` is git-ignored; `.env.example` contains
  only clearly-labeled local development placeholders, checked by
  `tests/security/no-plaintext-secrets-in-env-example.test.ts` against
  known secret-shaped patterns (AWS keys, PEM private keys, long hex/opaque
  tokens).
- **`TrustedScope` (`@vercentlabs/contracts`) is documented as
  server-constructed only** - never accepted verbatim from a client-supplied
  field - per root governance rule 6. No code path constructs one from
  request input yet, since authentication (SP004-SP007) does not exist.
- **`packages/database`'s test-database helper refuses to operate on any
  database whose name doesn't contain "test"**, preventing an integration
  test misconfiguration from touching a real database.

## What is explicitly deferred (tracked in the register, not silently skipped)

- Authentication, sessions, MFA (SP005-SP007) - no credential hashing,
  token issuance or session storage exists.
- Authorization / access control (SP008-SP009) - `@vercentlabs/permissions`
  is type-only scaffolding.
- Tenant isolation via Row-Level Security (SP001, SP003; see
  [ADR-0003](../decisions/ADR-0003-postgresql-tenancy-and-rls.md)) - no
  tenant-owned tables exist yet to protect.
- Secrets/key management platform (SP029) and privacy/consent/retention
  controls (SP028).

None of these are marked implemented in
[`product/registers/shared-platform.yaml`](../../product/registers/shared-platform.yaml);
see [ADR-0004](../decisions/ADR-0004-evidence-based-feature-status.md) for
why a register edit alone could never change that.
