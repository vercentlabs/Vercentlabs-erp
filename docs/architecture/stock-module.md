# VercentLabs ERP Stock module

The Stock module is the tenant-isolated inventory system of record. It owns balances, movements, reservations, transfers, batch/serial traceability, reorder rules and valuation layers. Procurement receipts and Sales fulfilment reference Stock through explicit movement commands; neither module writes balances directly. Negative stock is denied by default. Every write executes inside the existing tenant transaction boundary and every Stock table uses forced PostgreSQL row-level security.
