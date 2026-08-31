# Quality Pass 9 Test Strategy

- Property/unit: tolerance boundaries, unit conversion/rounding, sampling selection/accept-reject, KPI/cost formulas.
- State-machine: inspection/result correction, NCR, hold/release, disposition, CAPA effectiveness, audit/CoA versioning.
- DB/RLS/security: tenant/company/site/team isolation, field permissions, self-release/use-as-is/approval negative cases.
- Concurrency: hold creation vs issue/transfer/pick/ship/production consumption/release; simultaneous release vs movement; duplicate inspection/disposition/CAPA commands.
- Integration: receipt→inspection→Stock, in-process gate, rework/scrap/RTS, calibration, complaint/traceability, quality-cost/Accounting reconciliation.
- Fault injection/idempotency: worker/outbox retry, downstream timeout, duplicate source event, repeated disposition/release/return.
- E2E/device: barcode/lot scanning, measurements/pass-fail, hold/NCR/CAPA, CoA, accessible keyboard/touch/tablet paths.
- Performance: high-volume results, lot genealogy, hold-gate latency and dashboard/report drilldown.
