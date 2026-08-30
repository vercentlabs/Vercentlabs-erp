# Sales Return → Stock / Accounting Credit Contract

Sales owns customer return/credit request context. Stock verifies physical receipt/disposition; Accounting posts credit/refund. Each step uses public contracts, source-line quantity guards, idempotency, audit/outbox and failure/retry/reconciliation. Original delivery/invoice history is never overwritten.
