# Stock Pass 4 Research Summary

Pass 4 preserves canonical F097–F144 exactly and benchmarks enterprise inventory behavior against official Microsoft Dynamics 365 Supply Chain Management, Oracle Fusion Cloud Inventory Management and Odoo Inventory documentation.

## Research conclusions
- Authoritative inventory requires immutable movement history plus transaction-safe balance/reservation projections.
- Available stock and ATP are distinct: ATP incorporates scheduled future supply/demand rather than only current on-hand.
- Lot/serial/expiry controls are item policies that must be enforced on every applicable receipt, movement and issue.
- Mobile/scanner warehouse execution and cycle counting are first-class operator workflows.
- Quality-held stock is not ordinary available inventory.
- FIFO/moving-average/standard-cost and landed-cost effects must be deterministic, reversible and reconcilable to Accounting.
- AI can explain or recommend replenishment/exception actions, never authoritatively post quantity or valuation.

## Red-team focus
Reservation races, concurrent issue, UOM rounding, serial reuse, expiry/FEFO, count-vs-movement concurrency, backdated movement, quality holds, landed-cost revaluation, valuation-layer reversal, negative-stock exceptions, idempotent cross-module effects and inventory-to-GL reconciliation are mandatory verification areas.
