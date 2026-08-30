# Procurement Receipt → Quality / Stock Contract

When incoming inspection is required, Procurement supplies immutable receipt/PO/lot/serial/quantity context to Quality. Quality owns pass/fail, hold and disposition. Held/rejected quantity cannot become unrestricted Stock through Procurement alone. Return-to-supplier, rework, concession or release are explicit Quality outcomes consumed by Procurement/Stock with audit, idempotency and reconciliation.
