# Stock Reference Architecture

## Authoritative layers
1. Item/location/tracking configuration and effective-dated policy.
2. Immutable `StockMovement` ledger for every posted physical change.
3. Concurrency-safe balance/reservation projections at explicit dimension grain.
4. Valuation layers/subledger linked to movements and cost events.
5. Warehouse work (receipt/transfer/count/pick/pack/ship/return/hold).
6. Outbox/public contracts for Procurement, Sales, Manufacturing, POS, Quality and Accounting.

## Command pipeline
authentication → organization → module entitlement → permission → company/warehouse scope → current state/version → dimension/UOM/tracking validation → row locks/atomic availability check → movement + reservation/valuation effect → audit → outbox → response.

No API, barcode, bulk import, worker, automation or AI path may bypass this pipeline.
