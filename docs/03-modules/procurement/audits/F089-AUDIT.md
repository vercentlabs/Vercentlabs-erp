# F089 Supplier performance — Atomic requirement trace

Dossier: measure delivery, quality, quantity, price/service, compliance
evidence with transparent grain/period/trend. Lifecycle: `RAW EVENTS ->
PERIODIC/REALTIME MEASURES -> REVIEWED SNAPSHOT; source facts immutable`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (measurement exists) | PASS (real, deterministic, code-derived — not manual entry) | `evaluateSupplierGovernance`/`evaluatePurchaseOrderHealth`/`evaluateReceiptHealth` (governance.js) compute real signals from actual transaction data: qualification/certification counts and expiry, on-time delivery (`dueInDays`), receipt variance/rejection rates — these are genuine derived measures, not user-typed numbers. |
| REP-001 | PASS | `getProcurementReport("supplier-performance")` aggregates real `procurement_supplier_scorecards.overallScore` averages per supplier — a real, company-scoped, permission-gated report, not a placeholder. |
| **DATA-002 — immutable historical snapshot.** | PASS | `captureProcurementGovernanceSnapshot` writes a permanent, content-hashed row to `procurement_governance_snapshots` capturing the health/evidence at a point in time — genuine "reviewed snapshot" support, matching the dossier's lifecycle exactly. |
| **CAP-002 — the "score" itself is manual, not computed from the underlying delivery/quality/quantity facts.** | **GAP, confirmed — see F090.** `overallScore` (the number this report averages) is a raw human-entered value on a scorecard, not derived from `evaluateSupplierScore` against real delivery/quality/price sub-facts. The governance *health* signals (qualification/delivery/rejection) are real and derived; the *performance score* specifically is not. |
| SEC-001 | PASS | Standard scoping. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

Split verdict: the governance *health* signals this feature can draw on
(delivery timeliness, receipt rejection, certification currency) are real
and derived from actual transaction data — genuinely good work. The
*performance score* specifically that gets reported and averaged is manual
data entry with no deterministic derivation, which undercuts the "with
transparent grain/period/trend definitions" requirement.
