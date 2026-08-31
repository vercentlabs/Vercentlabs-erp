# Payroll to Accounting

HR/Payroll emits a balanced idempotent journal intent containing company, payroll run/version, posting date, dimensions and debit/credit lines. Accounting validates period/dimensions, posts exactly once and returns journal reference. Reversal is linked; reconciliation ties run totals to journals. No private-table mutation.
