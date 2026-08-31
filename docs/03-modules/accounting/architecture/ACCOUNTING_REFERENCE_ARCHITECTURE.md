# Accounting Reference Architecture

Command path: authenticate → tenant/company/ledger scope → permission/SoD → validate source/account/dimension/period/currency/tax → acquire concurrency guards → balanced posting transaction → immutable journal/event/audit → outbox → response. Posted records are never edited in place; corrections/reversals remain linked. All monetary API boundaries use JSON-safe decimal representations; raw BigInt serialization is prohibited.
