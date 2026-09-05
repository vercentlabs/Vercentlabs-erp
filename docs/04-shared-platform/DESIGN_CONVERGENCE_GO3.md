# Design Convergence Go 3

Status: `GO3_COMPLETE`

Go 3 moves the authenticated shell and top-level ERP surfaces under the shared Experience Kernel without re-implementing domain workflows.

## Migrated surface ownership

- authenticated application shell;
- ERP Home;
- Settings landing surface;
- CRM, Sales, Accounting and Procurement overview entry surfaces;
- Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll dashboards.

## Safety boundary

All existing route destinations, permissions, loaders, API calls, calculations and domain-specific controls remain in their original owners. The Go-3 boundary is presentation-only and composes the canonical `Surface` primitive and `--erp-*` tokens. Legacy classes are deliberately retained where deleting them could change behavior or invalidate a proven workflow; `verify:experience` prevents that compatibility debt from increasing.

## Next

Go 4 standardizes page archetypes and adds authenticated visual-regression, responsive and accessibility gates.
