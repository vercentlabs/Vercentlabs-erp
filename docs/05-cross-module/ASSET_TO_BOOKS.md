# Asset to Books

Status: `SPECIFICATION_READY`

Journey ID: `PRG-JRN-008`

Modules: Procurement;Assets;Accounting / Finance

Feature anchors: `F237;F238;F242;F243;F244;F245;F246;F247;F248;F249;F250;F251;F262;F263;F264;F265;F266`

## Trigger and completion
The journey begins only from an authenticated, authorized business trigger. Completion means the destination business outcome is durable **and** all required stock/financial/approval/audit consequences reconcile; a UI success message alone is never completion.

## Stage chain
| # | Stage | Owner | Public contract | Authoritative outcome |
|---:|---|---|---|---|
| 1 | Acquire/capitalize | Procurement;Assets | Asset creation/capitalization contract | Capitalized asset + source evidence |
| 2 | Depreciation setup | Assets | Book/schedule setup | Effective useful life/salvage/method |
| 3 | Periodic depreciation | Assets;Accounting / Finance | Idempotent depreciation posting | Asset/depreciation/GL agree |
| 4 | Revaluation/impairment | Assets;Accounting / Finance | Controlled valuation command | Versioned valuation + posting |
| 5 | Disposal | Assets | Sale/scrap/disposal command | Disposed quantity/value and gain/loss |
| 6 | Reconcile | Assets;Accounting / Finance | Asset-to-GL reconciliation | Asset register equals control accounts |

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
- `PRG-JRN-008-E2E-01`: happy path across every owning module with visible, audit, stock and financial outcomes.
- `PRG-JRN-008-E2E-02`: permission/concurrency/validation failure proves no partial or cross-tenant state.
- `PRG-JRN-008-E2E-03`: retry, downstream uncertainty, reversal and reconciliation path proves exactly-once business effect.
- `PRG-JRN-008-UAT-01`: named business roles execute the primary journey from realistic prerequisites and sign off visible/data/audit outcomes.
- `PRG-JRN-008-UAT-02`: named business roles execute exception/recovery/reversal and confirm operational diagnostics/reconciliation.

## Definition of planning-complete
This journey is specification-ready when all stage owners/public contracts are represented in approved module/shared-platform requirements, implementation wave dependencies are known, the verification IDs above are planned, and no product readiness is inferred before implementation/E2E/UAT evidence exists.
