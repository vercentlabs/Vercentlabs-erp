# F044 Order amendments — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `amendSalesOrder`/`approveSalesOrderAmendment`/`rejectSalesOrderAmendment` in full (`services/api/src/modules/sales/index.js:2327-2591, 2593-2656+`) and the `sales.order.amendment.approve` command definition (`apps/web/src/orchestration/approvals.ts:173-195`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FLOW-001 (governed amendment) | PASS | `amendSalesOrder` only accepts `confirmed`/`on_hold` orders, requires a mandatory `amendmentReason`, and **unconditionally** routes every amendment through approval (`lifecycle_status='pending_approval'`) — stricter than quotations, which only require approval past a configured threshold; a real design choice given an order amendment is changing an already-committed commercial document. |
| CAP-002 (protects committed downstream activity) | PASS | Blocks amendment outright once any `fulfilled_quantity + invoiced_quantity + returned_quantity` exists on the current version (`:2335-2347`), with an explicit message directing the user to a controlled cancellation/downstream adjustment instead — can't rewrite commercial terms out from under work that's already happened. |
| CAP-002 (what can't change) | PASS | Explicitly rejects an amendment that would change the order's `companyId`, `partyId`, or currency (`:2351-2370`) — an amendment can't be abused to effectively swap the customer or company on an existing order. |
| DATA-002/BR-002 (versioning) | PASS | Creates a new `sales_order_versions` row (incremented `version_number`, own `content_hash`) with fresh line/progress/schedule rows — identical immutable-versioning mechanics already verified for quotations (F037), applied consistently to orders. |
| CAP-002/FLOW-002 (resume to correct prior state) | PASS | The approval's `command_payload` captures `resumeStatus: order.lifecycle_status` at request time, and the `sales.order.amendment.approve` command strictly validates it as `enum(["confirmed","on_hold"])` — an amendment on a `held` order correctly resumes to `on_hold` after approval, not unconditionally to `confirmed`. |
| SEC-001 (entity-specific approval permission) | PASS | Uses the exact same `permission: PERMISSIONS.salesOrderApprove` gate on the shared approval route already verified for F036/F041 — the 2026-09-05 reject-permission fix applies here too. |
| FLOW-002 (concurrency) | PASS | The version-swap `UPDATE` is conditioned on both `current_version_id=$5 AND lifecycle_status=$6` matching what was read at the start of the function, throwing `SALES_ORDER_VERSION_CONFLICT` on a concurrent change — can't submit an amendment against a stale view of the order. |
| AUDIT | PASS | `sales_order_amendments` is its own append-only table (`from_version_id`/`to_version_id`/`reason`/`approval_request_id`), separate from the generic `sales_document_events` stream that also records `sales_order.amendment_submitted` — two independent, cross-checkable audit trails for the same action. |
| CAP-002 (write-in policy) | Same gap already recorded for F033/F042 — amendment lines inherit the same catalog-item-only model. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / UX-001-003 / VAL-001/002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

No new gap. This is some of the most careful engineering found in Sales so far — unconditional approval for any commercial amendment, explicit "what can't change" boundaries, protection against amending an order with real downstream activity, and correct resume-to-prior-state handling that a lazier implementation would easily have gotten wrong (defaulting back to `confirmed` regardless of whether the order was actually on hold).
