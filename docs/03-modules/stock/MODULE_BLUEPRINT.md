# Stock / Inventory Module Blueprint

- Pass: 4
- Canonical range: F097–F144
- Feature count: 48
- Product boundary: Perpetual inventory quantity, warehouse execution, traceability, replenishment and valuation subledger
- Specification status: `SPECIFICATION_READY`

## Architecture rules
- Stock movement ledger is authoritative physical-history truth; balances are reconcilable projections.
- All quantity mutations are transactional, concurrency-safe and idempotent.
- Stock owns physical quantity, reservation and inventory valuation subledger; Accounting owns GL.
- Quality holds must block normal availability/reservation/picking/movement.
- Cross-module writes use public contracts/orchestration only.
- F-IDs remain traceability anchors; implementation is capability-oriented.
