# Point of Sale Module Blueprint

- Pass: 8
- Canonical range: F268–F307
- Feature count: 40
- Product boundary: Retail checkout, tenders, returns, inventory effects, offline continuity, cash/shift control and POS-to-books
- Specification status: `SPECIFICATION_READY`

## Architecture invariants
- F-IDs are traceability anchors; implementation is capability-oriented.
- One stable POS transaction identity/idempotency key follows sale/payment/stock/accounting/return/offline sync effects.
- Payment-provider truth, Stock quantity/valuation, Accounting journals/tax/period locks and authorization remain authoritative in their owning systems/modules.
- Completed transaction and closed-shift/Z facts are immutable; corrections are linked void/refund/reversal/reconciliation events.
- Offline is bounded and conflict-safe; synchronization reauthorizes/revalidates and never duplicates business effect.
- POS is terminal/tablet-first, fast, keyboard/touch/scanner accessible and resilient to peripheral/network failure.
