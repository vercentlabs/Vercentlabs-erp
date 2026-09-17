# POS Implementation Tracker (F268-F307)

## Session 1 starting state

- Branch: `rebuild/clean-frontend`
- Starting SHA: `524dc6a8c9ecf0ea69a585ab3d4978fe9bf9f73e`
- Working tree: clean, 10 commits ahead of `origin/rebuild/clean-frontend` (unrelated prior CRM/shell work), no divergence.
- Canonical register counts confirmed by direct CSV parsing (not inferred):
  - `FEATURE_REGISTER.csv`: exactly 40 unique `feature_id` values F268-F307.
  - `CAPABILITY_REGISTER.csv`: exactly 9 rows, `POS-CAP-001`..`POS-CAP-009`, `feature_ids` columns match the F-ranges in this program's brief exactly. All 9 rows carry `working_status: SPECIFICATION_READY` (i.e. spec exists, not "implemented" — consistent with, not proof of, the code audit below).
  - `SUBREQUIREMENT_REGISTER.csv`: 1,480 rows across the 40 features (37/feature).
  - `FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv`: 320 rows (8/feature).
  - `FEATURE_FLOW_REGISTER.csv`: 400 rows (10/feature).
  - `FEATURE_STATE_TRANSITION_REGISTER.csv`: 200 rows (5/feature).
  - `docs/PRODUCTION_TRACKER.md:252` and `docs/ERP_COMPLETION_EXECUTION_TRACKER.md:664` both independently record POS as "0/40 ... Scaffolding only / thin, not re-verified" prior to this session. Consistent with the code audit below, not identical wording — treated as corroboration, not proof.
  - No `POS_IMPLEMENTATION_TRACKER.md` existed before this file. No POS wireframes exist anywhere in the repo despite every dossier citing `docs/11-visual-assets/wireframes/POS_PASS8_WORKSPACES.md` (that path does not exist) — treat POS as having zero visual-design evidence; this is a real, standing gap not resolved by this session's work.

## Audit method

Four parallel read-only audits were run against the actual repository (not against dossier prose) before any code was written:
1. Docs/dossiers (blueprint, capability pack, architecture, research, all 40 `features/F26[89]|F27..|F30[0-7]-*.md` dossiers).
2. Existing POS backend + DB (`services/api/src/modules/point-of-sale/index.js`, `database/tenant/migrations/048_point_of_sale_module.sql` + every later migration touching `pos_*`, permissions, existing tests).
3. Existing POS frontend/nav/mobile (`module-navigation-registry.ts`, `apps/web/src/app/**pos**`, `packages/shared-sdk`, `FRONTEND_CONTRACT_REGISTER.csv`, design system primitives, `apps/mobile` offline architecture, `apps/web` PWA/offline infra).
4. Cross-module contracts POS must integrate through (Stock, Sales pricing/tax, Accounting posting, CRM customer master, shared approvals, background jobs, payment-provider precedent).

## Ground truth established by the audit (supersedes any older report/tracker line)

**Backend (`services/api/src/modules/point-of-sale/index.js`, 1005 lines, single file):**
- Real: `getPointOfSaleDashboard`, `listPointOfSaleResource` (generic, unfiltered field-wise), `createStore`, `createTerminal`, `openShift` (+ opening cash movement), `completePointOfSale` (cash-only), `createPointOfSaleReturn` (server-recomputed refund, approval-policy branch), `approvePointOfSaleReturn` (self-approval blocked by user-ID comparison), `completePointOfSaleReturn` (cash-only refund + restock), `closeShift` (variance vs. `pos_cash_movements` sum, no `pos_reconciliations` row written).
- Real and correctly used: Stock integration goes through `postStockMovement` (issue/receipt), never a private fork — regression-tested in `services/api/tests/point-of-sale-stock-integrity.test.mjs`. Idempotency goes through the shared `operation_idempotency` primitive (`beginIdempotentOperation`/`completeIdempotentOperation`) for `pos.sale.complete` / `pos.return.create` / `pos.return.approve` / `pos.return.complete`.
- **Deliberately fails closed, not a bug**: any `payment.method !== "cash"` throws `POS_PAYMENT_PROVIDER_NOT_CONFIGURED` at sale time and `POS_REFUND_PROVIDER_NOT_CONFIGURED` at refund time (`index.js:332-338`, `808-822`). No provider adapter interface exists anywhere in the repo to plug in — this is 100% greenfield.
- **No HTTP route layer exists at all.** No file under `apps/web/src/app/api` references POS. The only web-facing artifact is `apps/web/src/app/(workspace)/pos/page.tsx`, which renders the generic `ModuleFoundationPage` placeholder and makes zero POS API calls. The domain functions in `index.js` are unreachable from any UI today.
- **No Accounting integration**: `pos_sales.accounting_invoice_id` column exists (migration 048) but is never populated; `createJournalEntry`/`postJournalEntry` are never called.
- **No Sales pricing/tax reuse**: POS re-implements a much simpler price-list lookup (`resolvePointOfSaleUnitPrice`) and trusts client-supplied `taxAmount`/`discountAmount` (range-validated only, not derived). `previewSalesDocument` (the real Sales tax/discount engine, handles India CGST/SGST/IGST split) is never called.
- **No customer FK**: `pos_sales.customer_id` has no `REFERENCES tenant.business_parties`; `completePointOfSale` accepts free-text `customerName` and doesn't validate `customer_id` at all.
- **`pos_reconciliations` table is completely unused** by any function despite existing since migration 048.
- **No cash paid-in/paid-out**: `pos_cash_movements.movement_type` CHECK allows `paid_in`/`paid_out`/`closing_adjustment`, but no function ever inserts them, despite the `pos.cash.adjust` permission existing for exactly this.
- **No real cashier/supervisor role split**: only one seeded role, `pos_manager` (`database/platform/migrations/027_role_catalogue_module_completion.sql`), holds all 16 `pos.*` permissions. There is no narrower cashier/operator role. The self-approval block in return-approval compares user IDs, not roles — it only works today because two *different humans* hold the same all-powerful role.
- **POS return-approval is invisible to the global approvals inbox**: it implements its own status machine on `tenant.pos_returns` directly rather than creating a `public.approval_requests` row + `COMMAND_DISPATCH` entry (the pattern every other module's approval flow uses, e.g. `accounting.journal.approve`).
- Test coverage: exactly 2 files touch POS — stock-issue correctness (thorough) and one payment-fail-closed test. Shift lifecycle, return lifecycle, cash variance, and all permission enforcement are untested.

**Frontend/nav:** nav registry (`module-navigation-registry.ts`) lists 8 sections / ~17 destinations across F268-F307 with provisional (non-canonical) F-range comments; only the Home stub is `AVAILABLE`, everything else is `PLANNED` with no backing route file — clicking any of them would 404. No `apps/web/src/features/pos` directory exists. No `packages/shared-sdk` POS contracts exist. No kiosk/focused-mode/touch-first layout primitive exists anywhere in `packages/design-system`.

**Cross-module contracts confirmed usable (cite once, reuse everywhere below):**
- Stock: `postStockMovement(client, c, { movementType: 'issue'|'receipt', itemId, warehouseId, warehouseLocationId?, batchId?, serialId?, quantity, unitCost, referenceType, referenceId, reason, idempotencyKey })` — `services/api/src/modules/stock/index.js:188-256`. Row-locked + advisory-locked, negative-stock policy respected, idempotent.
- Stock reservation (not currently used by POS, available for held-cart stock guarantees): `reserveStock`/`releaseStockReservation`/`getStockAvailability` — `stock/index.js:452-564`, `391-450`.
- Sales pricing/tax: `previewSalesDocument(client, context, input, options)` — `services/api/src/modules/sales/index.js:533-667`. Pure preview, computes India GST split (CGST+SGST intra-state, IGST inter-state), price-list resolution, header discount, rounding. Heavyweight (built for quotations/orders) but is the one legitimate authoritative tax engine.
- Accounting posting: `createJournalEntry` / `submitJournalEntry` / `approveJournalEntry` / `postJournalEntry` / `reverseJournalEntry` — `services/api/src/modules/accounting/journals.js`. `options.internal = true` bypasses the interactive permission gate for trusted cross-module callers. Period-lock checked via `getOpenPeriod` at both create and post. No idempotency key parameter on the contract itself — caller stores the resulting journal id on its own source record (exactly the pattern `pos_sales.accounting_invoice_id` exists for but has never used). Real example to follow: `services/api/src/orchestration/procurement-accounting-vendor-bill.js`.
- Customer master: `tenant.business_parties WHERE party_type IN ('customer','both') AND status='active'`, owned/mutated by CRM's `account-operations.js`. POS must reference, never fork.
- Approvals: `public.approval_requests` + `COMMAND_DISPATCH` map in `services/api/src/core/approvals.js` — register a `pos.return.approve` command key so return approvals surface in the global inbox.
- Background jobs: `enqueueJob`/`claimJobs`/`completeJob`/`failJob` — `services/worker/src/queue.js`, `FOR UPDATE SKIP LOCKED`, DB-enforced `UNIQUE(organization_id, idempotency_key)`. Template for offline-sync replay, payment reconciliation polling, deferred accounting-posting retry.
- Payment providers: **zero reusable adapter/interface exists anywhere in the repo.** The only precedent is SaaS-subscription-billing-specific (`services/api/src/core/billing.js`): pure payload builders, a `shouldApplyProviderEvent` out-of-order-webhook guard (the one reusable idiom), and a "server issues session + public key, client completes, client posts back signature for server verification, never trust client's own success claim" shape. No HMAC verification code, no webhook route, was locatable. **POS is the first payment-provider adapter built in this codebase.**

## Gap matrix — F268-F307

Legend: REAL/VERIFIED, PARTIAL, FOUNDATION ONLY, FRONTEND MISSING, BACKEND MISSING, INTEGRATION MISSING, TEST GAP, EXTERNAL ACTIVATION BLOCKED.

| F | Feature | Session-1 status | Evidence / gap |
|---|---|---|---|
| F268 | Stores and outlets | PARTIAL | Backend `createStore` real; session 1 added `POST`/`GET /api/pos/stores` (create+list, real HTTP route, verified against real Postgres); still no update/activate-deactivate function or route; no UI; no test |
| F269 | POS terminals | PARTIAL | Backend `createTerminal` real; session 1 added `POST`/`GET /api/pos/terminals`; still no activate/inactivate/maintenance transition function or route; no UI; no test |
| F270 | Cashiers | FOUNDATION ONLY | Real least-privilege `pos_cashier`/`pos_supervisor` roles now exist (session 1) closing the "one all-powerful role" gap, but there is still no dedicated cashier *entity*/eligibility model — `cashier_user_id` on `pos_shifts` is still a free user reference, not validated against a per-store/terminal eligibility list; no route; no UI |
| F271 | Cashier permissions | PARTIAL (was BACKEND MISSING) | `pos_cashier` (least-privilege) and `pos_supervisor` (override/approve) roles added session 1, reusing only the existing `pos.*` permission vocabulary; a real `pos_return_create_approve` blocking SoD conflict now exists and is enforced (`pos_manager` no longer holds both sides). Verified against real PostgreSQL. Still no UI for assigning/managing these roles specifically for POS (falls back to the platform's generic role-assignment UI, not audited here) |
| F272 | Product search | PARTIAL (was FRONTEND MISSING + BACKEND MISSING) | `searchPointOfSalePosProducts` added session 1 (`features/assortment.js`) — bounded, company/store-scoped, searches items + variants, excludes cost fields, joined to real warehouse availability. Exposed via `GET /api/pos/stores/[storeId]/products`. Verified against real PostgreSQL + real HTTP. Still FRONTEND MISSING — no checkout UI consumes it yet |
| F273 | Barcode scanning | PARTIAL (was BACKEND MISSING) | `lookupPointOfSaleBarcode` added session 1 — exact match across item/variant barcodes (keyboard-wedge first-class path), clear 404 on unknown code. Exposed via `GET /api/pos/stores/[storeId]/barcode/[code]`. Verified against real PostgreSQL + real HTTP. Still FRONTEND MISSING — no scanner-input UI exists yet |
| F274 | Product variants | INTEGRATION MISSING | `searchPointOfSalePosProducts`/`lookupPointOfSaleBarcode` (session 1) do correctly resolve `tenant.item_variants`, reusing Stock/Item's own variant identity rather than forking one — but `completePointOfSale`/returns still operate on plain `itemId` only, with no explicit `variantId` column/handling on `pos_sale_lines` yet |
| F275 | Price lists | PARTIAL | Unchanged this session: `resolvePointOfSaleUnitPrice` is a real, simpler lookup; does not reuse Sales' `previewSalesDocument`; no route; no UI |
| F276 | Customer selection | PARTIAL (was BACKEND MISSING) | Session 1: `completePointOfSale` now validates `customerId` against `tenant.business_parties` (active customer/both, org-shared or company-scoped) before completing a sale; migration 112 (tenant) adds the corresponding `pos_sales_customer_id_fkey` (`ON DELETE SET NULL`). Verified against real PostgreSQL (valid customer accepted, unknown/archived rejected with `POS_CUSTOMER_NOT_FOUND`). Still no dedicated customer-search route/UI — a caller must already know the customer's id |
| F277 | Cart | FRONTEND MISSING + BACKEND MISSING | No server-side cart aggregate exists; `completePointOfSale` takes a flat `lines[]` with no held/versioned cart identity before commit |
| F278 | Taxes | BACKEND MISSING (integrity gap) | Client-supplied `taxAmount` trusted (range-validated only); does not derive from `tenant.tax_rates`/GST split like Sales does |
| F279 | Discounts | BACKEND MISSING | No policy-driven discount evaluation; `pos.discount.apply` permission checked only if `discount > 0`, no threshold/reason/evidence model |
| F280 | Promotions | BACKEND MISSING | No promotion evaluation exists at all |
| F281 | Coupons | BACKEND MISSING | No coupon validation/redemption exists at all |
| F282 | Cash payments | REAL/VERIFIED | `completePointOfSale` cash path is real, tested (stock-integrity test), change computed correctly, net cash movement (not tendered amount) posted; session 1 added the `POST`/`GET /api/pos/sales` HTTP route and re-verified end-to-end against real Postgres including idempotent replay |
| F283 | Card payments | EXTERNAL ACTIVATION BLOCKED (adapter) / BACKEND MISSING (code-controllable parts) | Fails closed deliberately; zero adapter code exists; code-controllable adapter boundary is buildable now, real card capture needs a certified provider + merchant credentials |
| F284 | UPI and digital payments | EXTERNAL ACTIVATION BLOCKED (adapter) / BACKEND MISSING | Same as F283 |
| F285 | Split payments | BACKEND MISSING | `completePointOfSale` sums multiple payment lines but every non-cash line is rejected; split-cash-only "split" has no dedicated handling beyond summation |
| F286 | Multiple payment methods | BACKEND MISSING | Same underlying gate as F283/F284 |
| F287 | Hold/suspend sale | BACKEND MISSING + FRONTEND MISSING | No hold/suspend function exists; `pos_sales.status` CHECK has a `draft` state that's never written |
| F288 | Resume sale | BACKEND MISSING + FRONTEND MISSING | Depends on F287; nothing to resume yet |
| F289 | Receipt printing | BACKEND MISSING + FRONTEND MISSING | No receipt generation/rendering exists |
| F290 | Invoice generation | BACKEND MISSING + INTEGRATION MISSING | No invoice path; `sales_order_id` column unused |
| F291 | Returns | PARTIAL | Backend real for cash-tendered sales (creation/approval/completion); session 1 added `POST`/`GET /api/pos/returns` and `POST /api/pos/returns/[id]/approve`; no UI; largely untested beyond one stock-integrity angle |
| F292 | Refunds | PARTIAL | Cash refund real; non-cash fails closed (correct, but adapter-dependent); session 1 added `POST /api/pos/returns/[id]/complete`; no UI |
| F293 | Exchanges | BACKEND MISSING | No exchange function exists at all; dossier requires linked return+replacement-sale lineage, not implemented |
| F294 | Stock reduction | REAL/VERIFIED | Goes through canonical `postStockMovement`; regression-tested against real double-decrement/idempotency/insufficient-stock races |
| F295 | Lot/serial support | PARTIAL | Stock's `postStockMovement` accepts `batchId`/`serialId` and POS can pass them through, but POS itself does not validate lot/serial *requirement* per item before checkout |
| F296 | Real-time inventory | PARTIAL | `stockAvailable()` read exists but is an unlocked pre-check only; final safety is Stock's own row lock inside `postStockMovement` (correct architecture, no dedicated "availability for search results" query yet) |
| F297 | Offline POS | BACKEND MISSING + FRONTEND MISSING | Zero infrastructure in `apps/web` (no service worker/IndexedDB); `apps/mobile` has a real, reusable encrypted-SQLite + batch-sync pattern that hasn't been ported |
| F298 | Offline-to-online sync | BACKEND MISSING | Same as F297 — nothing to sync yet |
| F299 | Cash drawer opening balance | REAL/VERIFIED | `openShift` posts an immutable opening cash movement correctly |
| F300 | Cash movements | PARTIAL | Opening/sale/refund movements real; `paid_in`/`paid_out`/`closing_adjustment` never implemented despite schema + permission existing |
| F301 | Shift opening | PARTIAL | Real; DB-enforced one-open-shift-per-terminal via partial unique index; not idempotency-key protected (network retry could double-attempt, though the unique index would reject the second); session 1 added `POST`/`GET /api/pos/shifts` |
| F302 | Shift closing | PARTIAL | Variance computed against cash movements; does not check unresolved payment/offline state; does not write `pos_reconciliations`; session 1 added `POST /api/pos/shifts/[id]/close` and fixed a bare, unclassified `Error` on "shift not found" (was surfacing as an opaque 500, now a proper 404 `POS_SHIFT_NOT_OPEN`) |
| F303 | Day-end / Z report | BACKEND MISSING | No Z-report generation function exists |
| F304 | Payment reconciliation | BACKEND MISSING | `pos_reconciliations` table exists, completely unused |
| F305 | POS accounting posting | BACKEND MISSING (integration) | Zero calls to `createJournalEntry`/`postJournalEntry`; `accounting_invoice_id` unused |
| F306 | Loyalty | BACKEND MISSING | No loyalty ledger/table/function exists at all |
| F307 | POS sales analytics | FOUNDATION ONLY | Only `getPointOfSaleDashboard`'s coarse today-only aggregate exists; no date-range/store/terminal/cashier drilldown |

## Implementation decisions this session

1. **Do not rebuild the giant `index.js` from scratch.** Extend it, and begin splitting new capability work into dedicated files under `services/api/src/modules/point-of-sale/` per the POS-CAP-00x boundaries, re-exported from `index.js` — mirroring the pattern already used by `services/api/src/modules/crm/index.js`.
2. **Fix the two gaps that block everything else first**: (a) there is no HTTP route layer, so nothing built is reachable; (b) there is no real cashier-vs-supervisor role, so "cashier permissions" (F271) is not a real feature yet. Both are Tranche-0-level foundation repairs, done before new capability code.
3. **Server-authoritative pricing/tax**: reuse `previewSalesDocument` rather than extending POS's own simplified lookup, per the explicit instruction not to trust browser-supplied tax/discount amounts and not to fork a second pricing engine.
4. **Payment provider architecture**: build the adapter *interface* and a test-only sandbox adapter now; keep production fail-closed exactly as today until a real merchant-certified provider is wired — this is an EXTERNAL ACTIVATION BLOCKED item for the actual card/UPI capture, not for the code-controllable adapter boundary.
5. Continue numbering DB migrations from `112` under `database/tenant/migrations/` (last: `111_f029_opportunity_bulk_scale.sql`) and from `039` under `database/platform/migrations/` (last: `038_attachment_versioning.sql`) — these are two separate numbering sequences, do not conflate them.

## Continuation point (read this first in any future session)

This is a genuinely large, multi-tranche program (40 features spanning store/terminal/cashier control, a full cart/pricing/tax/promotion engine, a payment-provider framework, receipts/invoices, returns/refunds/exchanges, offline sync, shift/cash/reconciliation/accounting, loyalty, and analytics — each with real DB, backend, API, frontend, and test surface). It is not realistic to complete in a single pass, and the trackers already on record (`PRODUCTION_TRACKER.md`, `ERP_COMPLETION_EXECUTION_TRACKER.md`) reflect that reality rather than a false "quick fix" framing.

Update this section at the end of every future session with: what tranche was completed, what verification ran, and the exact next tranche to pick up.

### Session 1 (this session) — what actually landed

Starting SHA `524dc6a8`, five commits on `rebuild/clean-frontend` (each independently verified against real PostgreSQL and, where applicable, real HTTP against the running dev server — not just typecheck/lint/fake-client tests):

1. `af380e17` — this tracker + the four-audit gap matrix (the required first deliverable).
2. `157d8167` — real `pos_cashier`/`pos_supervisor` roles (F270/F271 foundation), a new `pos_return_create_approve` blocking SoD conflict, `pos_manager` no longer holds both `pos.return.create` and `pos.return.approve`. Platform migration 039.
3. `7a23ad37` — the entire missing HTTP route layer (`apps/web/src/app/api/pos/**`, `apps/web/src/features/pos/shared/pos-context.ts`) for every domain function that existed before this session (stores, terminals, shifts+close, sales, returns+approve+complete, dashboard, generic resource list). Also fixed a real bug this exposed: `completePointOfSale` inserted `line.description` into a NOT NULL column with no fallback, and `closeShift`'s "not found" path threw a bare `Error` instead of a proper 404.
4. `c857d622` — F276 customer validation: `completePointOfSale` now validates `customerId` against `tenant.business_parties`; tenant migration 112 adds the missing FK.
5. `26691647` — F272/F273: `searchPointOfSalePosProducts` and `lookupPointOfSaleBarcode`, the first capability-owned file (`features/assortment.js`) split out of the original single `index.js`, with HTTP routes.
6. `2cc9b8a9` — taught `scripts/qa/generate-route-security-matrix.mjs` to recognize `requirePosAccess` (the POS analogue of `requireCrmAccess`) as a real authorization primitive; the 8 new POS mutation routes were already passing `pnpm verify:route-security` (it only requires authentication + an origin check, both present from commit 3 onward) but showed `has_authorization_check=false` in the generated matrix purely because the pattern list didn't know the function name yet.

Verification run repeatedly through the session, every gate green: `pnpm test:api` (1104/1104), `pnpm test:web` (21/21), `pnpm test:sdk` (14/14), `pnpm test:worker` (102/102), `pnpm test:security` (4/4), `pnpm test:integration` (5/5, real Postgres — see toolchain note below), `packages/permissions/tests/roles.test.mjs` (8/8), `pnpm typecheck:web`, `pnpm lint:web`, `pnpm build:web`, `pnpm verify:db`, `pnpm verify:architecture`, `pnpm verify:routes`, `pnpm verify:route-security`. Real end-to-end HTTP smoke tests were run against the actual dev server (port 3001) and real Postgres for: store→terminal→shift→cash-sale→idempotent-replay→non-cash-fails-closed→shift-close, customer validation (real customer accepted, fake one rejected), product search, and barcode lookup — each confirmed by inspecting actual database state afterward (e.g. `stock_balances` decremented 100→98), not just a 2xx status code.

**Toolchain note for future sessions**: the composite `pnpm verify:erp` (= `pnpm verify`) fails immediately at its first step, `verify:toolchain`, because this environment runs Node v26.5.0 and the repo pins exactly Node 24 — a pre-existing environment characteristic, not something this session's changes caused (nothing here touches `.nvmrc`/`.node-version`/engines config). Every individual gate the composite would have chained (`verify:t01`, `verify:experience`, `verify:architecture`, `verify:fast`, `verify:routes`, `verify:route-security`, `verify:mobile`, `verify:db`, `verify:worker`, `test:sdk`, `test:packages`, `test:integration`, `test:security`, `test:enterprise-rbac`) was run directly instead (bypassing the toolchain gate) and passed. A real Node 24 environment should be able to run the composite `pnpm verify:erp` directly without this workaround.

One transient false alarm worth recording so it isn't rediscovered: running `test:integration` ad hoc with `DATABASE_URL` accidentally set to the *superuser* connection string (same as `MIGRATION_DATABASE_URL`) makes the RLS-isolation test fail, because a superuser has `BYPASSRLS` — the failure means the test setup is wrong, not that RLS is broken. `DATABASE_URL` must be the actual restricted runtime role (`vercent_app`, provisioned by `pnpm db:provision:runtime-role`) for that test to mean anything; with the correct role, all 5 integration tests pass.

**Not started this session** (i.e. still exactly as the original audit found them, see the gap matrix above): F274 (variant identity on sale lines), F275 (Sales' `previewSalesDocument` reuse for real tax), F277 (a real server-side cart/hold aggregate — F287/F288), F278-F281 (server-authoritative tax/discount-policy/promotions/coupons), the entire payment-provider adapter (F283-F286), F289/F290 (receipts/invoices), F293 (exchanges), F295 (lot/serial requirement validation in POS itself, though Stock's own contract already supports it), F296 (a dedicated availability query beyond the unlocked pre-check), F297/F298 (offline), F303-F305 (Z report/reconciliation/Accounting posting), F306 (loyalty), F307 (real analytics beyond the coarse dashboard). **All frontend/UI work is still entirely unstarted** — every route added this session is an API contract only; `/pos` still renders the generic `ModuleFoundationPage` placeholder.

### Next tranche to pick up

Continue Tranche 1 (F277-F281: a real server-side cart/hold aggregate, then server-authoritative tax via `previewSalesDocument`, then discount/promotion/coupon policy) before starting Tranche 2 (payment providers) — per the module's own dependency order, tender/payment logic should sit on top of a trustworthy cart, not the other way around. The frontend checkout screen (`/pos/checkout`) cannot honestly start until at least F277-F278 have real server-side backing, since a checkout UI with no real cart/tax would just be decorative controls over an incomplete API.
