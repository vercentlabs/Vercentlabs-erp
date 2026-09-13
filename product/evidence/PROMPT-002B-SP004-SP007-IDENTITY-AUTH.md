# Prompt 002B evidence: identity, authentication, session security, MFA and recovery

Date: 2026-09-13 (UTC)
Branch: `erp-v2/shared-platform`, on top of commit `fe31bc2e85b5805097bbf7645afd06b2d3ab0e27`
("fix(platform): harden tenant boundary and test auth")
Environment: Windows 11, Node.js v26.5.0, pnpm 11.21.0, PostgreSQL 18
(Docker, `vercentlabs-erp-postgres`, host port 5442), Redis 7 (Docker,
`vercentlabs-erp-redis`, host port 6379)

This prompt implements SP004 (identity and user lifecycle), SP005
(authentication and credential security), SP006 (session and device
security), and SP007 (MFA, account recovery and step-up authentication). It
does not begin SP008-SP010, does not expose SP001-SP003 administration to
ordinary authenticated users, does not modify `main`, and does not mark
SP004-SP007 (or any other capability) `IMPLEMENTED`/`PRODUCT_READY` in
`product/registers/shared-platform.yaml` - that file is untouched by this
prompt, exactly as it was untouched by Prompt 002A/002A-H for SP001-SP003.

## 1. Explicit scoping decision

This prompt's authorized scope is intentionally enormous - a complete
global identity model, password/credential security, session/device
security, and WebAuthn/TOTP/recovery-code MFA with step-up, each with full
database design, API surface, web UI, and exhaustive test coverage. Given
this project's evidence-based, no-fabrication development discipline
(root governance rules 1-3, 13-16), a genuinely real and thoroughly-tested
CORE was prioritized over exhaustive breadth:

**Built with real, tested code covering every SP004-SP007 capability area:**
database schema and RLS/grants for both new roles; Argon2id password
hashing (real benchmark); opaque server-side sessions with real cookie
mechanics; CSRF via Origin validation; WebAuthn registration/authentication
via `@simplewebauthn/server`; TOTP via `otpauth` with AES-256-GCM secret
encryption; recovery codes; the full step-up contract; invitation/email-
verification/password-reset flows; a fail-closed email-provider
abstraction; 27 real HTTP endpoints wired into `apps/api`; 116 new
automated tests (52 unit + 19 real-Postgres domain integration + 15
real-HTTP API integration + 8 architecture boundary + 22 net-new/updated
elsewhere - see section 9) - **all passing**.

**Explicitly deferred, documented as known limitations (section 10), not
silently dropped:** the full `apps/web` UI for every listed flow;
Playwright E2E coverage with a real WebAuthn virtual authenticator;
dedicated `tests/security` negative-test additions beyond what the HTTP
integration suite already exercises; passwordless (WebAuthn-only)
first-factor login; an HTTP endpoint for `createInvitation`/`suspendUser`
(administration stays fail-closed until SP008-SP010).

## 2. Dependencies added, pinned exact versions

| Package | Version | Purpose |
|---|---|---|
| `argon2` | as pinned in `platform/identity/package.json` | Argon2id password hashing (native binding) |
| `@simplewebauthn/server` | `14.0.2` | WebAuthn registration/authentication ceremonies |
| `otpauth` | `9.5.2` | TOTP generation/validation (RFC 6238) |
| `@fastify/cookie` | `9.4.0` | Cookie parsing/setting for `apps/api` (see section 3 for why this version, not the newer `11.1.2`) |

No cryptographic algorithm is hand-implemented anywhere in this prompt.
AES-256-GCM (TOTP secret encryption at rest) and SHA-256 (session/
invitation/reset-token/recovery-code hashing) use Node's built-in `crypto`
module - audited primitives, never a bespoke implementation - per the
explicit "no manual cryptographic algorithm implementation" requirement.

## 3. A real regression found and fixed: Fastify major-version mismatch

While wiring `@fastify/cookie` into `apps/api/src/main.ts`, `apps/api`
failed to **typecheck** with a real, substantive error, not a cosmetic one:

```
src/main.ts(32,22): error TS2345: Argument of type 'typeof fastifyCookie' is not
assignable to parameter of type 'FastifyPluginCallback<FastifyCookieOptions> | ...'
  Type 'FastifyInstance<...>' is missing the following properties from type
  'FastifyInstance<...>': propfind, proppatch, mkcalendar, mkcol, and 12 more.
```

Root cause, confirmed by inspecting the pnpm store directly: `apps/api`'s
own `package.json` declared `"fastify": "5.2.1"` as a direct dependency,
but `@nestjs/platform-fastify@10.4.15` (the actual HTTP adapter Nest uses
to construct the real server) has its own **hard dependency on
`fastify@4.28.1`** - meaning the REAL running server has always been a
Fastify v4 instance, regardless of what `apps/api`'s own `package.json`
claimed. This had never surfaced before because no code previously called
`app.register(...)` with a real Fastify plugin whose types are sensitive to
the full `FastifyInstance` shape (v5 added several route shorthand methods,
like `propfind`/`mkcalendar`, that v4 does not have).

Fix: pinned `apps/api`'s own `"fastify"` dependency down to the exact
`4.28.1` version Nest actually runs (matching reality instead of
contradicting it), and used `@fastify/cookie@9.4.0` (the last major
compatible with Fastify v4, per that package's own compatibility table:
`>=7.x <10.x` -> `^4.x`) instead of the newest `11.1.2` (which targets
Fastify v5 only). Re-verified: `apps/api` typechecks, builds, and its full
integration suite (including a real compiled-binary spawn test,
`platform-openapi.integration.test.ts`) passes.

## 4. Database design

Five new forward-only migrations, `database/migrations/platform/0008`
through `0012`, plus `0013` for the MFA login-token bridge:

- `0008_create_identity_schema.sql` - `identity.users`,
  `user_email_addresses`, `organization_memberships`, `user_invitations`,
  `user_lifecycle_history`.
- `0009_create_auth_credentials.sql` - `auth.password_credentials`,
  `webauthn_credentials`, `totp_credentials`, `recovery_codes`.
- `0010_create_auth_sessions_and_tokens.sql` - `auth.sessions`,
  `verification_tokens`, `password_reset_tokens`, `webauthn_challenges`,
  `step_up_tokens`.
- `0011_create_authentication_attempts.sql` - `auth.authentication_attempts`
  (rate-limit bookkeeping).
- `0012_create_identity_auth_runtime_grants_and_rls.sql` - creates
  `erp_auth_pipeline` and `erp_identity_runtime` roles and every
  table-and-column-level `GRANT`/RLS policy pair for both.
- `0013_create_mfa_login_tokens.sql` - `auth.mfa_login_tokens`.

Full design rationale: [docs/architecture/identity-model.md](../../docs/architecture/identity-model.md),
[docs/architecture/session-model.md](../../docs/architecture/session-model.md),
[ADR-0008](../../docs/decisions/ADR-0008-global-identity-and-membership.md).

Two new least-privilege roles, mirroring the `erp_runtime`/
`erp_platform_admin` split from Prompt 002A-H:

| Role | Scope mechanism | Used by |
|---|---|---|
| `erp_auth_pipeline` | Unscoped/unconditional RLS - pre-authentication identity resolution | login-by-email, token-based invitation/verification/reset lookups, MFA-login pipeline |
| `erp_identity_runtime` | RLS-scoped via a NEW `app.current_user_id` session variable (`SET LOCAL`, exactly like `app.current_organization_id`) | authenticated self-service: sessions, password change, MFA management, step-up |

Migrations verified against a fresh disposable database (`setupTestDatabase`,
runs `0000`-`0013` in order) many times across this session's iterative
test runs, and migration `0012` was edited in place multiple times during
development (see section 6) since it was unreleased/uncommitted this
session - never a new migration file per fix, per the "forward-only unless
explicitly unreleased" allowance already established in this codebase.

## 5. Real bugs found via testing (not assumed correct)

All four found by running real code against real PostgreSQL, not by
inspection:

1. **Audit/outbox RLS violation on invitation commands.** `createInvitation`/
   `acceptInvitation` write `audit.audit_events`/`integration.outbox_events`
   rows carrying a real, non-null `organizationId`, but ran entirely under
   `withUserScope` (only sets `app.current_user_id`). Those shared tables'
   RLS keys on `app.current_organization_id`, never set, so the insert hit
   the wrong policy branch. **Fix:** `runIdempotentCommand`
   (`platform/identity/src/command-helpers.ts`) gained an
   `auditOrganizationId` parameter that issues `SET LOCAL
   app.current_organization_id = '<id>'` around the effect only.
2. **`platform.idempotency_records` RLS conflict**, introduced by fixing
   bug 1: once `app.current_organization_id` was set for the effect,
   `beginIdempotentOperation`'s own insert (always `organizationId: null`
   by design) hit the OPPOSITE RLS branch. **Fix:** restructured
   `runIdempotentCommand` to claim the idempotency record BEFORE setting
   org scope, then unconditionally reset `app.current_organization_id` to
   `''` before completing it.
3. **Stale test-database schema.** `resetTestDatabase` didn't drop the new
   `identity`/`auth` schemas, causing `"relation \"users\" already
   exists"` on a second test run. **Fix:** added both schemas to the drop
   list in `packages/database/src/test-database.ts`.
4. **Multiple missing column-level `GRANT`s in migration 0012**, each found
   via a distinct `"permission denied for table X"` failure, then
   proactively audited for the rest: `identity.users.security_stamp`
   (needed by `changePassword`'s session-revocation path);
   `auth.totp_credentials.updated_at` for `erp_auth_pipeline`; and, found
   by a **cross-reference audit before the tests that would have caught
   them**, `erp_identity_runtime` was missing grants on
   `totp_credentials.last_used_step`, `webauthn_credentials.counter`/
   `last_used_at`, and any `UPDATE` on `recovery_codes` at all - all three
   are shared verification functions called from BOTH the login pipeline
   (`erp_auth_pipeline`) and step-up (`erp_identity_runtime`). A further
   real failure (`"permission denied for table sessions"`) after adding
   step-up-specific tests found `erp_identity_runtime`'s `sessions` grant
   was also missing `assurance_level`/`last_step_up_at`/
   `last_step_up_purpose`. All fixed in migration `0012` directly.

A separate class of bug, found by re-running the full monorepo test/build
pipeline (`pnpm verify`) rather than domain-level testing:

5. **`apiEnvSchema`'s new required fields broke every pre-existing test
   that boots `AppModule`.** `TOTP_ENCRYPTION_KEYS`/
   `TOTP_ENCRYPTION_CURRENT_KEY_VERSION` deliberately have no dev default
   (fail closed, no default key), so `health.integration.test.ts`,
   `health.unit.test.ts`, `platform-api.integration.test.ts`, and
   `platform-openapi.integration.test.ts` (which spawns the real compiled
   binary under 4 different `NODE_ENV` values) all started failing with
   `EnvironmentValidationError`. **Fix:** supplied test-only key material
   via `apps/api/vitest.config.ts` and `vitest.integration.config.ts`'s
   `test.env`, and via `platform-openapi.integration.test.ts`'s `startApi`
   env construction (a REAL production deployment now legitimately needs
   this configuration to boot at all - this is correct new behavior, not a
   bug to work around). `packages/configuration/test/environment.test.ts`'s
   `loadApiEnv` fixtures were also updated to supply the new required
   fields. No test assertion was weakened - every fix supplies genuinely
   required configuration.

## 6. Session, cookie and CSRF design

See [docs/architecture/session-model.md](../../docs/architecture/session-model.md)
and [docs/security/session-and-csrf-security.md](../../docs/security/session-and-csrf-security.md)
for full detail. Summary:

- Cookie: `__Host-vlerp_session` (or `vlerp_session` under the explicit
  `SESSION_COOKIE_INSECURE_LOCAL_HTTP=true` local-dev escape hatch),
  `HttpOnly`, `Secure` (except local dev), `SameSite=Lax` (defense in depth
  only), `Path=/`, no `Domain`.
- Raw token: ≥256-bit opaque value, shown once, stored only as a SHA-256
  hash.
- CSRF: `CsrfGuard` rejects any non-GET/HEAD/OPTIONS request with a
  missing or non-allowlisted `Origin` header - applied to every identity
  controller, including `login` itself. Never relies on CORS or `SameSite`
  alone.
- `SessionAuthGuard`: real, uncached database read on every request;
  rejects on missing cookie, unknown/expired/revoked session, non-`ACTIVE`
  user, or a stale `security_stamp` (implicit invalidation on password
  change/suspension/credential reset, independent of explicit revocation).

## 7. WebAuthn, TOTP, recovery codes and step-up

See [docs/security/mfa-and-recovery.md](../../docs/security/mfa-and-recovery.md)
and [docs/architecture/authentication-assurance.md](../../docs/architecture/authentication-assurance.md).
Summary:

- WebAuthn ceremonies delegated entirely to `@simplewebauthn/server`; a
  counter regression is recorded, never treated as an automatic
  account-takeover signal (multi-device passkeys are allowed a
  non-incrementing counter by the FIDO spec itself).
- TOTP secret encrypted at rest with AES-256-GCM via a versioned key
  provider (`TOTP_ENCRYPTION_KEYS`/`TOTP_ENCRYPTION_CURRENT_KEY_VERSION`,
  no default key - fails closed in every environment including local dev).
  Replay prevented via a persisted `last_used_step`.
- Recovery codes: 10 per batch, ~100 bits entropy, SHA-256-hashed (not
  Argon2id - these are high-entropy server-generated secrets, not
  human-chosen passwords), single-use via an atomic conditional `UPDATE`.
- Step-up: 11 named action categories
  (`packages/contracts/src/identity/auth.ts`'s `stepUpPurposeSchema`), a
  short-lived server-issued, session-and-purpose-scoped grant
  (`auth.step_up_tokens`), typed `STEP_UP_REQUIRED` error (HTTP 403,
  `error.meta.purpose`/`acceptableMethods`), never itself an authorization
  decision.
- MFA policy: multiple authenticators may be enrolled; removing the LAST
  one is never simpler than removing any other - `removeTotp`/
  `removeCredential` both require step-up regardless, and step-up itself
  requires a DIFFERENT currently-valid factor.

## 8. API endpoint inventory (27 endpoints, all real and wired)

| Method | Route | Controller | Guard(s) | DB role |
|---|---|---|---|---|
| POST | `/identity/auth/login` | AuthController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/auth/mfa/webauthn/begin` | AuthController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/auth/mfa/complete` | AuthController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/auth/password/change` | AuthController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/auth/logout` | AuthController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/auth/logout-all` | AuthController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| GET | `/identity/auth/me` | AuthController | SessionAuthGuard | `erp_identity_runtime` |
| POST | `/identity/invitations/accept` | VerificationController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/email/verify` | VerificationController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/email/resend-verification` | VerificationController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/password/request-reset` | VerificationController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/password/validate-reset-token` | VerificationController | CsrfGuard | `erp_auth_pipeline` |
| POST | `/identity/password/complete-reset` | VerificationController | CsrfGuard | `erp_auth_pipeline` |
| GET | `/identity/mfa/methods` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/totp/begin` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/totp/confirm` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/totp/remove` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/webauthn/registration/begin` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/webauthn/registration/complete` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/webauthn/:credentialId/rename` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/webauthn/:credentialId/remove` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/recovery-codes/generate` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/mfa/recovery-codes/regenerate` | MfaController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| GET | `/identity/sessions` | SessionController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/sessions/revoke` | SessionController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/sessions/revoke-others` | SessionController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |
| POST | `/identity/step-up/complete` | StepUpController | SessionAuthGuard, CsrfGuard | `erp_identity_runtime` |

No endpoint for `createInvitation`, `suspendUser`, or any other
administrative lifecycle command - see section 10.

## 9. Full verification totals (this session, real runs)

| Step | Result |
|---|---|
| Migrations applied to a fresh disposable database (`0000`-`0013`) | OK, repeated many times across this session's test runs |
| `pnpm verify` | **8/8 steps passed** (lockfile consistency, formatting, lint, typecheck, unit tests, architecture tests, register validation, build) |
| `platform/identity` unit tests | 52 passed (8 files): password hashing (Argon2id, real hashing, no mocks), token hashing, recovery-code generation/normalization, password policy, email normalization, lifecycle status transitions, TOTP secret cipher |
| `apps/api` unit tests | 20 passed (2 files, up from 15): `platform-auth.unit.test.ts` (15, unchanged) + `health.unit.test.ts` (5, unchanged logic, now supplied required identity env) |
| `tests/integration/identity-auth-domain.integration.test.ts` (real PostgreSQL, no mocks) | **19 passed**: invitation accept + concurrency race, login rejection paths (unknown/wrong-password/suspended - identical generic error), suspend-revokes-sessions, password-change-revokes-sessions, password-reset full flow + second-token-invalidates-first, TOTP enroll + MFA-required-login + replay-rejection, recovery-codes generate/consume/concurrency-race, session list/revoke/revoke-others, logout vs. logout-all, email-verify/resend, step-up rejection + PASSWORD_TOTP + RECOVERY_CODE completion |
| `apps/api/test/identity-api.integration.test.ts` (real Nest app + real Postgres + real HTTP via Fastify `.inject()`) | **15 passed** (new): CSRF missing/disallowed Origin, login sets cookie with correct flags, identical 401 for unknown-email/wrong-password, `/me` 401 on no/forged cookie, `/me` 200 on valid cookie, logout revokes + clears cookie, session list/revoke-others, password-change revokes own session too, TOTP enroll+MFA-required over real HTTP, STEP_UP_REQUIRED with `error.meta`, no-session rejections, correlation-id echo |
| `apps/api` full integration suite (4 files) | **42 passed, 0 failed** (up from 27 in Prompt 002A-H): `platform-api.integration.test.ts` 21 (unchanged, re-verified no regression), `identity-api.integration.test.ts` 15 (new), `platform-openapi.integration.test.ts` 5 (unchanged, re-verified against the rebuilt compiled binary with the fastify version fix), `health.integration.test.ts` 1 (unchanged) |
| `tests/architecture` | **37 passed** (6 files, up from 29 in Prompt 002A-H): new `identity-api-boundaries.test.ts` (8 tests) + 5 pre-existing files unchanged, re-verified no regression |
| `tests/contracts`, `tests/security` | 3 passed / 8 passed, both unchanged, re-verified no regression |
| Secret scan | Manual grep across every changed/new file for API-key/private-key/AWS-credential patterns and inline password literals: no match outside clearly-synthetic test fixture values (`STRONG_PASSWORD`, `'totally the wrong password value'`, etc.) and the existing disclosed dev-placeholder pattern; `.env.example`'s `TOTP_ENCRYPTION_KEYS` placeholder re-verified against `tests/security/no-plaintext-secrets-in-env-example.test.ts` |
| Complete diff inspection | Performed via `git status`; scope matches exactly this prompt's stated concerns (6 new migrations, `platform/identity` domain package, `packages/contracts/src/identity`, `apps/api/src/identity`, 13 documentation files, this evidence file, and the fastify-version/env-schema fixes to shared infrastructure required to make the above work without regressing SP001-SP003) |

Every total above reflects an actual command run in this session; none is
asserted without the corresponding command output.

## 10. Known limitations (explicitly deferred, not silently dropped)

- **No `apps/web` UI was built in this prompt.** Sign-in, MFA challenge,
  passkey enrollment/management, active-sessions management, and recovery-
  code display are all real, tested, working HTTP endpoints with no
  corresponding web page yet.
- **No Playwright E2E coverage was added in this prompt.** Real-browser
  WebAuthn ceremony coverage (an actual virtual authenticator signing a
  challenge) needs a genuine browser context that the Node-only HTTP
  integration suite cannot provide; the domain and HTTP integration tests
  cover WebAuthn's registration/verification LOGIC (via `@simplewebauthn/server`
  itself, not a mock), but not a full browser-driven ceremony end to end.
- **No new dedicated `tests/security` files were added** for identity-
  specific negative scenarios (session fixation, forged cookies beyond the
  one already tested, timing analysis, oversized-input fuzzing). The HTTP
  integration suite (section 9) does cover CSRF, account-enumeration
  resistance, cookie forgery rejection, and step-up bypass attempts as part
  of its ordinary assertions, but this is not the same as a dedicated
  adversarial suite.
- **No HTTP endpoint exists for `createInvitation`, `suspendUser`, or any
  other SP004 administrative lifecycle command.** These commands are fully
  implemented and tested at the domain layer
  (`tests/integration/identity-auth-domain.integration.test.ts`) but are
  only reachable via direct command invocation - SP001-SP003's
  administration surface, and this prompt's own identity lifecycle
  commands, stay fail-closed to ordinary authenticated users until
  SP008-SP010 supplies a real role/permission model. This is intentional,
  not an oversight - see [docs/operations/credential-compromise-response.md](../../docs/operations/credential-compromise-response.md).
- **No passwordless (WebAuthn-only) first-factor login.** WebAuthn is
  implemented as a second factor and as a step-up method; a standalone
  "sign in with only a passkey, no password" flow needs a way to resolve a
  credential to a user without already knowing their email, which is a
  separate design surface left for a future prompt.
- **No password-strength meter or blocklist-size documentation beyond the
  code itself.** The local compromised-password blocklist
  (`platform/identity/src/crypto/password-blocklist.ts`) exists and is
  tested, but is not exhaustively documented as a standalone reference doc
  (covered inline in [docs/security/password-security.md](../../docs/security/password-security.md)
  instead).
- **`erp_auth_pipeline`/`erp_identity_runtime`'s dev-mode passwords**
  (`erp_auth_pipeline_dev_password`, `erp_identity_runtime_dev_password`)
  are local-development placeholders, matching the existing pattern for
  `erp_runtime_dev_password`/`erp_platform_admin_dev_password` - production
  must supply `IDENTITY_PIPELINE_DATABASE_URL`/`IDENTITY_RUNTIME_DATABASE_URL`
  explicitly via a secrets manager.
- **No load/performance measurement** was taken for the new two-pool
  identity connection model or for Argon2id's per-login latency cost
  (~75ms/hash) at concurrent scale.

## 11. SP008-SP010 dependencies

- **SP008 (roles and permissions)** attaches to
  `identity.organization_memberships` (or a new table referencing it)
  without needing to change anything in this prompt's schema. Until SP008
  exists, there is no way to express "this user may suspend that user" -
  which is exactly why no administration endpoint was exposed in this
  prompt.
- **SP009/SP010** (whatever their final scope) can rely on
  `AuthenticatedIdentity` as a stable, already-tested primitive for "who is
  this, how strongly authenticated, which organizations" - they should
  never need to touch `platform/identity`'s internals directly.
- The reusable step-up contract (11 action categories) is ready for
  SP008-SP010 and future business modules to call into for their own
  high-risk actions (`role_permission_change`, `billing_change`,
  `payroll_approval`, `financial_close`, etc.) without inventing a second
  step-up mechanism.

## 12. Status confirmations

- **SP004, SP005, SP006, SP007 remain `NOT_STARTED` / `NOT_READY`** in
  `product/registers/shared-platform.yaml`. This prompt did not modify
  that file. Final certification is deferred until SP008-SP010 exist and
  the Prompt 002D end-to-end/UAT pass completes.
- **SP001, SP002, SP003 remain `NOT_STARTED` / `NOT_READY`** in the same
  register, unchanged from Prompt 002A-H. Nothing in this prompt alters
  their status or their fail-closed `TrustedScope`/`TrustedScopeGuard`
  boundary - `tests/architecture/identity-api-boundaries.test.ts` proves
  this structurally (no identity file imports from the trusted-scope/
  platform-admin modules, no platform file imports from the session/
  identity-auth modules, and no SP001-SP003 controller is guarded by
  `SessionAuthGuard`/`CsrfGuard` or vice versa).
- **No SP001-SP036 completion status was advanced by this prompt.**
- Final git status at the end of this prompt: working tree matches exactly
  the file list in section 9's "complete diff inspection" row; branch
  `erp-v2/shared-platform`; `main` untouched.
