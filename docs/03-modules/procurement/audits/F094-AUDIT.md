# F094 Reorder-generated purchasing — Atomic requirement trace

Dossier: turn a Stock replenishment need into exactly one governed
procurement effect. Lifecycle: `REQUESTED -> PROPOSED/CONSOLIDATED ->
RFQ/PO_CREATED -> RECONCILED or FAILED/CANCELLED`.

`generateReorderPurchasingRequests` (`services/api/src/orchestration/
reorder-purchasing.js`, already read in full) + `createProcurementReorderRequest`
(`pass1-operations.js:80-88`) is the implementation — genuinely the
**cleanest cross-module integration found in the entire module**, in
sharp contrast to the missing Procurement→Stock direction (F080).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/INT-001 | PASS, real orchestration | Lives in `services/api/src/orchestration/` (the correct architectural location per the constitution, not inside either module) — calls Stock's public `listStockReorderCandidates` (read-only) and Procurement's own `createProcurementReorderRequest`, never touching the other module's private tables directly. Explicit organization/company cross-context validation before doing anything (`stockContext.organizationId !== procurementContext.organizationId` throws). |
| **INT-001/002 — "exactly one governed procurement effect" (idempotency).** | PASS, correctly implemented | `createProcurementReorderRequest` requires an idempotency key and replays the existing row on a duplicate call (`SELECT ... WHERE idempotency_key=$2` before insert) — the orchestrator builds this key from `reorder-rule-id + required-by-date` (`reorder:${candidate.reorderRuleId}:${required.toISOString().slice(0,10)}`), so re-running the reorder generation job twice for the same rule/day cannot create duplicate requests. This is exactly the "exactly one effect" guarantee the dossier asks for. |
| **CAP-001 — this only creates a *request*, not an RFQ or PO.** | GAP (by design, one step short of dossier scope) | The dossier's lifecycle ends at `RFQ/PO_CREATED`; the actual code only reaches `procurement_reorder_requests` — nothing automatically converts a reorder request into a real requisition/RFQ/PO. A buyer still has to manually pick up the reorder request and create the downstream document by hand (via the generic `pass1-operations-workspace`'s "reorder-requests" resource list). |
| SEC-001 | PASS | Company-context cross-check between Stock and Procurement, permission-gated (`procurement.po.create`). |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

This is the best cross-module integration example in the whole module —
correct location, correct idempotency, correct organization/company
cross-validation, using only public contracts. The one real gap is scope:
it stops at "a reorder request exists," one step short of automatically
producing a requisition/RFQ/PO. If Stock-driven auto-purchasing is a
release requirement, closing that last step (or explicitly deciding it's
out of scope, matching the buyer-in-the-loop pattern) should be a
deliberate product decision, not an oversight.
