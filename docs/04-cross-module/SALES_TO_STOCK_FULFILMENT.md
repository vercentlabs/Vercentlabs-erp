# Sales to Stock Fulfilment

Sales confirms demand and calls Stock availability/reservation contracts. Stock owns reservation, picking eligibility and physical issue. Shipment completion is idempotent; Sales never writes Stock private tables. Partial fulfilment/backorder, short pick, cancellation and retry/reversal are explicit.
