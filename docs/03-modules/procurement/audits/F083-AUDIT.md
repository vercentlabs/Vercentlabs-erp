# F083 Purchase returns — Atomic requirement trace

Dossier: authorize/track returns to supplier from eligible receipts with
quantity lineage, reason, shipment, stock reversal, debit/financial
correction coordination. Lifecycle: `DRAFT -> SUBMITTED -> APPROVED ->
DISPATCHED -> SUPPLIER_RECEIVED/CLOSED or REJECTED/CANCELLED`.

`returns` is a real document resource. `normalizeDocument`'s case
(`index.js:556-560`) requires `receiptId`, `reason`, at least one line.
`validateDocumentReferences` requires the referenced receipt to be
`approved/received/reversed` and back-fills `purchaseOrderId`/`supplierId`
from it. `TRANSITIONS.returns`: `submit/approve/dispatch/close/reject`
(`index.js:1328-1334`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FLOW-001 | PASS | Real create/submit/approve/dispatch/close/reject workflow, permission-gated (`procurement.returns.manage`), matches the dossier's lifecycle closely (draft→submitted→approved→dispatched→closed, with reject as an alternate to approved). UI action buttons exist (`ACTIONS` map not explicitly checked for `returns` in the workspace component this pass — the `pass1-operations-workspace`'s `create-purchase-return` action is the confirmed create path). |
| **INT-001/002 — stock reversal.** | **GAP, confirmed absent — same root cause as F080.** No orchestration exists connecting Procurement to Stock in either direction; dispatching a return does not decrement any Stock quantity. |
| **INT-001/002 — debit/financial correction.** | **GAP, confirmed absent.** `grep`ed for `debitNote`/`debit_note`/`creditNote`: zero matches. A dispatched return has no linkage to any Accounting debit note or payable adjustment — the supplier relationship's financial side is untouched by a return in the system today. |
| DATA-002 (quantity lineage) | PASS | `receiptId` is required and validated; the return correctly derives its `purchaseOrderId`/`supplierId` from the receipt rather than letting a caller supply inconsistent values. |
| SEC-001 | PASS | Standard scoping. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The return document's own lifecycle and lineage-back-to-receipt are real
and correctly validated. The two things that would make a return actually
*mean* something operationally — reversing the Stock quantity it claims to
return, and creating the financial correction with the supplier — are both
unbuilt, consistent with the module's broader Stock/Accounting integration
gap.
