# Manufacturing → Stock Production Flow Contract

Stock owns reservations, on-hand, movements, tracking and valuation. Manufacturing requests raw-material reservation/issue/return and finished/co-/by-product receipt through Stock public commands with work-order/operation/posting identity and idempotency. Manufacturing stores returned Stock movement IDs for WIP, genealogy and reconciliation; it never updates stock balances directly.
