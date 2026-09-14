# F076 PO amendments — Atomic requirement trace

Dossier: controlled post-approval amendments with versions, reasons,
reapproval, supplier communication, reconciliation of receipts/invoices/
downstream demand. Lifecycle: `CONFIRMED -> AMENDMENT_PENDING ->
CONFIRMED(new version) or REJECTED/CANCELLED; downstream deltas reconcile
before closure`.

`amendPurchaseOrder`/`decidePurchaseOrderAmendment` (`index.js:1549-1750`)
is the real implementation, already partly evidenced in F074/F075.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FLOW-001 | PASS | `FOR UPDATE` lock, only reachable from `approved/dispatched/acknowledged/partially_received`, mandatory reason (`text(input.reason, ..., {required:true})`), version-checked, produces a `pending_amendment_approval` state that itself requires a decision before the order continues. Rejection restores the exact pre-amendment `data`/references/children via `nextData = {...pending.previousData}` — genuinely correct rollback, not just a status flip. |
| DATA-002 (amendment lineage) | PASS | Every amendment is appended to a permanent `amendments` array on the order itself (`amendmentId`, `requestedAt/By`, `reason`, `previousStatus/Version/Hash`, then `status: "approved"/"rejected"` with decision metadata) — a genuinely complete, queryable audit trail of every proposed and decided change, not just the current state. |
| **CAP-002 — reconciliation of receipts/invoices against the amended quantities.** | **GAP, confirmed not verified as safe.** `amendPurchaseOrder` calls `replaceChildren`, which **deletes and recreates every line** for the order (`DELETE FROM ... WHERE parent_id=$2` then re-insert). Line-level `received_quantity`/`invoiced_quantity` are part of the submitted line payload (`normalizeDocument`'s `purchase-orders` case explicitly re-validates `receivedQuantity`/`invoicedQuantity` on every submit, defaulting to `0` if not supplied) — **if the amendment payload doesn't carry forward the existing received/invoiced quantities from `hydrateChildren`, an amendment could silently reset a partially-received/partially-invoiced order's progress to zero.** The UI's `amend` action (`window.prompt` for a reason only, no field-level amendment editor) doesn't appear to construct a full line payload at all, so in practice this path may be effectively unreachable from the UI as built — but the API-level risk is real and not proven safe by any test found this pass. **This needs a direct test before the gap-closing pass ships anything using amendment.** |
| SEC-001, CONCURRENCY | PASS | Standard scoping; version-checked at both the amend and decide steps. |
| **NOTIF-001 (supplier communication).** | GAP (module-wide) | See F063 — no outbox consumer exists, so a dispatched amendment never reaches the supplier through any evidenced path. |
| UX | PARTIAL | The approve-amendment/reject-amendment buttons exist and call the real backend, but there is no UI to actually **view what changed** in a pending amendment (the `pendingAmendment.previousData` diff isn't rendered anywhere) before deciding — an approver is asked to approve or reject blind. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The amendment *state machine* and rollback-on-reject logic are genuinely
excellent — better than most ERP ports of this feature. The one finding
serious enough to flag ahead of the gap-closing pass is the received/
invoiced-quantity carry-forward risk in `replaceChildren` — this needs a
real integration test (create PO → receive partially → amend → verify
`receivedQuantity` survives) before anything in the consolidated pass
relies on amendment being safe for an in-flight order.
