# Journey — Tender to completed sale

Freeze validated cart snapshot → start tender(s) → provider/cash state transitions → uncertain external outcome stays pending → ensure accepted/captured tender total satisfies amount due → atomically complete POS sale → idempotent Stock issue/loyalty/accounting intents → receipt/invoice output → reconcile downstream references. Retry cannot create a second charge/sale/stock issue.
