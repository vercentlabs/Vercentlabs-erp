# F091 Supplier lead times — Atomic requirement trace

Dossier: supplier/item/site lead times and planning buffers with effective
dates, planned-vs-actual measurement, safe use in promised receipt/
replenishment calculations. Lifecycle: `FUTURE/PLANNED -> ACTIVE ->
EXPIRED/INACTIVE with measured actual lead-time history retained`.

`upsertSupplierLeadTime` (`pass1-operations.js:67-78`) is the real
implementation, already read in full. Real UI:
`pass1-operations-workspace.tsx`'s `upsert-lead-time` action.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/VAL-001 | PASS | Real, validated (0-3650 days, `effectiveFrom <= effectiveTo`), supplier/item cross-validated to the same company, `FOR UPDATE` upsert-in-place keyed on `(supplier, item, status='active')`. Item is optional — a supplier-level default lead time is supported alongside item-specific overrides. |
| **CAP-002 — actually used by any downstream calculation.** | **GAP, confirmed absent — same pattern as F079's price list.** `generateReorderPurchasingRequests` (the one real consumer of supplier/item data for planning) reads `candidate.leadTimeDays` from **Stock's** `listStockReorderCandidates` output, not from `procurement_supplier_lead_times` — Procurement's own maintained lead-time table is never read by any code path that computes a promised receipt or reorder date. The data can be entered and stored but has no evidenced effect on any calculation. |
| **CAP-002 — planned-vs-actual measurement.** | **GAP, confirmed absent.** No code compares a PO's actual receipt date against its expected/lead-time-derived date to produce an "actual lead time" measurement or history. |
| SEC-001 | PASS | Standard scoping. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

Identical shape of gap to F079: the data-maintenance half is real and
validated, but nothing downstream actually consults it. Reorder
generation uses Stock's own lead-time data instead, making Procurement's
`procurement_supplier_lead_times` table currently disconnected from any
real business outcome.
