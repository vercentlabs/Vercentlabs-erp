# HR & Payroll Reference Architecture

Authenticate → organization/company/branch/employee scope → entitlement → permission/field security → effective worker/policy/compensation → state/version → transaction + audit/outbox. Payroll adds open period → frozen input snapshot → deterministic gross-to-net/statutory calculation → exceptions → maker-checker approval → immutable payslip/payment set → idempotent bank/accounting/statutory intents → reconciliation/reversal.
