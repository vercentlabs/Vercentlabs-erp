# Migration and Reconciliation Standard

Customer migration sequence: `extract -> map -> cleanse/validate -> transform -> dry run -> import -> reconcile -> exception resolution -> customer sign-off -> cutover`.

Minimum supported planning domains: customers/contacts, suppliers, items/UOM, warehouses/opening stock, employees, assets, open sales/purchase documents where supported, receivables/payables, bank/open items and GL opening balances. Every migration type defines source identity, duplicate rules, referential mapping, currency/UOM/date precision, idempotent rerun, rejection report and reconciliation totals/counts.
