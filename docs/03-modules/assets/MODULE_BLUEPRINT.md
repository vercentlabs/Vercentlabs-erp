# Assets Module Blueprint

- Pass: 7
- Canonical range: F231–F267
- Feature count: 37
- Product boundary: Fixed/physical asset lifecycle, custody, maintenance, depreciation, verification, disposal and asset-to-books control
- Specification status: `SPECIFICATION_READY`

## Capability model
1. Asset master, identity and organization
2. Acquisition and capitalization
3. Asset value and depreciation
4. Assignment, transfer and movement history
5. Maintenance and reliability
6. Inspection, calibration and physical control
7. Disposal and retirement
8. Asset analytics and reporting

## Architecture invariants
- F-IDs remain traceability anchors; implementation is capability-oriented.
- Assets owns operational lifecycle/history; Accounting owns journals/GL/period locks, Stock owns inventory movements, Procurement owns sourcing/receipts/invoices, HR owns employee data, Manufacturing owns production scheduling/capacity.
- Posted financial/compliance facts are immutable except by linked reversal/correction.
- Depreciation/value/gain-loss are deterministic and AI-independent.
- Cross-module effects use public commands/events/orchestration with idempotency and reconciliation.
- Field/mobile evidence is a first-class asset-control surface.
