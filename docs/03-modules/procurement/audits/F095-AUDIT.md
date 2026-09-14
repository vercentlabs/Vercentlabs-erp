# F095 Subcontract purchasing — Atomic requirement trace

Dossier: create/trace a subcontract purchase tied to Manufacturing demand
and receipt evidence. Lifecycle: `DRAFT -> ORDERED -> IN_SUBCONTRACT ->
PARTIALLY_RECEIVED/RECEIVED -> CLOSED or FAILED/CANCELLED/RETURNED`.

`createProcurementSubcontractOrder` (`pass1-operations.js:90-100`) is the
implementation. Real UI: `pass1-operations-workspace.tsx`'s
`create-subcontract` action.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (capture) | PASS | Requires a supplier (validated `qualified`/`active` via the shared `supplier()` helper), optionally a linked PO with a company cross-check, an optional item (validated active + company-scoped), a positive quantity, an optional expected-return date (validated as a real date). Real, permission-gated (`procurement.po.create`) create path with a working form. |
| **CAP-001 — actual lifecycle/status tracking.** | **GAP, confirmed absent.** `tenant.procurement_subcontract_orders` is a flat record with no `status` column exposed through this function — no transition table exists for subcontract orders (`TRANSITIONS` has no `subcontract-orders` entry). The dossier's `DRAFT -> ORDERED -> IN_SUBCONTRACT -> PARTIALLY_RECEIVED/RECEIVED -> CLOSED` lifecycle does not exist; a subcontract order is created once and has no further governed state changes. |
| **CAP-001 — Manufacturing demand linkage.** | PARTIAL | `referenceType`/`referenceId` are free-form fields (`text(input.referenceType,100)`, `uuid(input.referenceId,"Reference")`) that *could* point to a Manufacturing work order, but nothing validates that the reference actually exists in Manufacturing or belongs to the same organization — this is an unvalidated, unenforced pointer, not a real cross-module contract (contrast with F094's `reorder-purchasing.js`, which does real cross-context validation). |
| **CAP-001 — receipt evidence / material issued to subcontractor.** | **GAP, confirmed absent.** No linkage to `receipts` or to any Stock movement (material sent to the subcontractor, finished goods received back) exists. |
| SEC-001 | PASS | Company cross-validation between supplier/linked PO/item. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

This is capture-only: a subcontract order record can be created with
validated references, but there is no lifecycle, no enforced Manufacturing
linkage, and no receipt/material-flow tracking. Closer to `FOUNDATION
ONLY` than a working feature.
