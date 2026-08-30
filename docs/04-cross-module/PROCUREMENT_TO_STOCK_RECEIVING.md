# Procurement → Stock Receiving / Return Contract

Procurement owns the PO/GRN/return commercial context; Stock owns physical quantity and movement. Posting an approved receipt calls a Stock public contract with immutable PO/line, item/UOM, warehouse/location and accepted quantity evidence. Duplicate replay cannot duplicate stock. Partial receipts preserve remaining quantity. Reversal/return uses compensating Stock movement and reconciles Procurement receipt/return status; Procurement never updates Stock private tables directly.
## Stock Pass 4 refinement
Stock receipt posting owns item/location/tracking validation, concurrency-safe quantity and valuation effects. Procurement supplies PO/GRN lineage only. Duplicate GRN delivery is idempotent; rejected/quality-held quantities are not normal available stock.
