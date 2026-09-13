# ADR-0007: Idempotency-Key + optimistic concurrency for every unsafe command

## Status

Accepted and implemented.

## Context

Root governance rule 7 requires important mutations to "use transactions,
idempotency and audit evidence". SP001-SP003 are the first real domain
commands in this codebase, so this prompt had to decide the concrete
mechanism, not just accept the principle.

Two distinct problems needed solving:

1. A client retries a request after a timeout/network failure, not knowing
   whether the original attempt succeeded - it must not create two
   organizations or apply an effect twice.
2. Two clients read the same entity's version, then both try to mutate it -
   the second write must not silently clobber the first (a lost update).

## Decision

**Idempotency-Key** (client-supplied, required on every unsafe command):
`platform.idempotency_records` stores `(organization_id, actor_id,
operation_name, idempotency_key)` -> `(request_hash, response_status,
response_body)`. `runIdempotentCommand` (`platform/tenancy/src/command-helpers.ts`,
`platform/organization/src/command-helpers.ts`):

1. Attempts to claim the key by inserting an `IN_PROGRESS` row inside a
   drizzle **nested transaction** (a real `SAVEPOINT`) - isolating a
   unique-constraint failure so it doesn't abort the enclosing transaction.
2. If the claim succeeds, runs the effect once, then completes the record
   with the real response.
3. If the claim fails (another attempt already claimed it), re-reads the
   record: a matching `request_hash` replays the stored response verbatim;
   a different one is a payload conflict (`IdempotencyPayloadConflictError`,
   HTTP 409 `IDEMPOTENCY_CONFLICT`); a still-`IN_PROGRESS` row (a genuinely
   concurrent duplicate request) throws `IdempotencyInProgressError`.

A precondition check that would make the whole request invalid (e.g. the
target organization doesn't exist or can't accept new companies) runs
**before** the idempotency claim - see `loadOrganizationAcceptingNewCompanies`
call sites in `platform/organization/src/commands/*-commands.ts`. A request
that was never going to succeed must not record a "successful attempt" that
a legitimate retry with corrected input could then get blocked behind.

**Optimistic concurrency** (`If-Match` header, required on every command
that mutates an existing entity): `updateOrganizationWithExpectedVersion`
(and its company/operating-unit equivalents) issue a conditional
`UPDATE ... WHERE id = $1 AND version = $2 RETURNING *`. Zero rows returned
means either "not found" or "stale version" - a follow-up `SELECT` by id
alone disambiguates the two, so callers get `DomainNotFoundError` (404) or
`StaleVersionConflictError` (409 `STALE_VERSION_CONFLICT`) correctly rather
than one conflated error.

## Consequences

- Every controller in `apps/api/src/platform` requires both headers via
  `requireIdempotencyKey`/`requireExpectedVersion`
  (`apps/api/src/platform/http/http-inputs.ts`) on the relevant routes -
  there is no server-generated fallback key, since that would silently
  defeat retry-safety for a caller that forgot to send one.
- `tests/integration/organization-domain.integration.test.ts` and
  `company-operating-unit-domain.integration.test.ts` cover: exact replay,
  payload-mismatch conflict, genuinely concurrent same-key requests
  producing exactly one effect, and stale-version rejection under real
  PostgreSQL - not simulated.
- The nested-transaction (`SAVEPOINT`) pattern for the idempotency claim is
  now the template every future SP that adds a mutating command should
  follow - a plain `try/catch` around the claim insert does not work,
  because PostgreSQL aborts the entire enclosing transaction on any
  statement error, including a caught one.
