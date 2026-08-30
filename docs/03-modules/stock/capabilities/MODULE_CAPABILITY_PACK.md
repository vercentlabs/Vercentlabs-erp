# Stock Capability Pack

## STOCK-CAP-001 — Item identity, variants and UOM
- Features: F097;F098;F099;F100;F101;F102
- Personas: INVENTORY_ADMIN;WAREHOUSE_MANAGER;BUYER;SALES_OPS
- Outcome: One inventory identity and precision-safe UOM model across all stock movements
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-002 — Warehouse network and location model
- Features: F103;F104;F105
- Personas: WAREHOUSE_MANAGER;WAREHOUSE_OPERATOR;INVENTORY_CONTROLLER
- Outcome: Governed multi-warehouse/location topology with company-safe inventory visibility
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-003 — Perpetual ledger, availability and reservation
- Features: F106;F107;F108;F109;F110;F111;F112;F113;F114
- Personas: WAREHOUSE_OPERATOR;INVENTORY_CONTROLLER;SALES_OPS;PLANNER
- Outcome: Race-safe stock truth, reservations and ATP from authoritative movements
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-004 — Traceability, expiry and barcode execution
- Features: F115;F116;F117;F118;F119
- Personas: WAREHOUSE_OPERATOR;QUALITY;TRACEABILITY_ANALYST
- Outcome: End-to-end lot/serial/expiry identity with scanner-safe execution
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-005 — Counting, replenishment and negative-stock policy
- Features: F120;F121;F122;F123;F124;F125;F126
- Personas: INVENTORY_CONTROLLER;PLANNER;WAREHOUSE_MANAGER
- Outcome: Reconciled counts and policy-driven replenishment without silent negative stock
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-006 — Inventory costing and valuation
- Features: F127;F128;F129;F130;F131
- Personas: INVENTORY_ACCOUNTANT;FINANCE;COST_ACCOUNTANT
- Outcome: Deterministic valuation layers and reconciled inventory asset value
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-007 — Inventory intelligence and reporting
- Features: F132;F133;F134;F143;F144
- Personas: INVENTORY_CONTROLLER;MANAGER;FINANCE;EXECUTIVE
- Outcome: Explainable aging/slow/dead-stock intelligence and reconciled operational reporting
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-008 — Warehouse fulfilment and returns
- Features: F135;F136;F137;F138
- Personas: PICKER;PACKER;SHIPPER;SALES_OPS;RETURNS_OPERATOR
- Outcome: Reservation-linked pick-pack-ship and controlled return receipt
- Gate: `SPECIFICATION_READY`; product certification remains separate.

## STOCK-CAP-009 — Inventory exception, quality hold and genealogy
- Features: F139;F140;F141;F142
- Personas: QUALITY;WAREHOUSE_MANAGER;TRACEABILITY_ANALYST;AUDITOR
- Outcome: Authoritative holds/damage segregation plus complete movement genealogy/history
- Gate: `SPECIFICATION_READY`; product certification remains separate.
