# Contract — Assets to Accounting depreciation

Assets provides an approved depreciation batch snapshot by company/book/period with asset, account mapping, amount, currency/base amount, source schedule IDs and idempotency key. Accounting validates fiscal period/ledger/account mappings and posts or rejects. Assets stores Accounting result/reference and reconciliation state; it never writes GL tables directly. Reversal is a linked compensating command.
