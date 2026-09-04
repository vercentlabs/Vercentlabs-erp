# Agent Work Package Template

## Identity

- Work Package ID:
- Canonical Wave:
- Work Type: `FOUNDATION | FEATURE | CAPABILITY | INTEGRATION | SHARED_PLATFORM | GOVERNANCE | HARDENING`
- Title:
- Feature IDs:
- Capability:
- Accountable Owner: `Project Manager`
- Executor Class: `AI_AGENT`
- Status: `DRAFT`

## Source-control boundary

- Base Commit:
- Branch:
- Worktree:
- Owned Paths:
- Forbidden Paths:

## Dependencies

- Package Dependencies:
- Canonical Predecessors:
- Shared Contract Dependencies:
- Shared Change Required: `YES | NO`

## Migration authority

- Requires Migration: `YES | NO`
- Migration Reservations:
- Database Scope:

## Database invariants

Describe tenant ownership/RLS, constraints, concurrency/versioning, idempotency, money/UOM precision, audit/outbox, reversal/reconciliation and migration/backfill requirements touched by this package.

## Domain commands / queries / events

List authoritative server-side commands, queries and public events/contracts.

## UI surfaces

- Touches UI: `YES | NO`
- Web surfaces:
- Mobile/offline surfaces:

## Experience Kernel requirements

When UI is touched, document loading, empty, permission, error, stale/conflict, pending, responsive, accessibility and visual-verification states. Do not introduce a package-local global design system.

## Required verification IDs

List requirement/test/UAT IDs that the package must satisfy.

## Focused tests

List domain/API/Web/worker/DB/security/concurrency/performance/E2E/accessibility tests required for package acceptance.

## Repository gates

List architecture, DB, security, typecheck/lint/build, package/release gates required before integration.

## Evidence path

`docs/08-implementation-plans/evidence/<AWP-ID>.md`

## Known risks

List package-specific risks, shared-contract risks, migration risks and integration risks.

## Rollback / reconciliation

Describe how partial failure, retry, rollback/reversal and cross-module reconciliation are handled.

## Integration notes

Document current-main revalidation, shared/public-contract resolution and any dependent-package rebase requirement.
