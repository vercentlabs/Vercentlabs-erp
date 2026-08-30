# Contract — Procurement to Assets acquisition

Procurement publishes/serves approved PO/receipt/vendor-invoice source facts with organization/company, source IDs, item/description, quantity/serial where applicable, vendor, currency/cost/tax treatment and dates. Assets decides capitalization eligibility/threshold/category and creates asset identity idempotently per source allocation. Duplicate retries return the existing asset/source mapping. Accounting remains authoritative for AP/tax/journal posting.
