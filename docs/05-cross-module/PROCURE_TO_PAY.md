# Procure to Pay

Status: `SPECIFICATION_READY`

Journey ID: `PRG-JRN-003`

Modules: Procurement;Quality;Stock / Inventory;Accounting / Finance

Feature anchors: `F067;F068;F069;F073;F074;F075;F080;F081;F082;F084;F085;F086;F087;F471;F473;F474`

## Trigger and completion
The journey begins only from an authenticated, authorized business trigger. Completion means the destination business outcome is durable **and** all required stock/financial/approval/audit consequences reconcile; a UI success message alone is never completion.

## Stage chain
| # | Stage | Owner | Public contract | Authoritative outcome |
|---:|---|---|---|---|
| 1 | Demand/approval | Procurement | Requisition + approval | Authorized purchasing demand |
| 2 | Source/order | Procurement | RFQ/selection/PO | Approved supplier commitment |
| 3 | Receipt/quality | Procurement;Quality;Stock / Inventory | GRN + inspection/hold | Accepted/rejected/held quantity truth |
| 4 | Invoice match | Procurement;Accounting / Finance | 2-way/3-way matching | Payable eligible or exception |
| 5 | Payment | Accounting / Finance | Supplier payment/allocation | Settled payable |
| 6 | Reconciliation | Accounting / Finance | AP/bank reconciliation | Supplier, bank and GL agree |

## Frozen cross-cutting contract
- Ownership: each module mutates only its private state; cross-module effects use public commands/queries/events and `services/api/src/orchestration` where coordination is required.
- Authorization: organization, entitlement, company, branch/site/warehouse/project/team, record and field scope are rechecked server-side at every authoritative boundary.
- Transaction: a single aggregate write uses one request-scoped DB transaction/client with tenant/RLS context; multi-module workflows do not fake a distributed transaction.
- Idempotency: retry-sensitive commands carry stable business/idempotency keys; duplicate requests/callbacks/jobs return the prior outcome or a safe no-op.
- Async: audit + outbox/job trigger are committed with authoritative state when required; workers use trusted persisted tenant scope, bounded retry/backoff, DLQ/exception state and reconciliation.
- Failure visibility: pending/failed/partial/uncertain states are explicit. No downstream timeout is silently treated as success or blindly repeated if the external outcome is uncertain.
- Concurrency: stale version/lock/constraint conflicts return an actionable conflict; invariants are rechecked inside the authoritative transaction.
- Reversal: posted/consumed/financial truth is reversed or compensated through the owning module; history is not silently rewritten.
- Reconciliation: every asynchronous or cross-module leg exposes source/destination identifiers, correlation IDs and an exception queue/report sufficient to prove both sides agree.

## Verification plan
- `PRG-JRN-003-E2E-01`: happy path across every owning module with visible, audit, stock and financial outcomes.
- `PRG-JRN-003-E2E-02`: permission/concurrency/validation failure proves no partial or cross-tenant state.
- `PRG-JRN-003-E2E-03`: retry, downstream uncertainty, reversal and reconciliation path proves exactly-once business effect.
- `PRG-JRN-003-UAT-01`: named business roles execute the primary journey from realistic prerequisites and sign off visible/data/audit outcomes.
- `PRG-JRN-003-UAT-02`: named business roles execute exception/recovery/reversal and confirm operational diagnostics/reconciliation.

## Definition of planning-complete
This journey is specification-ready when all stage owners/public contracts are represented in approved module/shared-platform requirements, implementation wave dependencies are known, the verification IDs above are planned, and no product readiness is inferred before implementation/E2E/UAT evidence exists.
