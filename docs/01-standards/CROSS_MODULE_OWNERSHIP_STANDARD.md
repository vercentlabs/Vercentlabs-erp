# Cross-Module Ownership and System-of-Record Standard

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

| Truth | Owning domain |
|---|---|
| Leads/opportunities/CRM activities | CRM |
| Customer commercial master, quotations, orders | Sales |
| Supplier sourcing/purchase commitments | Procurement |
| Item inventory balance, movement, reservation, valuation | Stock / Inventory |
| BOM, production order, WIP/consumption/production cost capture | Manufacturing |
| Project delivery/work/budget/profitability projection | Projects |
| Asset lifecycle/depreciation/disposal source records | Assets |
| POS sale/tender/shift transaction | Point of Sale |
| Inspection/NCR/CAPA/quality hold truth | Quality |
| Ticket/SLA/support interaction | Support / Customer Service |
| Employee/time/leave/payroll source truth | HR & Payroll |
| Journal/GL/AP/AR/financial-statement truth | Accounting / Finance |
| Identity/tenant/permission/audit/jobs/files/notifications/config | Shared platform |

A module references another module's public identifier/snapshot only where required. It does not become a second system of record. Cross-module reconciliation compares owned truths; it does not resolve disagreement through ad-hoc private-table edits.
