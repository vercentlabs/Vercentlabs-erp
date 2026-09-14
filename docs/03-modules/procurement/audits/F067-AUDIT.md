# F067 Purchase requisitions — Atomic requirement trace

Dossier lifecycle: `DRAFT -> SUBMITTED -> PENDING_APPROVAL -> APPROVED/
REJECTED -> SOURCING/ORDERED -> CLOSED/CANCELLED`.

`requisitions` is a real top-level document resource. Backend:
`normalizeDocument`'s `requisitions` case (`index.js:504-512`) requires
`title`, `needByDate`, at least one line (`array(..., {required:true})`),
computes real `totals` (`calculateTotals`). `TRANSITIONS.requisitions`
(`index.js:1286-1292`): `submit/approve/reject/close/cancel`. UI: real
list/detail/create pages (`apps/web/src/app/(app)/procurement/
requisitions/{page.tsx,[id],new}`) with action buttons wired exactly to
this transition table (`ACTIONS.requisitions` in `procurement-workspace.tsx`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001/US-001 | PASS | Full create/submit/approve/reject/close/cancel workflow, server-validated, permission-gated (`procurement.requisition.create`/`.manage`/`.approve`), real UI with matching action buttons. |
| FLOW-001 (lifecycle fidelity) | PARTIAL | Code lacks a distinct `SOURCING`/`ORDERED` status — an approved requisition stays `approved` even after a PO references it via `requisitionId` (`DOCUMENT_REFERENCE_COLUMNS["purchase-orders"].requisitionId`). There is no visible link-back on the requisition itself showing which PO(s) consumed it, and no partial-consumption tracking (a requisition with 3 lines could be split across multiple POs with no reconciliation of how much is still open). |
| DATA-002/BR-002 (line-level consumption tracking) | **GAP.** No `consumedQuantity`/`orderedQuantity` field exists on requisition lines — unlike PO lines (`receivedQuantity`/`invoicedQuantity`), requisition lines have no equivalent, so there's no way to tell how much of a requisition line has actually been converted into a purchase order. A requisition could be over-converted into multiple overlapping POs with nothing to prevent it. |
| VAL-001/002, BR-001 | PASS | Standard shared-engine validation; `needByDate` and at least one line are required server-side. |
| SEC-001/002 | PASS | Standard permission/company/RLS scoping, same as every document resource. |
| **APP-001 (approval policy) — GAP.** | **Confirmed.** `approve` is a single-permission gate (`procurement.requisition.approve`) with the self-approval guard (creator cannot approve their own requisition — real, tested-by-inspection). There is **no amount/category/budget-based approval routing** at all — a $10 stationery requisition and a $10,000,000 capital requisition go through the exact same single approval step. `grep`ed the whole module for "threshold": zero matches anywhere. This directly contradicts the dossier's explicit "deterministic approval policy based on amount, category, organization, budget, risk" requirement (F068's own scope) and is the single biggest gap in this cluster. |
| CONCURRENCY/IDEMPOTENCY | PASS | Optimistic version check on every transition; standard `ON CONFLICT DO NOTHING` + idempotency-key replay on create. |
| NOTIF-001, INT-001/002 | GAP (module-wide) | See F063 — outbox never consumed. |
| UX-001-003 | PASS (generic, functional) | Real list/detail/create pages; action buttons match backend transitions exactly. No amendment/audit-trail viewer beyond the raw field grid, but the core workflow is usable. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The requisition document itself is solid, real, and usable end-to-end
through the UI. The two real gaps are structural rather than cosmetic:
(1) no line-level consumption tracking against downstream POs, so a
requisition's "how much is left to order" is unanswerable, and (2) approval
is a flat single-permission gate with no amount/category-based routing —
this is the same class of gap Sales found and left open for its own
approval infrastructure (F041). Both are real, scoped, fixable in a
dedicated pass; neither is a security hole.
