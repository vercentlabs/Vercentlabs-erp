# Sales → Procurement Drop-Ship Demand Contract

Sales F056 may request supplier-direct fulfillment through a Procurement public command. Procurement revalidates supplier/item/price/policy and owns the supplier PO; Sales retains customer commitment. Supplier shipment/receipt evidence is correlated back without Procurement mutating Sales private state. Cancellation, partial shipment, return and failure use explicit compensation/reconciliation.
