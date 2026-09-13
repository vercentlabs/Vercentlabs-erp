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

Exactly two implementations exist, and `PlatformAuthModule`
(`apps/api/src/platform/auth/platform-auth.module.ts`) is the **only** place
that chooses between them, based on `NODE_ENV` **at module load time**:

| `NODE_ENV`                    | Active provider                       | Behavior |
|--------------------------------|----------------------------------------|----------|
| `production`                   | `FailClosedTrustedScopeProvider`       | `resolve()` always returns `null`. |
| anything else (`development`, `test`) | `TestTrustedScopeProvider` | Reads a `x-test-trusted-scope` header: base64url-encoded JSON, validated against `trustedScopeSchema`. Invalid/absent header → `null`. |

`TrustedScopeGuard` (`trusted-scope.guard.ts`) is applied to every platform
controller (`@UseGuards(TrustedScopeGuard)`). If the active provider
resolves `null`, the guard throws `UnauthorizedException` (401) - there is
no default/open scope, ever. If it resolves a scope, the guard attaches it
to the request and `@CurrentTrustedScope()` (a param decorator) exposes it
to the handler.

## Why this is not a security hole

- `TestTrustedScopeProvider`'s constructor throws immediately if
  `process.env.NODE_ENV === 'production'` - it is structurally impossible
  for it to run in a production process, not just unwired by convention.
  Verified in `apps/api/test/platform-auth.unit.test.ts`.
- There is no hardcoded admin scope, backdoor header, or universal token
  anywhere in this codebase. A request with no header, a malformed header,
  or a schema-invalid header all resolve to `null` and are rejected
  identically.
- `apps/api/test/platform-openapi.integration.test.ts` proves the real
  compiled build (not test-transformed source) fails closed the same way.

## What SP004-SP010 will replace

`FailClosedTrustedScopeProvider` is the entire production behavior today -
every request to a platform endpoint in a real deployment is currently
rejected with 401, which is correct: there is no authenticated identity
platform yet, so nothing should be let through. SP004-SP010 will add a real
`TrustedScopeProvider` implementation (reading a session/JWT and populating
`organizationId`/`roles` for real); `PlatformAuthModule`'s production branch
is what that work replaces, not `apps/api`'s controllers, guards, or the
domain layer underneath them - none of that needs to change.
