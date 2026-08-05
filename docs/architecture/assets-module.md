# VercentLabs ERP Assets module

Assets manages equipment and fixed-asset lifecycle from acquisition through capitalization, custody, maintenance, depreciation and disposal.

## Ownership boundaries

- Procurement remains the source of truth for purchase orders, receipts and vendor obligations. Assets retains governed source references.
- Stock remains the quantity ledger for spare parts consumed by maintenance.
- Accounting remains the general ledger and statutory depreciation system of record. Assets produces governed capitalization, depreciation and disposal handoff evidence.
- Projects may reference project-owned assets, but custody, maintenance and financial asset lifecycle remain in Assets.

## Controls

- Capitalization and disposal use separate permissions.
- Self-approval is blocked for capitalization and disposal.
- Only one active assignment may exist per asset.
- Maintenance parts retain Stock movement references.
- Depreciation schedules are immutable after posting.
- Disposal preserves proceeds, cost, net book value and gain or loss.
- Every tenant Assets table uses forced PostgreSQL row-level security.
