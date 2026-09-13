# Organization lifecycle recovery

Operational guidance for the SP001 organization state machine (see
[platform-state-machines.md](../architecture/platform-state-machines.md)
for the full diagram). All commands here require a `platform_operator`
trusted scope - see
[platform-operator-boundary.md](../security/platform-operator-boundary.md).
There is no admin UI for any of this yet (`apps/web` exposes only a
fail-closed protected-route boundary); every action below is an HTTP call.

## Suspending an organization

`POST /api/v1/platform/organizations/{organizationId}/suspend` with a
`reason` (3-500 chars) moves `ACTIVE -> SUSPENDED`. Effects:

- New companies/operating units under it can no longer be created
  (`loadOrganizationAcceptingNewCompanies` rejects with
  `VALIDATION_ERROR` / HTTP 400) until the organization is recovered.
- Existing companies/operating units and their data are untouched - this is
  a gate on *new* tenant structure, not a data lock. (Whether business
  writes should also be blocked while suspended is a business-module
  concern for whichever module reads `isAcceptingBusinessWrites`-equivalent
  state in the future; SP001-SP003 do not gate business writes themselves.)
- An audit event (`organization.suspend`) and outbox event
  (`organization.suspended`) are recorded in the same transaction as the
  status change.

## Recovering a suspended organization

`POST /api/v1/platform/organizations/{organizationId}/recover` with a
`reason` moves `SUSPENDED -> ACTIVE`. This is a distinct command from
`activate` (which only accepts `DRAFT -> ACTIVE`) - recovery has its own
audit action (`organization.recover`) and outbox event
(`organization.recovered`) so downstream consumers can distinguish "this
organization just onboarded" from "this organization was suspended and is
back".

## Every mutation requires the caller's last-known version

Every state-changing request requires an `If-Match` header carrying the
organization's current `version` (as returned by the prior `GET`/mutation
response), enforced by optimistic concurrency
(`updateOrganizationWithExpectedVersion` in `platform/tenancy/src/repository.ts`).
If the version is stale, the request fails with HTTP 409
`STALE_VERSION_CONFLICT` rather than silently overwriting a change made by
someone else in between. **Recovery runbook step**: always `GET` the
organization immediately before retrying a suspend/recover/close call after
a conflict, and use the freshly-read `version` - do not blindly retry with
the same `If-Match` value.

## Idempotent retries

Every mutating request also requires an `Idempotency-Key` header. If a
suspend/recover/activate/close call times out on the client side, it is
always safe to retry with the **same** `Idempotency-Key` and request body:
the server returns the exact original response rather than double-applying
the effect (`runIdempotentCommand`, `platform/tenancy/src/command-helpers.ts`).
Retrying with the same key but a **different** payload (e.g. a different
`reason`) is rejected with HTTP 409 `IDEMPOTENCY_CONFLICT` - generate a new
key if the retry is intentionally a different request.

## Closing an organization is terminal

`POST /api/v1/platform/organizations/{organizationId}/close` accepts
`DRAFT`, `ACTIVE`, or `SUSPENDED` as the prior status and moves to `CLOSED`.
There is no `reopen`/`reactivate` command for a closed organization by
design - closure is a one-way door, and the row is never physically
deleted (verified in
`tests/integration/organization-domain.integration.test.ts`). If a closure
turns out to have been a mistake, that is an escalation to a human decision
about whether a brand-new organization should be created, not a supported
recovery path in this API.

## What is out of scope until SP004-SP010

None of the above requires knowing *who* the platform operator is beyond an
opaque `actorId` recorded on every audit event - there is no operator
directory, approval workflow, or notification on suspend/close yet. Those
are authorization/notification concerns for later prompts.
