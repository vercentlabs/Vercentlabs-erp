# Assets Pass 7 Research Summary

Pass 7 benchmarks enterprise fixed-asset/EAM lifecycle patterns against official Microsoft Dynamics 365/Business Central, Oracle Enterprise Asset Management and SAP EAM sources. Mature behavior consistently spans register/classification, acquisition/capitalization, location/custody, maintenance history, depreciation/value adjustments, transfers, physical control and disposal, integrated with finance/operations rather than isolated CRUD.

Vercentlabs target therefore preserves one auditable asset lifecycle while keeping Accounting authoritative for ledger/period logic and other modules authoritative for their private state. Benchmark discoveries are normalized into canonical F231–F267 requirements rather than copied vendor objects.

Research red-team areas: multi-book/tax-vs-corporate purpose, depreciation conventions/rounding/final true-up, revaluation/impairment, partial transfers/disposals, component/CIP future extensibility, calibration/verification evidence, warranty, field scanning/offline, SoD, concurrent custody/posting races, backdating/period close, reversal/reconciliation and asset-to-books traceability.
