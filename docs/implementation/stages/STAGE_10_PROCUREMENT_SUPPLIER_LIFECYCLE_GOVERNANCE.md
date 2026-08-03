# Stage 10 — Procurement and supplier lifecycle governance

Stage 10 extends the existing source-to-pay engine without replacing transactional requisition, sourcing, purchase-order, receipt, matching or Accounting handoff logic.

## Delivered controls

- Supplier qualification, certification expiry and scorecard readiness.
- Requisition approval SLA and need-by risk.
- Competitive sourcing, bid/evaluation evidence and award integrity.
- Purchase-order supplier status, acknowledgement SLA, delivery risk and partial-receipt health.
- Receipt linkage, accepted/rejected quantity and inspection variance.
- Company-scoped governance policies, saved views, exception ownership and immutable snapshots.
- Governance dashboard, per-record readiness/timeline APIs and mobile web-parity registration.
- Forced tenant RLS, contract tests, database verification and live rollback-safe fixture verification.

Physical stock posting remains outside this stage and is reserved for the Inventory implementation. Stage 10 governs warehouse/receipt evidence and the Procurement-to-Accounting handoff only.
