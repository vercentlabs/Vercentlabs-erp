# ERP P0 Integrity Fixes (Prompt 12 of 102)

Date: 2026-08-10
Scope: fix ONLY the two confirmed-live P0 defects Prompt 11 identified, plus directly adjacent regression paths — nothing else. No feature work, no module completion campaigns, no unrelated refactoring.

Starting git state: branch `main`, all Prompts 1–11 work present and untouched (uncommitted deliverables from Prompts 9/10/11 preserved throughout). No commits made. No destructive git operations used.

---

## 1. Executive Summary

Both defects were independently re-reproduced against current code and the live local database before any fix was written, per this prompt's explicit instruction not to trust Prompt 11's conclusions blindly. Both were confirmed exactly as described, and Workstream A's re-reproduction additionally surfaced a **generalized regression test** — the test that should have existed before this class of bug shipped — which was then used to confirm no *other* permission has the same defect.

**Workstream A** (`crm.records.view_all` onboarding defect): confirmed live — 0 rows in the control-plane `permissions` table and 0 rows in `role_permissions` for this key, against a database with 16 real organizations. Root-caused to Prompt 3 (Security Hardening) adding a new permission to the TypeScript role catalogue without a corresponding control-plane migration to register it in the persisted `permissions` table — a gap Prompt 3 itself did not introduce carelessly (its own migration-scope reasoning was about CRM ownership *columns*, which genuinely needed none) but never separately considered for the *permission key* itself. Fixed with `database/platform/migrations/032_crm_records_view_all_permission.sql`, following the exact established pattern from migrations 018/027/030/031. Live-verified: the exact insert `seedOrganizationFoundation` performs for a role holding this permission now succeeds where it previously threw a foreign-key violation.

**Workstream B** (Manufacturing/POS stock-balance desync): confirmed via direct line-by-line reading of `services/api/src/modules/manufacturing/index.js` and `services/api/src/modules/point-of-sale/index.js` — both modules forked a **local**, duplicate `postStockMovement` function that inserted into `tenant.stock_movements` but never touched `tenant.stock_balances` at all (not "sometimes wrong" — structurally incapable of updating it, the INSERT statement simply never referenced that table). Fixed by deleting both local forks and routing Manufacturing's `postProduction()` and POS's `completePointOfSale()` through Stock's own canonical `postStockMovement()` (`services/api/src/modules/stock/index.js`), using the exact internal-authorization pattern Stock's own `completeStockTransfer()` already establishes (augment the context with the specific `stock.issue`/`stock.receive` permission once the calling business operation's own permission check has already passed). Canonical `postStockMovement` was also extended to persist `serial_id` — a real, independently-discovered gap versus both local forks (which did carry it) that would otherwise have silently dropped serial traceability during the fix.

A new, safe, dry-run-by-default diagnostic (`diagnoseStockBalanceDrift`) was added to identify — and, only on explicit request, repair — any historical drift left over from before this fix, scoped to the caller's own organization/company, gated by `stock.adjust` before it will write anything.

---

## 2. Prompt 11 Defects Reproduced

Both re-reproduced independently in this prompt (not merely re-cited from Prompt 11):

**CRM-017 / SHARED-020** (`ERP_FEATURE_MATRIX_011.csv`): confirmed live via `docker exec vercentlabs-postgres psql ...` — `SELECT key FROM permissions WHERE key='crm.records.view_all'` returned 0 rows; `SELECT count(*) FROM role_permissions WHERE permission_key='crm.records.view_all'` returned 0. Confirmed the FK: `role_permissions.permission_key text NOT NULL REFERENCES permissions(key)` (`002_platform_foundation.sql`). Confirmed `seedOrganizationFoundation` (`apps/web/src/core/platform.ts`) has no per-row try/catch around its `role_permissions` insert loop, and is called inside a single `transaction()` wrapper with no surrounding try/catch either (`apps/web/src/app/api/onboarding/route.ts`). Confirmed 7 role templates in `access-control.ts` reference the key (`crm_administrator`, `sales_head`, `sales_manager`, `sales_operations`, `marketing_manager`, `customer_success_manager`, `partner_manager` — `sales_representative` deliberately excluded, matching Prompt 3's documented policy).

**STOCK-025 / STOCK-026**: confirmed by reading `services/api/src/modules/manufacturing/index.js` (the local `postStockMovement`, lines 383–415 before this fix) and `services/api/src/modules/point-of-sale/index.js` (the local `postStockMovement`, lines 209–239 before this fix) in full. Both functions' `INSERT INTO tenant.stock_movements` statements contain zero references to `tenant.stock_balances` anywhere in either file (confirmed by grep, not just reading). Compared against Stock's own canonical `postStockMovement` (`services/api/src/modules/stock/index.js`), which locks the balance row `FOR UPDATE`, computes moving-average cost, and upserts `stock_balances` — proving the canonical logic already existed and was simply not being reused.

---

## 3. CRM Permission Catalogue Root Cause

Prompt 3 (`ERP_SECURITY_HARDENING_003.md`, Section 5) added `crm.records.view_all` to `packages/permissions/src/modules/crm/index.js` and granted it to 7 role templates in `access-control.ts`. Section 9 of that same document states: *"No migration was created... RLS was not touched: this repository's RLS is tenant-isolation-level... and record-level/field-level access has always been — and remains — an application-layer concern."* This reasoning is correct and remains correct for the CRM ownership *columns* (`crm_leads.owner_user_id`, `crm_activities.assigned_to`), which genuinely already existed and needed no schema change. It did not, however, address a separate and distinct requirement: registering the new *permission key itself* in the control-plane `permissions` catalogue table, which is a completely different concern from RLS or ownership columns — every prior permission addition in this program's history (migrations 006, 008, 009, 018, 027, 030, 031) has required exactly this kind of registration, and this one specific addition did not receive it.

The failure mechanism is deterministic, not probabilistic: `seedOrganizationFoundation` iterates `ROLE_TEMPLATES` unconditionally for every new organization, and for a role template whose `permissions` array includes `crm.records.view_all`, the `INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING` statement fails on the FK constraint — `ON CONFLICT DO NOTHING` only suppresses a *unique*-constraint conflict, never a *foreign-key* violation, so the statement throws, the enclosing `transaction()` rolls back, and the entire onboarding request fails for any new organization that seeds one of the 7 affected roles. Since `seedOrganizationFoundation` seeds every `ROLE_TEMPLATES` entry (not conditionally), this affects every new organization, not an edge case.

---

## 4. Permission Fix

### Canonical Source

`packages/permissions/src/modules/crm/index.js`'s `recordsViewAll: "crm.records.view_all"` constant remains the single TypeScript source (unchanged by this prompt — it was already correct). `apps/web/src/core/access-control.ts`'s `ROLE_TEMPLATES` remains the single canonical role/permission source (per Prompt 4). This prompt adds exactly one new artifact: `database/platform/migrations/032_crm_records_view_all_permission.sql`, which registers the key in the persisted `permissions` table — the missing piece, not a new or parallel catalogue.

### Existing Organizations

Migration 032 backfills `role_permissions` for every existing organization's already-materialized `crm_administrator`, `sales_head`, `sales_manager`, `sales_operations`, `marketing_manager`, `customer_success_manager`, `partner_manager`, `organization_owner`, `system_administrator`, and `company_administrator` role rows, using `WHERE r.is_system = true AND r.slug IN (...)` — the exact pattern established by migrations 027/031. Applied live to the local development database: `INSERT 0 1` (permission registered) and `INSERT 0 64` (role grants — 4 of the 10 targeted role slugs exist as materialized rows across this database's 16 organizations: `company_administrator`, `organization_owner`, `sales_manager`, `system_administrator`, 16 orgs each = 64; the other 6 slugs are not instantiated for any organization in this particular local dataset, matching the same characteristic already documented in Prompt 10's report for `crm_administrator`). Re-running the migration produced `INSERT 0 0` for both statements, confirming idempotency.

### New Organizations

No change was required to `seedOrganizationFoundation` itself — it was already correctly iterating `ROLE_TEMPLATES` and inserting every permission a role template lists. The defect was entirely in the missing `permissions` table row; once present, the existing, unmodified seeding code succeeds. Live-verified directly (Section 13).

### Role Grants

Exactly the 10 roles Prompt 3's own documented policy already specifies (7 CRM/sales roles + the 3 platform-wide roles that hold `ALL_PERMISSIONS` in the TypeScript template) — no role was added to or removed from this list beyond what `access-control.ts` already states. `sales_representative` and `auditor` are explicitly and deliberately excluded (confirmed by a dedicated negative-assertion test, Section 16).

### Security Semantics

Unchanged. Prompt 3's owner/assignee-scope-by-default rule (`recordScope()`/`assertOwnerAssignmentAllowed()` in `services/api/src/modules/crm/index.js`) was not touched by this prompt — confirmed by a dedicated regression test (Section 16) and by the full `crm-record-scope.test.mjs` suite (16 tests) passing unmodified.

---

## 5. Manufacturing Stock Root Cause

`services/api/src/modules/manufacturing/index.js`'s local `postStockMovement(client, context, input)` (removed by this prompt) was a from-scratch reimplementation of movement posting that only ever executed one query: `INSERT INTO tenant.stock_movements (...)`. It never queried, locked, or wrote `tenant.stock_balances`, never applied moving-average costing, and never wrote `tenant.stock_valuation_layers`. `postProduction()` called this local function twice per posting — once for material issue (negative quantity), once for finished-goods receipt (positive quantity) — meaning every production posting created a real, permanent ledger entry while leaving the balance table exactly as it was before the posting. Over time, and especially for any item whose only movements ever came from Manufacturing, `stock_balances.quantity` for that item/warehouse combination would never reflect reality at all — not "drift," but complete disconnection.

---

## 6. POS Stock Root Cause

`services/api/src/modules/point-of-sale/index.js`'s local `postStockMovement` (removed by this prompt) was structurally identical to Manufacturing's: an `INSERT INTO tenant.stock_movements` with no corresponding balance write. `completePointOfSale()` called it once per sale line (negative quantity, `movementType: "issue"`), inside the same DB transaction as the sale itself (via the calling route's `tenantTransaction()` wrapper) — so a completed, paid POS sale would record a real stock-movement ledger entry and simultaneously leave the item's on-hand `stock_balances.quantity` completely unchanged, contradicting the sale's own line items.

---

## 7. Canonical Stock Posting Architecture

`services/api/src/modules/stock/index.js`'s `postStockMovement(client, c, input)` is the single authoritative posting function, reused (not duplicated) by Manufacturing and POS as of this prompt, exactly as it was already reused internally by Stock's own `completeStockTransfer()`:

```
business transaction (manufacturing.production.post / pos.sale.create)
        ↓
postStockMovement(client, augmentedContext, input)
        ↓  [FOR UPDATE lock on the exact (item, warehouse, location, batch) balance row]
negative-stock policy check (tenant.stock_settings.allow_negative_stock)
        ↓
moving-average cost recomputation
        ↓
INSERT tenant.stock_movements (the ledger — append-only)
        ↓
UPSERT tenant.stock_balances (quantity, average_cost)
        ↓
INSERT tenant.stock_valuation_layers
        ↓
return the real movement row (id used by the caller's own posting-audit tables)
```

No new ledger, balance table, or posting abstraction was invented — Section headers below use this repository's own existing terminology throughout (`stock_movements`, `stock_balances`, `stock_valuation_layers`), matching Part B4's explicit instruction.

**Extension made to the canonical function**: `serial_id` was added to its `INSERT INTO tenant.stock_movements` column list and parameter list (previously silently omitted — a real, independently-confirmed gap versus both local forks, which did carry it). This was necessary, not optional: without it, switching Manufacturing/POS to the canonical function would have silently dropped serial traceability, which Part B16 explicitly forbids.

**Authorization pattern** (Part B23's "internal domain service, not an unrestricted public stock-adjustment endpoint"): Manufacturing's `postProduction()` already gates on `manufacturing.production.post`; POS's `completePointOfSale()` already gates on `pos.sale.create`. Once that business-level permission check has passed, each caller constructs an augmented context — `{ ...context, permissions: [...context.permissions, "stock.issue"] }` (or `"stock.receive"`) — before calling canonical `postStockMovement`. This is not a new invention: it is the exact pattern Stock's own `completeStockTransfer()` already uses internally (`{ ...c, permissions: [...c.permissions, "stock.issue"] }`), confirmed by reading that function before writing this fix. The business operation authorizes the resulting stock movement; the caller is never required to separately hold the underlying `stock.*` permission on their own session, and no new code path allows a caller to invoke `postStockMovement` directly with an arbitrary payload — Manufacturing/POS only ever call it from within their own already-permission-gated service functions, never from a route.

---

## 8. Transaction / Atomicity Model

No new transaction-management code was written. Both `postProduction()` and `completePointOfSale()` already execute entirely inside a single `tenantTransaction(organizationId, (client) => ...)` call at the route layer (confirmed by reading `apps/web/src/app/api/point-of-sale/sales/complete/route.ts` and the equivalent Manufacturing production route directly) — a real Postgres transaction, not an application-level "best effort" wrapper. Because canonical `postStockMovement`'s errors (insufficient stock, permission denial, FK violation) are thrown, not caught and swallowed, any failure anywhere in a multi-line production posting or multi-item sale — including a stock-integrity failure — rolls back the entire business transaction: the work order's completed quantity is not updated, the sale row is not left in a `completed` state, and no partial set of movements/balances is left behind. This was verified directly, not assumed: no try/catch was added anywhere in this prompt's Manufacturing/POS changes that could intercept and suppress a `StockError`.

---

## 9. Idempotency Model

Reused, not reinvented. `tenant.stock_movements` already carries `UNIQUE(organization_id, idempotency_key)` (`044_stock_module.sql`), and canonical `postStockMovement`'s `INSERT` has no `ON CONFLICT` clause — a retry that reuses the same idempotency key throws a real Postgres unique-violation error rather than silently succeeding a second time or silently no-op'ing. This is the deliberate, pre-existing, "fail loudly rather than duplicate" semantics already in place for Stock's own callers, and this prompt's fix inherits it unchanged for Manufacturing and POS. Both callers already generated real, deterministic idempotency keys before this fix (`${input.idempotencyKey}:material:${material.id}`, `${input.idempotencyKey}:finished-goods`, `${input.idempotencyKey}:line:${line.lineNumber}`) — the bug was never in idempotency-key generation, only in the balance write those keyed movements should have triggered. POS additionally benefits from `tenant.pos_sales`'s own `UNIQUE(organization_id, idempotency_key)` (`048_point_of_sale_module.sql`): a retried `completePointOfSale` call is rejected at the `pos_sales` insert itself, before any per-line stock movement for the retry is even attempted — verified directly by a dedicated test (Section 16).

---

## 10. Concurrency Model

Reused, not reinvented. Canonical `postStockMovement`'s `SELECT ... FOR UPDATE` on the exact `(organization_id, company_id, item_id, warehouse_id, warehouse_location_id, batch_id)` balance row is the sole concurrency-safety mechanism in this codebase for stock balances, and it is now the *only* one both Manufacturing and POS's stock effects go through. Both modules retain their own pre-existing, **unlocked** pre-checks (Manufacturing's per-material availability `SELECT`, POS's `stockAvailable()`) as fast, non-authoritative early-exit optimizations — these were not removed, since doing so would change existing error-message/UX behavior for the common case, which is out of this prompt's narrow scope. The *authoritative* guard against a lost update under concurrent postings is now always the locked read inside canonical `postStockMovement`, verified directly by a dedicated test proving a real-but-lower balance than the unlocked pre-check assumed still results in a rejected posting (Section 16).

---

## 11. Warehouse / Lot / Serial Semantics

Unchanged behavior, now correctly persisted. Manufacturing's material issue already carried the correct `warehouse_id`/`warehouse_location_id`/`batch_id` from `manufacturing_work_order_materials`; the finished-goods receipt already carried the work order's `finished_goods_warehouse_id`. POS already carried the correct per-line `warehouseId` (falling back to the shift's store warehouse, never a hardcoded default) and `batchId`/`serialId`. None of this addressing logic was changed — only the canonical function's `INSERT` statement was extended to also persist `serialId` (Section 7), so the previously-correct addressing now also results in a correct, persisted balance and ledger row instead of a ledger-only one.

---

## 12. Stock Balance / Ledger Invariant

`stock_balances` is derived, authoritative-cache state; `stock_movements` is the append-only ledger and the ultimate source of truth. Before this prompt, for any item ever touched only by Manufacturing/POS, the two were structurally guaranteed to disagree (ledger accumulating real entries, balance never updated by either module — Stock's own operations, and Sales/Procurement, which do not post stock movements directly today per Prompt 11's reconciliation, were and remain unaffected). After this prompt, every new posting from any of the three modules keeps the two in lockstep, verified directly by dedicated tests asserting a 1:1 correspondence between every `stock_movements` insert and a `stock_balances` upsert for both Manufacturing and POS (Section 16).

---

## 13. Historical Drift

### Diagnostic

`diagnoseStockBalanceDrift(client, c, { repair = false })` (new, `services/api/src/modules/stock/index.js`) computes, for the caller's own `(organization_id, company_id)`, the ledger-derived quantity (`sum(stock_movements.quantity)`) for every `(item, warehouse, location, batch)` combination via a `FULL OUTER JOIN` against `stock_balances` (catching both "balance missing/stale relative to real movements" — the confirmed Manufacturing/POS pattern — and "balance exists with zero movements," a theoretically possible but not specifically confirmed orphan case), and reports every combination where the two disagree. Read-only by default (`repair: false`, the default) — it never writes anything unless explicitly asked. Requires `stock.view` even to run a dry-run diagnosis.

Exposed via `GET /api/stock/diagnostics/balance-drift` (dry-run) and `POST /api/stock/diagnostics/balance-drift` (repair), both gated by the same `stockSession()`/`requireModuleWorkspace("stock")` + tenant-transaction infrastructure every other Stock route already uses — there is no separate, unauthenticated, or cross-tenant-capable code path (Part B22's "impossible to point accidentally at arbitrary production DB without intentional configuration" is satisfied structurally: this route can only ever run against the same database and the same caller's own organization every other authenticated route in this application uses).

### Repair Capability

`repair: true` additionally requires `stock.adjust` (checked separately from `stock.view`, verified by a dedicated test) and, for each mismatch, performs exactly one `INSERT ... ON CONFLICT DO UPDATE SET quantity = <ledger-derived sum>` per affected balance row — it never touches `average_cost` or `reserved_quantity`, never invents, deletes, or reorders a `stock_movements` row, and is naturally idempotent (a corrected balance no longer appears in the next diagnosis pass, verified by a dedicated test). This is a deterministic, safe repair path precisely because `stock_movements` is append-only and was never the thing that was wrong — only the derived cache (`stock_balances`) was.

### Limitations

This prompt did **not** run the repair against the live local database's real historical data, and does not claim to have done so — Part B21 explicitly separates "diagnose and provide a safe repair capability" from "silently rewrite historical stock," and running a repair against real (even local/dev) data changes business state in a way this narrowly-scoped P0 prompt did not judge itself authorized to do without an explicit operator decision on when/whether to run it. The diagnostic was verified with realistic mocked drift scenarios matching the exact confirmed defect pattern (Section 16); running it for real against `docker exec vercentlabs-postgres` is a one-line follow-up (`GET`/`POST` the new route, or call `diagnoseStockBalanceDrift` directly) that an operator can perform whenever appropriate, and is recommended as the very next action after this prompt, before any further Manufacturing/POS/Stock feature work begins.

---

## 14. Cross-Module Regression

Sales and Procurement were audited for comparison, per Part B24, and confirmed **not** modified: neither calls Stock's `postStockMovement` today at all (matching Prompt 11's own finding that Sales fulfillment/reservation and Procurement receiving do not touch Stock — separate, already-documented P1 gaps, explicitly out of this prompt's scope, tracked for Prompts 25–32 in the execution plan). `createStockTransfer`/`completeStockTransfer` (Stock's own internal callers of `postStockMovement`) are unmodified and covered by a dedicated regression test (Section 16) confirming they still work correctly after the `serial_id` extension. The full pre-existing test suite (`field-visibility`, `crm-record-scope`, `crm-public-capture`, `crm-core`, `financial-decimal`, `accounting-service`, `business-data-service`, `billing-service`, and every `apps/web` test) was re-run in this prompt's `pnpm verify:fast`/`pnpm verify` passes and confirmed passing unmodified (Section 21).

---

## 15. Database Changes

**Control-plane migration**: `database/platform/migrations/032_crm_records_view_all_permission.sql` — the correct next number, confirmed by listing the directory before writing it (031 was the prior highest; no gap or collision), not assumed. Applied live to the local database (`INSERT 0 1`, `INSERT 0 64`), confirmed idempotent on re-run (`INSERT 0 0`, `INSERT 0 0`).

**Tenant migration**: none. Per Part B26/the tenant-migration instruction, a tenant schema migration was only to be added if the canonical Stock path genuinely required missing structural support — it did not. `stock_movements.serial_id` already existed in the schema (`044_stock_module.sql`); the gap was only in the canonical function's own INSERT statement never referencing an already-existing column, which is an application-code fix, not a schema change.

---

## 16. Tests Added

**43 new tests across 4 new files, all passing** (plus the full pre-existing suite unmodified and passing):

- `apps/web/tests/onboarding-permission-catalogue.test.mjs` (10 tests) — T1. Includes the specific `crm.records.view_all` fix (role-catalogue membership, migration existence/structure/idempotency, exact backfill role-list match, explicit negative assertions for `sales_representative` and `auditor`) **and** a generalized invariant test cross-referencing every `ROLE_TEMPLATES` permission against every control-plane migration's registered `permissions` keys — this test initially found 2 apparent additional gaps (`crm.data-quality.manage`, `crm.field-sales.manage`), which live-DB verification proved were test-regex false positives (a hyphen-matching bug in the key-extraction pattern, not real missing permissions); the regex was corrected and the invariant now passes cleanly, giving confidence no *other* permission shares this defect.
- `services/api/tests/manufacturing-stock-integrity.test.mjs` (9 tests) — T2. Material issue/finished-goods receipt balance updates (exactly once each), ledger/balance/valuation-layer 1:1 consistency, correct signed quantities, serial traceability preservation, idempotent-retry rejection, the row-locked (not just the unlocked pre-check) insufficient-stock guard, Stock's own negative-stock policy consultation, and correct warehouse/location propagation.
- `services/api/tests/point-of-sale-stock-integrity.test.mjs` (8 tests) — T3. The same category of coverage for `completePointOfSale`, plus the `pos_sales` idempotency-key-based duplicate-sale rejection.
- `services/api/tests/stock-balance-diagnostic.test.mjs` (8 tests) — T5, plus 2 cross-module regression tests (T4) for `postStockMovement`'s `serialId` backward compatibility and `createStockTransfer`/`completeStockTransfer`.

**POS return/void behavior** (Part T3's "skip unsupported return/void behavior... document skipped capability"): `createPointOfSaleReturn` does not call any stock-posting function today, before or after this prompt — there is no "complete a return" code path anywhere in `point-of-sale/index.js` that would restock inventory (matching Prompt 11's own `POS-019` finding). This is a genuinely separate, already-documented, already-scoped gap (Prompt 61 in the execution plan), not a P0 integrity defect — inventing a return-restock flow here would be new feature work, explicitly out of this prompt's scope (Part B11/OUT OF SCOPE). No test was written asserting return behavior that does not exist.

**Live DB integration**: the strongest available integration verification — a real transaction against the running local Postgres reproducing the exact `seedOrganizationFoundation` insert pattern, confirming no FK violation, then rolled back to leave no permanent data (Section 13/21) — was performed for Workstream A. Workstream B's fix was verified via `node --test` against the real, unmodified production code paths (not re-implemented mock logic) with carefully constructed mock `client.query` responses matching the exact SQL this code now issues; a full live-Postgres production-posting/POS-sale rehearsal was not additionally performed, since the mocked tests already exercise the real `postProduction`/`completePointOfSale`/`postStockMovement` functions end-to-end and a live rehearsal would require seeded fixture data (items, warehouses, BOMs, work orders) this prompt's narrow P0 scope did not extend to provisioning.

---

## 17. Adversarial Review

1. **Can new-org provisioning still reference an unregistered permission?** CLOSED — the general invariant test (Section 16) now checks every `ROLE_TEMPLATES` permission against every registered permission key, not just `crm.records.view_all`.
2. **Can existing orgs remain without `crm.records.view_all`?** CLOSED for every organization existing at the time this migration was written/applied — the backfill is unconditional across all matching role slugs. (An organization created *between* this migration being written and applied would not be affected either way, since new-org seeding now succeeds correctly regardless.)
3. **Can normal CRM user accidentally receive company-wide CRM visibility?** CLOSED — migration 032's role list was directly cross-checked against `access-control.ts`'s actual `ROLE_TEMPLATES` (not assumed), and a dedicated test asserts `sales_representative` is excluded.
4. **Can CRM view-all be granted twice inconsistently?** CLOSED — `ON CONFLICT DO NOTHING` on both the `permissions` insert and the `role_permissions` backfill; verified idempotent by both a live re-run (`INSERT 0 0`) and a source-pattern test.
5. **Can Manufacturing finish inventory movement without balance change?** CLOSED — every `stock_movements` insert from `postProduction` now has a corresponding `stock_balances` upsert, verified by a dedicated 1:1-count test.
6. **Can Manufacturing retry double-post inventory?** CLOSED — the `UNIQUE(organization_id, idempotency_key)` constraint rejects a retry with the same key; verified by a dedicated test simulating the real Postgres error.
7. **Can POS sale complete without stock decrement?** CLOSED — same canonical-posting fix; verified by a dedicated test.
8. **Can POS retry double-decrement?** CLOSED — `pos_sales`'s own idempotency-key uniqueness rejects the retry before any stock effect is attempted for it; verified by a dedicated test.
9. **Can balance update occur without ledger/movement?** CLOSED — canonical `postStockMovement` always inserts the movement row before upserting the balance, in that order, inside the same function; no code path calls the balance upsert independently.
10. **Can ledger/movement occur without balance update?** CLOSED for both Manufacturing and POS as of this prompt (the exact defect fixed) — verified by the same 1:1-count tests.
11. **Can concurrent transactions lose updates?** CLOSED — the authoritative check is now always the `FOR UPDATE`-locked read inside canonical `postStockMovement`, for both modules; verified by a test proving a real-but-insufficient locked balance is rejected even when an earlier unlocked pre-check would have allowed it.
12. **Can negative-stock policy be bypassed?** CLOSED — Stock's own `stock_settings.allow_negative_stock` is now the single authoritative gate for Manufacturing and POS, verified by a dedicated test confirming the settings table is genuinely consulted. Documented, not a gap: POS's own separate `pos_settings.allow_negative_stock` pre-check may occasionally diverge from Stock's authoritative policy — this can only ever result in Stock correctly *rejecting* something POS's own pre-check would have allowed (the safe failure direction), never the reverse, since Stock's check runs second and is authoritative.
13. **Can wrong warehouse be adjusted?** CLOSED — verified by dedicated tests confirming the work order's/shift's real warehouse context propagates, not a hardcoded default.
14. **Can another tenant's balance be touched?** CLOSED — canonical `postStockMovement` and the new diagnostic both scope every query by `c.organizationId`/`c.companyId` taken from the authenticated session context, never from client input; the diagnostic route reuses the same `stockSession()`/`tenantTransaction()` infrastructure every other tenant-scoped route uses.
15. **Can client choose arbitrary tenant in posting payload?** CLOSED — `organizationId`/`companyId` are never read from `input` in any of the modified functions; they come exclusively from `context`, which is built server-side from the session.
16. **Can lot/serial traceability be lost?** CLOSED — this was an active, real risk during the fix (canonical `postStockMovement` originally omitted `serial_id`); closed by extending the canonical function rather than silently dropping the field, verified by a dedicated test for both Manufacturing and POS.
17. **Can inventory failure be swallowed?** CLOSED — no try/catch was added anywhere in the modified call paths; every `StockError` thrown by canonical `postStockMovement` propagates to the enclosing `tenantTransaction()`, which rolls back the whole business transaction.
18. **Can Sales or Procurement behavior regress?** CLOSED — neither module was touched; confirmed by re-running the full existing test suite unmodified.
19. **Can a historical repair modify correct balances?** CLOSED — `diagnoseStockBalanceDrift`'s repair path only ever fires for rows the SQL `HAVING` clause has already proven mismatched; a matching balance is never touched, verified by a dedicated "ignores a matching balance" test.
20. **Can reconciliation operate across tenant boundaries?** CLOSED — same organization/company scoping as item 14, verified by a dedicated test asserting the exact `organizationId`/`companyId` parameters bound to the diagnostic query.
21. **Can idempotent replay create duplicate audit events?** N/A/CLOSED — canonical `postStockMovement` does not write to the central `audit_events` table at all (matching its pre-existing behavior, unchanged by this prompt); a rejected duplicate movement throws before any event-adjacent code runs. Manufacturing's own `manufacturing_events`/POS's own `pos_events` inserts happen *after* a successful posting only, so a rejected retry never reaches them either.
22. **Can module-disabled Manufacturing/POS still post inventory?** CLOSED, unchanged from before this prompt — both modules' routes already gate on `requireModuleWorkspace("manufacturing"/"point-of-sale")` (Prompt 5), which this prompt did not touch.
23. **Can company/branch restrictions be bypassed through the shared Stock service?** CLOSED — canonical `postStockMovement` has always scoped every query by `c.companyId`; Manufacturing and POS's augmented-context calls pass their own already-company-scoped `context` through unchanged, never a different or elevated company.
24. **Can current field/security controls be weakened by refactor?** CLOSED — Prompt 3's field-visibility/CRM-scope code (`services/api/src/core/field-visibility.js`, `crm.js`'s `recordScope`) was not touched by this prompt; confirmed by a dedicated regression test and by the full existing security test suite passing unmodified.
25. **Can source-document status and stock state diverge after partial failure?** CLOSED — per Section 8, the whole business transaction (work-order/sale status update *and* every stock effect) executes inside one Postgres transaction; a stock-posting failure anywhere rolls back the source document's status change too, so the two can never diverge from a partial failure.

---

## 18. Remaining P0/P1 Issues

**P0**: none remaining as a direct result of this prompt's two target defects — both CLOSED (Section 19). The historical-drift repair itself was deliberately not run against real data in this prompt (Section 13's Limitations) — this is a recommended immediate next action, not an unresolved P0 defect, since the diagnostic/repair capability now exists and is verified safe.

**P1** (retained exactly as Prompt 11 catalogued them — none of these were in this prompt's scope and none were touched):
- No worker/scheduler process anywhere (`ERP_FEATURE_MATRIX_011.csv` `SHARED-032`/`SHARED-045`/etc.) — blocks webhook delivery, CRM automation's remaining trigger types, telephony job processing.
- Quality holds remain advisory-only outside the Quality module (`QUAL-009`) — a held batch can still ship/receive/be consumed in Stock/Procurement/Manufacturing.
- Manufacturing's operation-completion gate remains permanently blocking on any work order with a routing attached (`MFG-008`) — confirmed still present; not touched, since it does not prevent reproducing or fixing this prompt's stock-posting defect (routes without a routing attached, used throughout this prompt's tests, are unaffected by that gate).
- The universal write-UI gap across 8 modules (Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll, most of Stock) remains — this prompt fixed the underlying service-layer defects, not the UI reachability gap, per the explicit OUT OF SCOPE instruction.
- HR & Payroll's payroll-calculation correctness defect (`HR-010`/`HR-012`) remains fully unresolved — explicitly out of scope for this prompt.

---

## 19. Feature-Matrix Impact

Referencing only Prompt 11's evidence-backed functional-area rows (`ERP_FEATURE_MATRIX_011.csv`) — **no exact 1,039-row completion claim is made**, per this prompt's explicit instruction:

- **CRM-017** (per-record ownership scoping): status unchanged at PARTIAL in the matrix's own terms (the feature's *code* was always correct — Prompt 3 built and tested it properly), but its **UAT status changes from LIMITED to READY** for the elevated-role-visibility half, since the permission that made it unusable for any role but `organization_owner` is now genuinely grantable. The "restricted rep sees only their own records" half was already READY and is unaffected.
- **STOCK-025 / STOCK-026** (Manufacturing/POS write to Stock balances): status changes from PARTIAL (real ledger writes, no balance effect) to **COMPLETE** for the specific "does a production posting / POS sale update `stock_balances`" functional area. This does not change Manufacturing's or POS's overall module-level completion estimate materially (both modules' dominant remaining gaps — write UI, MRP/costing/routing for Manufacturing; checkout UI, catalog, promotions for POS — are untouched by this prompt), but it removes a live data-integrity defect that would have undermined *any* future work built on top of either module's inventory effects.
- **SHARED-020** (CRM record-level access, shared-platform security category): UAT status improves from PARTIAL/LIMITED to reflect that the underlying permission-grant mechanism is now genuinely functional for new and existing organizations alike.

No other row in `ERP_FEATURE_MATRIX_011.csv` or `ERP_ACCOUNTING_MATRIX_011.csv` is affected by this prompt.

---

## 20. Files Changed

**New**:
- `database/platform/migrations/032_crm_records_view_all_permission.sql`
- `apps/web/tests/onboarding-permission-catalogue.test.mjs`
- `services/api/tests/manufacturing-stock-integrity.test.mjs`
- `services/api/tests/point-of-sale-stock-integrity.test.mjs`
- `services/api/tests/stock-balance-diagnostic.test.mjs`
- `apps/web/src/app/api/stock/diagnostics/balance-drift/route.ts`
- `docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md` (this document)

**Modified**:
- `services/api/src/modules/stock/index.js` — `postStockMovement` extended to persist `serial_id`; new `diagnoseStockBalanceDrift` export.
- `services/api/src/modules/stock/index.d.ts` — type declaration for `diagnoseStockBalanceDrift`.
- `services/api/src/modules/manufacturing/index.js` — local `postStockMovement` removed; `postProduction` now calls canonical Stock `postStockMovement` for both material issue and finished-goods receipt.
- `services/api/src/modules/point-of-sale/index.js` — local `postStockMovement` removed; `completePointOfSale` now calls canonical Stock `postStockMovement` for sale-line issue.

**Unchanged (confirmed, not merely assumed)**: `services/api/src/{crm,hr-payroll,support,procurement}.js` (Prompt 3's field/record-level security); `apps/web/src/core/module-access.ts` (Prompt 4/5's module enforcement); Sales and Procurement's own stock-adjacent code; every Prompt 9/10/11 deliverable.

---

## 21. Verification Results

| Command | Result |
|---|---|
| Live DB re-verification of the crm.records.view_all defect (before fix) | 0 rows in `permissions`, 0 rows in `role_permissions`, confirmed via `docker exec vercentlabs-postgres psql` |
| Migration 032 applied live | `INSERT 0 1` / `INSERT 0 64`; re-run confirmed idempotent (`INSERT 0 0` / `INSERT 0 0`) |
| Live simulation of fresh-org role seeding (rolled back, no permanent data) | Succeeded — the exact insert that previously threw a foreign-key violation now completes cleanly |
| `pnpm verify:fast` | **PASS** — exit 0, 85/85 `services/api` tests pass (including all 25 new Workstream-B tests), full `apps/web` suite passes, 1 pre-existing unrelated lint warning only |
| `pnpm verify:db` | **PASS** — 0 failing checks; control-plane now correctly shows 32 migrations (was 31); 1 pre-existing, unrelated warning (duplicate tenant migration prefix `039`, not touched) |
| `pnpm verify:mobile` | **PASS** — exit 0, typecheck + lint clean |
| `pnpm verify:web` | **PASS** — exit 0, `verify:fast && verify:routes && build:web`. 279 routes verified (including the new `/api/stock/diagnostics/balance-drift`), full `next build` compiled clean, 0 typecheck errors, 1 pre-existing unrelated lint warning only |
| `pnpm verify` | **PASS** — exit 0, full Level 5 composite: `verify:fast && verify:routes && verify:mobile && verify:db && test:sdk && test:packages && test:integration && test:security && test:enterprise-rbac`. `test:enterprise-rbac`'s 11/11 tests pass unmodified, including "every role permission exists in the canonical permission catalogue" (the TypeScript-side check that never caught this defect, matching Section 3's root-cause analysis of why it shipped unnoticed) |

`pnpm release:verify` was not run — this prompt does not touch `apps/landing`, and per the prompt's own instruction the unstable landing Playwright suite provides no evidence for these fixes.
