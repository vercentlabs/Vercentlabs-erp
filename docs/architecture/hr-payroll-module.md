# VercentLabs ERP HR & Payroll module

HR & Payroll manages employee records, organisation structure, shifts, attendance, leave, expenses, compensation, payroll calculation, approval, payslips and Accounting handoff.

## Ownership boundaries

- HR & Payroll owns employee master data, attendance, leave, compensation and payroll calculations.
- Projects owns project delivery and time profitability. HR may reference project-linked expenses without replacing Projects.
- Accounting remains the financial ledger and payment system of record. HR & Payroll sends approved payroll and reimbursement batches through governed handoff references.
- External biometric, banking, statutory filing and government integrations remain provider-specific adapters.

## Controls

- Sensitive bank, tax and personal data requires dedicated permission.
- Leave and expense approval are separated from entry.
- Payroll preparation, approval and posting use separate permissions.
- Payroll creators cannot approve their own run.
- Posted payroll retains the Accounting batch reference.
- Every tenant HR & Payroll table uses forced PostgreSQL row-level security.
