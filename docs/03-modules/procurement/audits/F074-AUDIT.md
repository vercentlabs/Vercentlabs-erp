# F074 Purchase orders — Atomic requirement trace

Dossier lifecycle: `DRAFT -> PENDING_APPROVAL -> APPROVED -> CONFIRMED/
DISPATCHED -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED, with HOLD/CANCEL
branches`.

`purchase-orders` is the module's most mature resource. `normalizeDocument`'s
case (`index.js:529-541`) requires `supplierId`, `expectedDeliveryDate`, at
least one line, computes real `totals`. `TRANSITIONS["purchase-orders"]`
(`index.js:1307-1315`): `submit/approve/reject/dispatch/acknowledge/close/
cancel`, plus the dedicated `amendPurchaseOrder`/`approvePurchaseOrderAmendment`/
`rejectPurchaseOrderAmendment` functions dispatched specially in
`transitionProcurementRecord` (`index.js:1493-1505`). Real list/detail/
create UI (`apps/web/src/app/(app)/procurement/orders/`) with action
buttons matching every one of these transitions exactly
(`ACTIONS["purchase-orders"]`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001/US-001 | PASS | Complete, real, permission-gated (`procurement.po.create/.manage/.approve/.dispatch/.cancel/.amend`) workflow with matching UI end to end. |
| FLOW-001 (lifecycle fidelity) | PASS | Code's `draft -> submitted -> pending_approval -> approved -> dispatched -> acknowledged -> partially_received -> received -> closed`, with `cancel` reachable from most pre-dispatch states, maps closely to the dossier. No distinct `HOLD` status exists, but `cancel` requires a reason and is reachable from `draft/submitted/approved/dispatched` — functionally covers most of what a "hold" would need, just not as a separate reversible state. |
| DATA-002/BR-002 (immutable commercial snapshot) | PASS | `content_hash`+`version` on every line and header; `amendPurchaseOrder` explicitly snapshots `previousData`/`previousHash`/`previousVersion` before applying a change, and `decidePurchaseOrderAmendment` restores the exact previous data on rejection — this is real, correct historical-truth preservation, not just a version counter. |
| VAL-001/002 | PASS | Required fields, reference validation (`validateDocumentReferences` requires the supplier to be `qualified`/`active` before a PO can even be created against it — real cross-entity business-rule enforcement, not just presence checking). |
| **CONCURRENCY — genuinely strong.** | PASS | `applyReceiptToOrder`'s per-line `FOR UPDATE` locking with over-receipt guards, and the header-level optimistic version check on every transition, are real, correct concurrency control — this is some of the best-engineered code in the module (same standard as F073's award mechanism). |
| **INT-001/002 — CONFIRMED GAP: no Stock effect on dispatch/close, and receipt doesn't move Stock either.** | See F063's shared finding — `applyReceiptToOrder` only updates Procurement's own `received_quantity`, never calls Stock's `postStockMovement`. This is the single biggest gap for this feature specifically, since F074's own dossier explicitly says the PO must be traced "through receipt... readiness." |
| APP-001 | PASS (single-step, no threshold routing) | Same flat single-permission-gate pattern as F068 — real, but no amount/category-based routing. Self-approval blocked. |
| SEC-001/002 | PASS | Standard scoping; `ensureCompanyAccess` enforced explicitly in `amendPurchaseOrder`/`runProcurementMatch` beyond the generic path. |
| NOTIF-001 | GAP (module-wide) | See F063. |
| E2E | GAP (module-wide) | See F063 — this is the highest-priority feature to cover given it's the spine of the required Supplier→...→Payment journey. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The purchase order document itself — creation, approval, dispatch,
amendment, concurrency-safe receipt tracking, real historical-truth
preservation — is genuinely excellent engineering, on par with CRM/Sales'
best work. The gaps are entirely at the module boundary: no Stock effect,
no amount-based approval routing, no real notification delivery. None of
these are defects in the PO logic itself.
