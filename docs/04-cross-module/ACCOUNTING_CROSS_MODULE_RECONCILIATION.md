# Accounting cross-module reconciliation

Mandatory control totals reconcile Sales/AR, Procurement/AP, Stock valuation, Manufacturing WIP/variance, Projects billing/cost, Assets depreciation/disposal, POS tenders/tax and HR/Payroll journals to Accounting by stable source IDs. Differences enter owned exception queues; retries never duplicate journals.
