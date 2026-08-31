# User Flow & State-Machine Freeze Standard — Final Pass C

## Purpose
No Vercentlabs ERP feature is implementation-authorised from a happy-path paragraph alone. Final Pass C freezes the minimum executable workflow contract for every canonical F001-F510 feature.

## Mandatory path coverage
Every feature owns ten planning flows: ENTRY_CONTEXT, HAPPY_PATH, ALTERNATE_PATH, PERMISSION_DENIED, VALIDATION_FAILURE, CONCURRENCY_CONFLICT, DUPLICATE_RETRY, REVERSAL_RECOVERY, DOWNSTREAM_FAILURE, and RECONCILIATION_CLOSURE.

## State-machine rule
Every feature has an implementation-planning state machine with five governed transitions appropriate to its semantic family. These planning states describe transition obligations; they do not force every database aggregate to use a literal `status` column with the same labels.

Every transition must define guard, permission/scope check, invalid-transition behavior, concurrency/locking strategy, idempotency behavior, audit evidence, downstream event semantics, reversal/correction path and acceptance test.

## Transaction rule
A material synchronous mutation follows: authenticate -> resolve tenant/company/scope -> authorize -> validate -> load authoritative state -> BEGIN -> set request-scoped tenant/RLS context on the same client -> lock/version-check if required -> re-check invariants -> mutate owner state -> audit -> outbox -> COMMIT. Failure rolls back the complete transaction.

## Cross-module rule
Another module is never mutated through private tables. The owner exposes a public command/query or orchestration coordinates multiple public contracts. Async consumers are retry-safe and deduplicate events.

## UI rule
Every failure or pending state must be visible and actionable. Disabled buttons alone are not authorization. Responsive/mobile/offline behavior follows the dossier and shared Experience Kernel.

## Readiness
Pass C freezes workflow planning only. It does not claim implementation, E2E execution, human UAT or product readiness.
