# Manufacturing → Procurement MRP Supply Contract

MRP produces pegged shortage/supply recommendations. Accepted purchase/subcontract recommendations call Procurement public contracts with source requirement/run identity and idempotency. Procurement owns supplier/RFQ/PO lifecycle; Manufacturing consumes confirmed supply status and reconciles changed/cancelled requirements without private PO writes.
