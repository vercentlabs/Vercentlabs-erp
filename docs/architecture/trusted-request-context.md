# Trusted request context (`TrustedScope`)

`TrustedScope` (`packages/contracts/src/actor.ts`) is the only thing every
platform domain command and query authorizes against. It is a discriminated
union, not a loose object, specifically so code that only makes sense for a
tenant-scoped request cannot accidentally compile against a
platform-operator scope where the field it wants does not exist:

```ts
type TrustedScope = PlatformOperatorScope | OrganizationScope;

interface PlatformOperatorScope {
  kind: 'platform_operator';
  actor: Actor;
  roles: string[];
  correlationId: string;
  requestId: string;
}

interface OrganizationScope {
  kind: 'organization';
  organizationId: string;   // UUID, always present
  companyId?: string;       // optional further scoping, unused by any command today
  operatingUnitId?: string; // optional further scoping, unused by any command today
  actor: Actor;
  roles: string[];
  correlationId: string;
  requestId: string;
}
```

`isPlatformOperatorScope`/`isOrganizationScope` type guards are how every
command branches on scope kind - see e.g.
`platform/tenancy/src/commands/create-organization.ts`.

## Why this exists now, without SP004-SP010

SP004-SP010 (authentication/authorization) have not been built yet. Without
them there is no way to construct a `TrustedScope` from a real login
session. This prompt still needed a **stable seam** so the domain layer
could be written, typed, and tested against the *real* contract SP004-SP010
will eventually populate - rather than against `any`, a mock, or being
blocked entirely.

## The seam: `TrustedScopeProvider`

`apps/api/src/platform/auth/trusted-scope.port.ts` defines one interface:

```ts
interface TrustedScopeProvider {
  resolve(request: FastifyRequest): Promise<TrustedScope | null>;
}
```

Exactly two implementations exist. **`PlatformAuthModule`
(`apps/api/src/platform/auth/platform-auth.module.ts`) registers
`FailClosedTrustedScopeProvider` unconditionally - there is no `NODE_ENV`
branch at all.** Every normal application startup, regardless of
`NODE_ENV` (`production`, `development`, `test`, missing, misspelled -
anything), gets the same fail-closed behavior:

| Provider | When active | Behavior |
|---|---|---|
| `FailClosedTrustedScopeProvider` | Always, for any normal `node dist/main.js` startup | `resolve()` always returns `null`. |
| `TestTrustedScopeProvider` | **Only** when a test's own module composition explicitly overrides it: `Test.createTestingModule({...}).overrideProvider(TRUSTED_SCOPE_PROVIDER).useClass(TestTrustedScopeProvider)` | Reads a `x-test-trusted-scope` header: base64url-encoded JSON, validated against `trustedScopeSchema`. Invalid/absent header → `null`. |

**Prompt 002A-H correction:** the table above used to have a `NODE_ENV`
column, because an earlier version of `PlatformAuthModule` really did
select `TestTrustedScopeProvider` whenever `NODE_ENV !== 'production'`.
That meant a plain local `dev` run, a misconfigured staging deployment, or
simply forgetting to set `NODE_ENV` would silently accept the test header -
see
[product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md](../../product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md).
The fix removed the branch entirely rather than tightening its condition,
so there is no environment variable anywhere that can re-enable the test
provider by accident.

`TrustedScopeGuard` (`trusted-scope.guard.ts`) is applied to every platform
controller (`@UseGuards(TrustedScopeGuard)`). If the active provider
resolves `null`, the guard throws `UnauthorizedException` (401) - there is
no default/open scope, ever. If it resolves a scope, the guard attaches it
to the request and `@CurrentTrustedScope()` (a param decorator) exposes it
to the handler.

## Why this is not a security hole

- `PlatformAuthModule` never imports `TestTrustedScopeProvider` at all -
  `tests/architecture/platform-api-boundaries.test.ts` enforces this by
  scanning import specifiers, not just reading the current source by eye.
  The only route to activating it is a test file's own explicit
  `overrideProvider(...)` call, which is that test's responsibility, not
  something an environment variable can trigger on the module's behalf.
- `TestTrustedScopeProvider`'s constructor *also* throws immediately if
  `process.env.NODE_ENV === 'production'`, as a second, independent layer
  of defense in case a test ever mis-overrides the provider against a
  production-configured environment by mistake. Verified in
  `apps/api/test/platform-auth.unit.test.ts`.
- There is no hardcoded admin scope, backdoor header, or universal token
  anywhere in this codebase. A request with no header, a malformed header,
  or a schema-invalid header all resolve to `null` and are rejected
  identically.
- `apps/api/test/platform-openapi.integration.test.ts` proves the real
  compiled build (not test-transformed source) fails closed on a forged
  header under all of: production, development, test (without an explicit
  override), and a missing `NODE_ENV`.

## What SP004-SP010 will replace

`FailClosedTrustedScopeProvider` is the entire production behavior today -
every request to a platform endpoint in a real deployment is currently
rejected with 401, which is correct: there is no authenticated identity
platform yet, so nothing should be let through. SP004-SP010 will add a real
`TrustedScopeProvider` implementation (reading a session/JWT and populating
`organizationId`/`roles` for real) and change `PlatformAuthModule` to
register it - by adding a new provider, not by resurrecting an
environment-variable branch - alongside `FailClosedTrustedScopeProvider`
for whatever cases still need to fail closed. None of `apps/api`'s
controllers, guards, or the domain layer underneath them need to change.
