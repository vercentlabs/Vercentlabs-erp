# Contract — POS to Stock sale

Completed POS sale requests Stock issue using stable POS sale/line source IDs, item/UOM/warehouse/location/lot/serial/quantity and idempotency key. Stock owns availability, negative-stock policy, quantity and valuation. POS stores resulting movement IDs and reconciliation state; retry returns existing movement/no-op. Quality-held stock remains unsellable under Stock/Quality policy.
