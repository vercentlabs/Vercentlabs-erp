# F075 PO approvals — Atomic requirement trace

Same structural pattern as F068 (Requisition approvals), traced separately
per the register. Dossier: maker-checker + threshold/risk-based approval,
no dispatch/commitment before approval is current and valid. Lifecycle:
`NOT_REQUIRED or PENDING -> APPROVED/REJECTED/EXPIRED/CANCELLED; material
change invalidates stale approval`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (approval gate exists and is enforced before dispatch) | PASS | `TRANSITIONS["purchase-orders"].approve` requires status `submitted`/`pending_approval`, and `dispatch` requires status `approved` — a PO **cannot** be dispatched without first passing through `approve` (`index.js:1309,1311`). Self-approval blocked. Rejection requires a reason. This correctly enforces the dossier's core invariant: no commitment before valid approval. |
| **CAP-002 — threshold/risk-based routing.** | **GAP, confirmed absent** — identical finding to F068; no amount/category/risk-based routing exists anywhere in the module. |
| **CAP-002 — "material change invalidates stale approval".** | PASS, by a different (arguably stronger) mechanism. A PO cannot be edited at all once `approved` (`updateProcurementRecord` only allows `draft`/`rejected`); the *only* way to change an approved PO is `amendPurchaseOrder`, which itself requires a fresh approval cycle (`pending_amendment_approval` -> `approve-amendment`/`reject-amendment`) before the change takes effect, with the pre-amendment approval's original data restorable on rejection. There is no scenario where a stale approval could silently survive a material edit — the amendment gate structurally prevents it. |
| CONCURRENCY | PASS | Version-checked on `approve`, on `amendPurchaseOrder`, and on `approvePurchaseOrderAmendment`/`rejectPurchaseOrderAmendment` independently — three separate optimistic-lock checkpoints across the approval-then-amend lifecycle. |
| SEC-001 | PASS | `procurement.po.approve` permission required for both the initial approval and every amendment decision. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

This is the strongest approval implementation found in the module —
better than the plain requisition-approval gate (F068) because the
amendment-approval cycle genuinely solves the "stale approval after
material change" problem the dossier worries about, rather than just
locking the record. The one real, consistent gap across both approval
features is the complete absence of threshold/risk-based routing — every
PO, regardless of value, needs exactly one approval from one permission
holder.
