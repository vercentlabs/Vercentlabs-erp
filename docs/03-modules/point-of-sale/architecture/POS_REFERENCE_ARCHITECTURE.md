# POS Reference Architecture

Command chain: authenticate → organization/company → module entitlement → store/terminal/shift → action/override permission → validate cart/return/payment → expected-state/concurrency lock → deterministic pricing/tax → payment state → atomic POS transaction/audit → public Stock/Accounting/loyalty intents → receipt/UI outcome.

A stable POS transaction/offline ID is propagated through provider references, Stock movements, returns/refunds, loyalty and Accounting batches. External uncertainty is never converted into guessed success/failure.
