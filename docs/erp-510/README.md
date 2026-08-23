# Vercentlabs ERP — 510 Mandatory Feature Program

This directory is the authoritative development program for the next version
of Vercentlabs ERP.

The old 1,039/1,049-feature-count program has been retired.

The new objective is not maximum feature count.

The objective is:

> Build the mandatory ERP capabilities completely, correctly and as one
> deeply connected ERP system.

---

## 12 ERP Modules

1. CRM
2. Sales
3. Procurement
4. Stock
5. Manufacturing
6. Quality
7. Projects
8. Assets
9. Point of Sale
10. Support
11. HR & Payroll
12. Accounting

---

# Critical Product Principle

Administrators can access all ERP modules from one unified ERP sidebar.

Normal users see only what they need.

Examples:

Salesperson:
Home → CRM → Sales → My Work → Reports

Warehouse:
Home → Stock → Quality → My Work

HR:
Home → HR & Payroll → My Work → Reports

Accountant:
Home → Accounting → Assets → relevant financial views → Reports

Administrator:
Home → all 12 modules → Reports → Administration

Navigation visibility is NOT security.

All access must still be enforced on the server.

---

# Development Method

Features are implemented one by one.

Every mandatory feature receives its own implementation specification under:

02-feature-specs/

A feature is COMPLETE only when its entire usable workflow exists.

Schema-only, API-only, UI-only, mock, placeholder and inaccessible
implementations are not COMPLETE.
