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
| F268 | Stores and outlets | PARTIAL | Backend `createStore` real; no update/activate-deactivate; no HTTP route; no UI; no test |
| F269 | POS terminals | PARTIAL | Backend `createTerminal` real; no activate/inactivate/maintenance transition function; no HTTP route; no UI; no test |
| F270 | Cashiers | FOUNDATION ONLY | No cashier entity/eligibility model at all — `cashier_user_id` is just a free user reference on `pos_shifts`; no route; no UI |
| F271 | Cashier permissions | BACKEND MISSING | Only one all-powerful `pos_manager` role exists; no cashier-tier role; no route; no UI |
| F272 | Product search | FRONTEND MISSING + BACKEND MISSING | No bounded POS product-search query exists in `index.js`; no route; no UI |
| F273 | Barcode scanning | BACKEND MISSING | No barcode lookup function; no keyboard-wedge handling path; no UI |
| F274 | Product variants | INTEGRATION MISSING | Not addressed by POS code; must reuse Stock/Item variant identity, not fork |
| F275 | Price lists | PARTIAL | `resolvePointOfSaleUnitPrice` is a real, simpler lookup; does not reuse Sales' `previewSalesDocument`; no route; no UI |
| F276 | Customer selection | BACKEND MISSING | `pos_sales.customer_id` has no FK to `business_parties`, no validation, free-text name accepted instead |
| F277 | Cart | FRONTEND MISSING + BACKEND MISSING | No server-side cart aggregate exists; `completePointOfSale` takes a flat `lines[]` with no held/versioned cart identity before commit |
| F278 | Taxes | BACKEND MISSING (integrity gap) | Client-supplied `taxAmount` trusted (range-validated only); does not derive from `tenant.tax_rates`/GST split like Sales does |
| F279 | Discounts | BACKEND MISSING | No policy-driven discount evaluation; `pos.discount.apply` permission checked only if `discount > 0`, no threshold/reason/evidence model |
| F280 | Promotions | BACKEND MISSING | No promotion evaluation exists at all |
| F281 | Coupons | BACKEND MISSING | No coupon validation/redemption exists at all |
| F282 | Cash payments | REAL/VERIFIED | `completePointOfSale` cash path is real, tested (stock-integrity test), change computed correctly, net cash movement (not tendered amount) posted |
| F283 | Card payments | EXTERNAL ACTIVATION BLOCKED (adapter) / BACKEND MISSING (code-controllable parts) | Fails closed deliberately; zero adapter code exists; code-controllable adapter boundary is buildable now, real card capture needs a certified provider + merchant credentials |
| F284 | UPI and digital payments | EXTERNAL ACTIVATION BLOCKED (adapter) / BACKEND MISSING | Same as F283 |
| F285 | Split payments | BACKEND MISSING | `completePointOfSale` sums multiple payment lines but every non-cash line is rejected; split-cash-only "split" has no dedicated handling beyond summation |
| F286 | Multiple payment methods | BACKEND MISSING | Same underlying gate as F283/F284 |
| F287 | Hold/suspend sale | BACKEND MISSING + FRONTEND MISSING | No hold/suspend function exists; `pos_sales.status` CHECK has a `draft` state that's never written |
| F288 | Resume sale | BACKEND MISSING + FRONTEND MISSING | Depends on F287; nothing to resume yet |
| F289 | Receipt printing | BACKEND MISSING + FRONTEND MISSING | No receipt generation/rendering exists |
| F290 | Invoice generation | BACKEND MISSING + INTEGRATION MISSING | No invoice path; `sales_order_id` column unused |
| F291 | Returns | PARTIAL | Backend real for cash-tendered sales (creation/approval/completion); no HTTP route; no UI; largely untested beyond one stock-integrity angle |
| F292 | Refunds | PARTIAL | Cash refund real; non-cash fails closed (correct, but adapter-dependent); no route; no UI |
| F293 | Exchanges | BACKEND MISSING | No exchange function exists at all; dossier requires linked return+replacement-sale lineage, not implemented |
| F294 | Stock reduction | REAL/VERIFIED | Goes through canonical `postStockMovement`; regression-tested against real double-decrement/idempotency/insufficient-stock races |
| F295 | Lot/serial support | PARTIAL | Stock's `postStockMovement` accepts `batchId`/`serialId` and POS can pass them through, but POS itself does not validate lot/serial *requirement* per item before checkout |
| F296 | Real-time inventory | PARTIAL | `stockAvailable()` read exists but is an unlocked pre-check only; final safety is Stock's own row lock inside `postStockMovement` (correct architecture, no dedicated "availability for search results" query yet) |
| F297 | Offline POS | BACKEND MISSING + FRONTEND MISSING | Zero infrastructure in `apps/web` (no service worker/IndexedDB); `apps/mobile` has a real, reusable encrypted-SQLite + batch-sync pattern that hasn't been ported |
| F298 | Offline-to-online sync | BACKEND MISSING | Same as F297 — nothing to sync yet |
| F299 | Cash drawer opening balance | REAL/VERIFIED | `openShift` posts an immutable opening cash movement correctly |
| F300 | Cash movements | PARTIAL | Opening/sale/refund movements real; `paid_in`/`paid_out`/`closing_adjustment` never implemented despite schema + permission existing |
| F301 | Shift opening | PARTIAL | Real; DB-enforced one-open-shift-per-terminal via partial unique index; not idempotency-key protected (network retry could double-attempt, though the unique index would reject the second) |
| F302 | Shift closing | PARTIAL | Variance computed against cash movements; does not check unresolved payment/offline state; does not write `pos_reconciliations` |
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
5. Continue numbering DB migrations from `112` (the last migration in the repo is `111_f029_opportunity_bulk_scale.sql`).

## Continuation point (read this first in any future session)

This is a genuinely large, multi-tranche program (40 features spanning store/terminal/cashier control, a full cart/pricing/tax/promotion engine, a payment-provider framework, receipts/invoices, returns/refunds/exchanges, offline sync, shift/cash/reconciliation/accounting, loyalty, and analytics — each with real DB, backend, API, frontend, and test surface). It is not realistic to complete in a single pass, and the trackers already on record (`PRODUCTION_TRACKER.md`, `ERP_COMPLETION_EXECUTION_TRACKER.md`) reflect that reality rather than a false "quick fix" framing.

Update this section at the end of every future session with: what tranche was completed, what verification ran, and the exact next tranche to pick up.

- Session 1: audit complete (this document), backend hardening + HTTP route layer + real cashier/supervisor roles + Tranche 1 (F268-F281) work in progress. See commit history on `rebuild/clean-frontend` from SHA `524dc6a8` onward for exact deltas; each capability lands as its own commit per the repo's commit-discipline convention.
