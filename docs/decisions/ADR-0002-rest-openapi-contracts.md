# ADR-0002: REST + OpenAPI contracts, versioned at `/api/v1`

## Status

Accepted.

## Context

`apps/web` must consume a versioned API contract rather than reaching into
server/database internals directly (mandatory architecture). We need a
contract style that is simple to version, easy to generate documentation
for, and works cleanly with NestJS on Fastify.

## Decision

- `apps/api` exposes REST endpoints under a global `/api/v1` prefix
  (`app.setGlobalPrefix('api/v1')` in `apps/api/src/main.ts`).
- OpenAPI 3 documents are generated at request time via `@nestjs/swagger`
  and served at `/api/v1/docs` (UI) and `/api/v1/docs-json` (raw document) -
  not hand-maintained.
- Every non-2xx response uses one typed error envelope
  (`@vercentlabs/contracts`'s `ApiErrorEnvelope`: `{ error: { code,
  message, correlationId?, details? } }`), applied globally by
  `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts`),
  so clients branch on `error.code` rather than parsing messages or status
  codes alone.
- Every request carries a correlation id (`x-correlation-id`), reused if the
  client supplies a valid one, otherwise minted server-side
  (`CorrelationMiddleware`) and echoed back on the response and in every log
  line for that request (`@vercentlabs/observability`'s correlation
  context).
- Money crosses the API as decimal strings and 64-bit identifiers as JSON
  strings, never native floats or raw `BigInt` (`@vercentlabs/contracts`'s
  `decimal.ts` and `bigint-json.ts`), per root governance rules 11-12.

## Consequences

- A future breaking change gets a new `/api/v2` prefix rather than breaking
  existing clients silently.
- `packages/contracts` stays framework- and database-free (ADR-independent
  rule, enforced by `tests/architecture/contracts-framework-free.test.ts`),
  so the same primitives could back a future non-REST transport without a
  rewrite.
- No GraphQL, gRPC or tRPC layer is introduced in this prompt.
