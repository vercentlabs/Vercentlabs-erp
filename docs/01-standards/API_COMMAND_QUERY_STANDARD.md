# API, Command and Query Standard

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

## Commands
Commands express legal state changes such as `ConfirmSalesOrder`, `ReserveStock`, `ApprovePurchaseOrder`, `ReleaseQualityHold`, `RunPayroll`, `PostJournal`, `RefundPosPayment`. Each command specifies actor/system policy, scope, input schema, preconditions, state transition, transaction boundary, idempotency, audit/event output, errors, retry/reversal and reconciliation.

## Queries
Queries retrieve authorized business projections such as `GetCustomer360`, `GetAvailability`, `GetTrialBalance`, `GetProjectProfitability`. Queries must enforce the same tenant/company/record/field visibility model and support bounded pagination/filtering for large datasets.

## Transport
Web/mobile HTTP route handlers validate transport concerns, resolve authenticated context and call the public domain contract. They do not duplicate domain rules or directly perform cross-module SQL.

## Contract conventions
- Version externally consumed APIs.
- Stable machine error codes plus actionable user-safe messages.
- Explicit decimal/date/time serialization.
- Correlation/request IDs across transport, domain, worker and integration boundaries.
- Pagination and filtering limits are server enforced.
- Imports/webhooks/payment callbacks use replay-safe identifiers and signature/authentication controls.
