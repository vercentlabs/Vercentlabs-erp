# VercentLabs ERP Manufacturing module

Manufacturing is the tenant-isolated production-planning and execution system. It owns versioned bills of material, routings, work centers, work orders, material requirements, operation progress, production postings and cost snapshots.

## Module boundaries

- Stock remains the quantity and valuation ledger. Manufacturing issues components and receives finished goods only through auditable Stock movements.
- Procurement supplies purchased material and subcontract services; Manufacturing does not create supplier bills.
- Sales and planning can provide demand references; Manufacturing owns production execution.
- Accounting receives governed inventory, WIP, variance and production-cost events. Manufacturing does not write general-ledger rows directly.

## Controls

- Only active BOM versions can be used for work orders.
- Material shortages block release.
- Work-order release and production posting use separate permissions.
- Operation completion can be mandatory before finished-goods receipt.
- Overproduction is blocked by default.
- Production posting is idempotent and retains Stock movement references.
- Every tenant Manufacturing table has forced PostgreSQL row-level security.
