# Cross-module orchestration

Workflows touching two or more ERP modules belong here.

Examples:

- CRM -> Sales
- Sales -> Stock -> Accounting
- Procurement -> Stock -> Accounting
- Manufacturing -> Quality -> Stock
- POS -> Stock -> Accounting
- Payroll -> Accounting
- Assets -> Accounting
- Projects -> Accounting

Modules must not directly depend on another module's private implementation.
