# F073 Supplier selection — Atomic requirement trace

Dossier: select/award one or more suppliers with justification, split-award
policy, approval, immutable evaluation evidence, controlled conversion to
an agreement or PO. Lifecycle: `PROPOSED -> PENDING_APPROVAL -> AWARDED/
PARTIALLY_AWARDED or REJECTED/CANCELLED -> CONVERTED`.

`awardSourcingEvent` (`index.js:1752-1908`) is the real implementation.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FLOW-001 (award mechanism) | PASS (real, well-built) | `FOR UPDATE` lock on the sourcing event, optimistic version check, duplicate-award prevention (checks `procurement_sourcing_awards` and `sourceRow.data?.award` before proceeding — `PROCUREMENT_AWARD_ALREADY_EXISTS`), supplier-eligibility check before award (`loadReference(..., allowedStatuses: ["qualified","active"])`), award-type union (`purchase-order` or `agreement`), and the created downstream document uses an idempotency key tied to the sourcing event (`sourcing-award:${source.id}`) so a retried award call cannot double-create a PO/agreement. This is genuinely solid engineering — matches the module's best work (comparable to F080's `applyReceiptToOrder`). |
| **CAP-002 — split-award / partial award.** | **GAP, confirmed absent.** `awardSourcingEvent` awards exactly **one** bid to exactly **one** supplier per call; there is no mechanism to split one sourcing event's lines across multiple suppliers/bids in a single governed award, and no `PARTIALLY_AWARDED` status exists anywhere in `TRANSITIONS["sourcing-events"]` (only `closed`). |
| **CAP-002 — justification/approval before award.** | **GAP.** `awardSourcingEvent` requires only `procurement.sourcing.award` permission — no reason/justification field is captured, and no approval step exists between "evaluation complete" and "award executed" (contrast with PO amendments, which do have a real approve/reject decision step). Given F072's finding that award doesn't even consult an evaluation record, this compounds: an award today is an un-justified, unreviewed single action. |
| DATA-002 (award audit) | PASS | The `procurement_sourcing_awards` table is a real, permanent, non-generic audit table (not the generic child-resource pattern) capturing `award_type`/`selected_bid_id`/`supplier_id`/`created_record_id`/`award_payload` — genuinely good immutable evidence of who was awarded what and what document it produced. |
| INT-001/002 (conversion to agreement/PO) | PASS | Award creates a real `agreements` or `purchase-orders` document via the same `createProcurementRecord` path everything else uses (not a shortcut/duplicate), with `sourceEventId`/`selectedBidId` persisted on the created document (`DOCUMENT_REFERENCE_COLUMNS`) for lineage back to the RFQ. |
| UX | **GAP, confirmed.** As found in F072: the only award UI is three `window.prompt()` dialogs (selected bid ID, supplier ID, expected delivery date) — no bid picker, no comparison, no justification field, no confirmation dialog showing what's about to happen. Functionally reachable but far below the "governed workspace" bar the dossier and the completion brief both require. |
| SEC-001 | PASS | Real permission gate + supplier-eligibility check. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The award **mechanism** (locking, idempotency, eligibility check, audit
table, real document creation) is some of the best-engineered code in the
whole module. What's missing is everything around it that makes it a real
enterprise workflow: no split-award, no justification/approval gate, and a
`window.prompt()`-based UI that makes the underlying quality of the backend
invisible to an actual user. Given the backend is solid, this is primarily
a UI investment for the gap-closing pass, plus a scoped decision on whether
split-award is in scope for the current release.
