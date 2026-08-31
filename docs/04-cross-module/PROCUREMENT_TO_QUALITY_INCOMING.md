# Contract — Procurement receipt to Quality incoming inspection

Procurement/Stock provides stable receipt, supplier, item/UOM, warehouse/location, lot/batch/serial and received quantity source identity. Quality resolves effective incoming plan/sampling and creates inspection/hold idempotently. Accepted/released quantity may become unrestricted Stock; rejected/held quantity remains blocked. Failed inspection/NCR can request Procurement return/credit workflow. Retry never creates a second inspection/hold/return for the same source event unless policy explicitly requires a new inspection cycle.
