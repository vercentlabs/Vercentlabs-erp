# F068 Requisition approvals — Atomic requirement trace

Dossier wants deterministic approval **policy** routing by amount/category/
org/budget/risk/SoD, delegation, stale-approval invalidation. Lifecycle:
`NOT_REQUIRED or PENDING -> APPROVED/REJECTED/DELEGATED/EXPIRED/CANCELLED
with resubmission after material change`.

This is not a separate resource — it's the `approve`/`reject` transitions on
`requisitions` (see F067). Traced separately here because the dossier
treats approval *policy* as its own capability.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (approval mechanism exists) | PASS (minimal) | `approve: [["submitted","pending_approval"],"approved","procurement.requisition.approve"]`, `reject: [...,"rejected",...]` are real, permission-gated, version-checked transitions (`index.js:1288-1289`). Self-approval blocked (`current.created_by === context.userId` throws `PROCUREMENT_SELF_APPROVAL` for the `approve` action). Rejection requires a reason (`text(input.reason, "Reason", {required:true})` for the `reject` action). |
| **CAP-002 — amount/category/budget/risk-based routing.** | **GAP, confirmed absent module-wide.** No threshold table, no per-category or per-amount routing rule exists anywhere in `procurement/index.js` or `governance.js` (`grep -n "threshold"` across the whole module returns only an unrelated supplier-score warning string). Every requisition, regardless of value, goes through exactly one approval step gated by one flat permission. This is the same gap Sales left open for its own approval infrastructure (F041) — Procurement never built even that much. |
| **CAP-002 — delegation.** | **GAP, confirmed absent.** No mechanism to reassign a pending approval to another user exists (mirrors Sales' F041 finding exactly — grepped `approval_requests` usage across Procurement: zero). |
| **CAP-002 — stale-approval invalidation.** | **GAP.** A requisition can't be edited once `submitted`/`pending_approval` (`updateProcurementRecord` only allows edits while `draft`/`rejected`), so there's no scenario where an approval could go stale from a mid-flight edit — this specific dossier concern is moot given the current edit-lock design, which is arguably the safer (if less flexible) choice. Recording as N/A rather than a gap. |
| **CAP-002 — multi-level/parallel approval chains.** | **GAP, confirmed absent.** One decision point only; no chain, no parallel reviewers. |
| DATA-002/FR-002 (audit) | PASS | `event()`+`outbox()` fire on every approve/reject with the reason captured in the payload — real, permanent audit trail for the decision itself (even though the outbox side is never consumed, per F063). |
| SEC-001 | PASS | Standard permission/org/company scoping. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The one approval step that exists is real and correctly guards against
self-approval, but the dossier's actual scope for this feature — policy-
driven routing by amount/category/budget/risk, delegation, multi-level
chains — is **entirely unbuilt**. This is a bigger, more structural gap
than a quick fix; budget it as its own scoped piece of work in the
consolidated gap-closing pass (the task brief's required Supplier →
Requisition → RFQ → PO → GRN → Bill → Payment E2E journey only needs the
*existing* single-step approval to work correctly, which it does — the
policy-routing gap doesn't block that journey, but must not be
misrepresented as done).
