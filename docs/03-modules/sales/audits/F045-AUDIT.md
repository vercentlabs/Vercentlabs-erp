# F045 Availability check — Atomic requirement trace

**Correction (2026-09-06):** this audit originally claimed the entire capability was missing, based on a grep scoped only to `services/api/src/modules/sales/`. That grep was incomplete — it missed `services/api/src/orchestration/`, a separate directory holding real cross-module orchestration code. `services/api/src/orchestration/sales-stock-reservation.js` genuinely implements this capability. Corrected below.

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `checkSalesOrderLineAvailability` in full (`services/api/src/orchestration/sales-stock-reservation.js:1-15`) and its regression coverage (`apps/web/tests/pass1-f015-f114.test.mjs:71`, `services/api/tests/pass1-f015-f114-runtime.test.mjs`), and confirming it's wired to a live route (`apps/web/src/app/api/sales/pass1-operations/route.ts`, `action: "check-availability"`) with UI (`pass1-operations-workspace.tsx`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 (explainable availability promise from Stock-owned data) | PASS | `checkSalesOrderLineAvailability(client, salesContext, stockContext, input)` resolves the Sales order line via `getSalesOrderLineReservationContext` (validates the order is `confirmed`, the line has a warehouse assigned, and computes `remainingReservableQuantity = confirmed - fulfilled - cancelled - reserved`), cross-checks that the Sales and Stock contexts agree on `organizationId` **and** `activeCompanyId` (`SALES_STOCK_CONTEXT_INVALID`/`SALES_STOCK_COMPANY_MISMATCH` — a real safeguard against querying availability in the wrong company), then calls Stock's own public `getStockAvailability` for the actual on-hand/reserved/available-to-promise figures. This is genuine cross-module orchestration, not a stub. |
| CAP-002 (multi-warehouse) | PASS | Availability is checked against the specific `warehouseId` already assigned to the order line — not an org-wide aggregate. |
| CAP-002 (batch/serial constraints, incoming supply, lead time, alternative dates/items) | NOT INDEPENDENTLY VERIFIED THIS PASS | `getStockAvailability` itself (Stock's side) wasn't re-traced in full for these specific refinements. |
| CAP-002 (stale availability) | PASS | Availability is computed fresh on each call (no caching), and `checkSalesOrderLineAvailability` re-derives `remainingReservableQuantity` from live `sales_order_line_progress` on every invocation. |
| CAP-003 (module boundary) | PASS | Availability data comes exclusively from Stock's own public function; Sales never queries `tenant.stock_balances` directly. |
| FR-003/PERF-001 | Not a concern for this capability — a per-line check, not a list endpoint. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / UX-001-003 / VAL-001/002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06, corrected)

This capability is real and correctly built, reachable through the `pass1-operations` workspace rather than the main quotation/order creation flow. The original "complete absence" finding was a research error — caused by grepping only `modules/sales/` and missing the separate `orchestration/` directory where this module's cross-module integration code actually lives. No gap recorded for this feature after correction.
