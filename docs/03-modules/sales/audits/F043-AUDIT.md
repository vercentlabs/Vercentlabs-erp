# F043 Order confirmation — Atomic requirement trace

This feature is `confirmSalesOrder` itself (`services/api/src/modules/sales/index.js:1756-1875`), already read in full for F042. This audit focuses on what's distinct to confirmation specifically rather than re-deriving the whole order lifecycle.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 (atomic guarded commitment) | PASS | Already verified for F042: cascading auto-submit-if-draft, approval-status guard, advisory-locked credit check, and a final `UPDATE ... WHERE lifecycle_status='approved' AND current_version_id=$5` that fails with a stable `SALES_ORDER_VERSION_CONFLICT` rather than silently confirming a superseded version. |
| CAP-002 (credit/approval guards) | PASS | Same evidence as F042 — credit-exposure check with `pg_advisory_xact_lock`, mandatory override permission + reason. |
| CAP-002 (immutable snapshot) | PASS | Confirmation freezes `confirmed_quantity=line.quantity` on every line's progress row at the moment of confirmation (`:1847-1852`) — the commercially-committed quantity is captured once, not re-derived later from a mutable source. |
| CAP-002 (idempotency / exactly-once) | PASS (reject-on-repeat pattern) | A second confirm attempt on an already-`confirmed` order hits the `lifecycle_status !== "approved"` guard and throws a stable `409`, rather than silently repeating the credit check or double-firing the opportunity-close side effect — a valid "exactly once, retry gets a clear signal" idempotency shape, not a silent no-op, but also not a false success. |
| CAP-002 (availability policy) | PASS (by design — separated concern) | `confirmSalesOrder` does not check stock availability at all; `reserveSalesOrderLines` (`order-governance.js`, verified F042) is a distinct, later step, and the order's own health model tracks `readyToFulfill` as a post-confirmation state. This reads as intentional separation of commercial confirmation from stock reservation (supporting backorder scenarios), not a gap — F045/F046 own availability/reservation as their own capabilities. |
| **CAP-003 (cross-module boundary) — this is where the F042 finding actually lives.** | FAIL | The raw `UPDATE tenant.crm_opportunities SET status='won'...` bypass of CRM's `moveOpportunityStage` (fully detailed in F042's audit) fires from inside this exact function. F043's own dossier explicitly names this requirement ("use public contracts/orchestration for CRM... effects"), so this finding is squarely F043's, restated here rather than duplicated — see F042-AUDIT.md for full detail. |
| CAP-002 (confirmation communication) | Same standing cross-feature notification-delivery gap already noted for F038/F041 — no notification is inserted anywhere in `confirmSalesOrder`. |
| CAP-002 (downstream failure) | PASS | The opportunity-close `UPDATE` and the confirmation `UPDATE` both run inside the same caller-managed transaction (`tenantTransaction`, verified at the route layer for every Sales mutation) — if the opportunity update somehow failed, the whole confirmation would roll back rather than leaving a half-confirmed order. |
| AUTO-001 / NOTIF-001 (beyond above) / REP-001 / AI-001 / UX-001-003 / VAL-001/002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

No new gap beyond the F042 finding restated in its proper place — this dossier is actually the more precise home for that cross-module boundary violation, since it's specifically about what confirmation is allowed to touch. Everything else confirmation-specific (atomicity, guards, immutable snapshot, idempotent rejection of repeat attempts) is solid.
