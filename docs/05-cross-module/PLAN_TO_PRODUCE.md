# Plan to Produce

Status: `SPECIFICATION_READY`

## Scope
Modules: Manufacturing; Stock / Inventory; Procurement; Quality; Accounting / Finance. Outcome: planned demand to costed finished stock.

## Canonical sequence
1. **demand/MRP** — owned by the module that owns the aggregate; cross-module effects use public commands/events only.
2. **material supply/reservation** — owned by the module that owns the aggregate; cross-module effects use public commands/events only.
3. **production/work orders** — owned by the module that owns the aggregate; cross-module effects use public commands/events only.
4. **issue/consume/WIP** — owned by the module that owns the aggregate; cross-module effects use public commands/events only.
5. **quality/release** — owned by the module that owns the aggregate; cross-module effects use public commands/events only.
6. **finished receipt/cost posting** — owned by the module that owns the aggregate; cross-module effects use public commands/events only.

## Transaction and consistency contract
A single module owns each local ACID transaction. No distributed transaction spans modules. The source transaction persists business truth plus an outbox/event or invokes a public synchronous command only when the receiving invariant must be checked atomically. Every cross-module command/event carries organization/company scope, actor/system identity, correlation ID, source aggregate/version and an idempotency key derived from the source business event.

## Authorization
The initiating actor is authorized for the source command; destination modules re-check the public command's system/user policy and organization/company scope. Service context is not blanket authorization.

## Idempotency and concurrency
Duplicate commands/events return or reconcile to the original result. Optimistic version/row locking protects state transitions where concurrent actors can conflict. Monetary, stock, payroll and payment side effects use unique business keys so retries cannot duplicate truth.

## Failure/retry/dead-letter
Synchronous validation failures leave the source transition unapplied when atomicity is required. Asynchronous failures remain visible as pending/exception states, retry with bounded backoff and enter a dead-letter/exception queue after policy exhaustion. Operators can retry/reconcile without manually editing private tables.

## Reversal/compensation
Posted/consumed/financial truth is never silently deleted. Corrections create domain-specific reversal, return, credit, cancellation or compensating records with links to originals and period/permission checks.

## Reconciliation
Scheduled/on-demand reconciliation compares source business events with destination effects and exposes missing, duplicate, stale or amount/quantity mismatches. Reconciliation itself never fabricates financial or inventory truth without an authorized command.

## Audit/observability
Every transition emits structured audit evidence and correlation IDs; metrics cover success, latency, retries, dead letters and reconciliation exceptions.

## Verification IDs
- E2E: `ENT-PLAN_TO_PRODUCE-E2E-001` happy path; `ENT-PLAN_TO_PRODUCE-E2E-002` permission/failure; `ENT-PLAN_TO_PRODUCE-E2E-003` retry/reversal/reconciliation.
- UAT: `ENT-PLAN_TO_PRODUCE-UAT-001` operator journey with visible state and downstream reconciliation.
