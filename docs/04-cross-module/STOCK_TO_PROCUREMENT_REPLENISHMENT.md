# Stock → Procurement Replenishment Contract

Stock owns reorder/min-max/safety/forecast demand and emits a stable replenishment request. Procurement validates supplier/price/lead-time/policy, consolidates only under deterministic rules and creates at most one intended RFQ/PO effect per source demand/idempotency key. Failed or cancelled purchasing is reconciled back to the Stock demand; Procurement does not recalculate authoritative on-hand/reserved stock.
