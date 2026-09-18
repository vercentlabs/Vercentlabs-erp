# POS Session 3 — Consolidated Pass Verification Report

Branch: `rebuild/clean-frontend` (PR #8, unmerged). Starting SHA `c39b7ac8` (`main`, after the documented fast-forward reconciliation recorded in `POS_IMPLEMENTATION_TRACKER.md`). Current HEAD at the time of writing: `1919d540`.

This report is the single source of truth for what this consolidated pass actually verified. `POS_IMPLEMENTATION_TRACKER.md` carries the narrative/decision history; this file carries the raw verification evidence it summarizes.

## 1. Commits this pass

```
289d25a3 fix local dev/verify scripts broken by the Hostinger packageManager change
d0d9530d fix(pos): close discount-approval forgery hole; add per-cashier store access
e7a7b564 fix(pos): close remaining Phase 2 store-access gaps
50169c04 fix(pos): audit-field integrity, usage-limit races, F276 customer search
dbad4254 feat(pos): F268-F271 store/terminal/cashier administration
866df105 feat(pos): F280/F281 promotion and coupon administration UI
0df51949 feat(pos): F287/F288 held-cart operator workflow
d14b7f5d feat(pos): F289 receipt generation and reprint
4c22ef6f feat(pos): F291/F292 cash returns and refunds UI
69de89e6 feat(pos): F300 cash movements and F302 shift-close safety guards
dda2d36a feat(pos): F293 exchanges as linked lineage over existing primitives
6b173437 fix(pos): close discount-approval bypass on the legacy flat-lines checkout path
754d9e6a chore(pos): add shared-sdk parity for the F268-F302 API surface; fix pnpm invocation in playwright config
5c242420 fix(pos): add idempotency protection to paid-in/paid-out cash movements
de1b6018 test(security): prove revoked/expired role assignments and deactivated users can never reach decideApproval
1b6fcb09 test(pos): prove cross-tenant isolation and cart/shift lifecycle guards against real PostgreSQL
ff16f323 test(pos): prove idempotent checkout/returns, price-integrity, and stock-race safety against real PostgreSQL
1919d540 docs(pos): record the verification-gate battery and 26-item security matrix results
```

Grouped by concern (see each commit message for full detail):
- **Security fixes (2 genuine production-code bugs)**: `6b173437` (legacy-path discount-approval bypass, matrix item #13), `5c242420` (cash-movement idempotency, matrix item #23). Both also closed by `d0d9530d`/`50169c04` earlier in the pass (cart-path discount forgery, audit-field stamping, usage-limit races).
- **Feature work (F268-F302 UI + backend)**: `dbad4254`, `866df105`, `0df51949`, `d14b7f5d`, `4c22ef6f`, `69de89e6`, `dda2d36a`, `e7a7b564`.
- **Infra/tooling**: `289d25a3`, `754d9e6a` (pnpm-via-Corepack fix).
- **Test-only, no production change** (proving existing guards already work): `de1b6018`, `1b6fcb09`, `ff16f323`.
- **Docs**: `1919d540`.

## 2. Security fixes made this pass

| Item | Defect | Fix | Regression test |
|---|---|---|---|
| Cart-path discount forgery | `approvedBy` was a client-supplied field trusted as proof of supervisor approval, no authentication check | Routed through the platform's real maker-checker engine (`decideApproval()` / `pos.discount.approve`); `approvedBy` removed from every input shape | `pos-cart-tax-promotions-coupons-f277-f281.test.mjs` |
| Flat-amount discount threshold bypass | Only `percent`-type discounts were compared against the approval threshold; `amount`-type discounts skipped the check entirely | Both types now compute effective-percent-of-base with fixed-point decimals | same file |
| Audit-field stamping (`updated_by`) | `updatePosPromotion`/`updatePosCoupon`/`setPosPromotionActive`/`setPosCouponActive` stamped the record's own id into `updated_by` instead of the acting user | Derive the actor from session context everywhere | `pos-audit-integrity-and-usage-concurrency.test.mjs` |
| Promotion/coupon per-customer usage-limit race | Limit checked at preview only, never re-verified inside the completion transaction | Re-checked under the record's own row lock at commit; proven with a genuine two-Postgres-connection race | same file |
| **Matrix #13 — legacy flat-lines discount bypass** | `completePointOfSale`'s `pos_settings` SELECT never fetched `max_line_discount_percent`/`discount_approval_threshold_percent`, so the org's configured cap was silently ignored and any above-threshold discount was accepted with zero approval | Both columns now fetched; path fails closed with `POS_DISCOUNT_APPROVAL_REQUIRED` above threshold | New tests in `pos-cart-tax-promotions-coupons-f277-f281.test.mjs` (17/17 total) |
| **Matrix #23 — cash-movement idempotency** | `recordPosCashMovement` had no replay protection at all — a client retry could double-post a paid-in/paid-out movement | Wired into the shared `operation_idempotency` reserve-then-complete mechanism; `idempotencyKey` now required end-to-end (route, pos-api.ts, shared-sdk, UI) | `pos-cash-movements-and-shift-close-f299-f302.test.mjs` (5/5) |

## 3. 26-item negative security/concurrency matrix — final disposition

An independent audit subagent read every real-Postgres POS test file plus the relevant source (`cart.js`, `cart-pricing.js`, `approvals.js`, the Stock module) and rated all 26 adversarial/concurrency scenarios. Results below are AFTER this pass's remediation.

| # | Scenario | Final status | Disposition |
|---|---|---|---|
| 1 | Cross-organization access | COVERED (test added) | `pos-cross-tenant-and-lifecycle-security.test.mjs` |
| 2 | Cross-company access, same org | COVERED (test added) | same file |
| 3 | Cross-store access | COVERED (pre-existing) | `pos-store-access-f268-f273.test.mjs` |
| 4 | Cross-terminal shift/resume conflict | COVERED (pre-existing) | `pos-hold-resume-f287-f288.test.mjs` |
| 5 | Unauthorized shift-open-as-someone-else | COVERED (pre-existing) | `pos-store-access-f268-f273.test.mjs` |
| 6 | Revoked/inactive cashier | COVERED (test added) | `session-revocation-inactive-approver.test.mjs` — proven to be a session-resolution guarantee, not a POS-local check |
| 7 | Inactive/unauthorized supervisor deciding an approval | COVERED (test added) | same file |
| 8 | Forged/self-asserted `approvedBy` | COVERED (pre-existing) | F277-F281 suite |
| 9 | Self-approval | COVERED (pre-existing) | same file |
| 10 | Stale/superseded discount approval | COVERED (pre-existing) | same file |
| 11 | Stale cart version conflict | COVERED (pre-existing) | same file |
| 12 | Forged/tampered unit price | COVERED (test added) | `pos-idempotency-and-price-integrity.test.mjs` — confirmed the forged price is silently overridden, not merely rejected |
| 13 | Forged/tampered discount amount (legacy path) | **FIXED** (was NOT COVERED) | genuine bug, see §2 |
| 14 | Cross-company item/variant | COVERED (test added) | `pos-cross-tenant-and-lifecycle-security.test.mjs` |
| 15 | Duplicate/invalid serial sold twice | **GENUINE DATA-MODEL GAP** | No `requires_serial` column on `tenant.items`, no serial-status lifecycle writes in Stock. Same root cause as F295. Disclosed, deferred to a Stock-module pass. |
| 16 | Expired coupon at checkout | COVERED (test added) | `pos-cross-tenant-and-lifecycle-security.test.mjs` |
| 17 | Per-customer coupon usage-limit race | COVERED (pre-existing) | `pos-audit-integrity-and-usage-concurrency.test.mjs` |
| 18 | Per-customer AND per-store promotion/coupon usage-limit race | PARTIALLY COVERED | Per-customer half covered (#17's pattern). Per-store half is a genuine data-model gap — no `usage_limit_per_store` column exists on `pos_promotions`/`pos_coupons`. Disclosed, deferred. |
| 19 | Two terminals racing for the last unit of stock | COVERED (test added) | `pos-idempotency-and-price-integrity.test.mjs` — genuine two-connection race, exactly one succeeds, stock never negative |
| 20 | Duplicate checkout (idempotency retry) | COVERED (test added) | same file |
| 21 | Duplicate return request (idempotency retry) | COVERED (test added) | same file |
| 22 | Duplicate exchange request | COVERED (pre-existing) | `pos-exchange-f293.test.mjs` |
| 23 | Duplicate/concurrent cash movement | **FIXED** (was NOT COVERED) | genuine bug, see §2 |
| 24 | Closing a shift with an unresolved cart/return | COVERED (pre-existing) | `pos-cash-movements-and-shift-close-f299-f302.test.mjs` |
| 25 | Mutating a cancelled cart / closed shift | COVERED (test added) | `pos-cross-tenant-and-lifecycle-security.test.mjs` |
| 26 | Audit-field forgery | COVERED (pre-existing, broad but not exhaustive) | multiple suites |

**Summary**: 24/26 fully COVERED, 1/26 PARTIALLY COVERED (item 18, per-store half only), 1/26 remains a genuine cross-module data-model gap requiring Stock-module work first (item 15). Zero items left with no test and no disposition. Two real production bugs were found and fixed (items 13, 23); every other item was already correctly guarded and simply lacked a real-Postgres regression test, now added.

## 4. Verification gate battery

Run directly (not through the composite `pnpm verify`/`verify:erp`, which fails at its first step, `verify:toolchain`, purely because this environment runs Node v26.5.0 against the repo's `>=24 <25` pin — a pre-existing, undisclosed-by-this-session environment characteristic every prior session already documented):

| Gate | Result |
|---|---|
| `verify:architecture` | PASS — 110 capability-owned API files, 0 legacy; all 12 backend module roots; local import resolution; public cross-module contracts; deployment command references; 872 Markdown docs link-checked |
| `verify:db` | PASS — 40 platform migrations, 116 tenant migrations, all transaction-wrapped/RLS-enforced/organization-scoped |
| `verify:routes` | PASS — 84 page.tsx, 185 route.ts (116 CRM + 69 non-CRM incl. all POS) |
| `verify:route-security` (`validate-route-security.mjs`) | PASS — 147 mutation-capable routes, 0 unexplained gaps |
| `typecheck:web` | PASS — clean `tsc --noEmit` |
| `lint:web` | PASS — clean `eslint .` |
| `test:web` | PASS — 21/21 |
| `test:api` | PASS — 1112/1112 (includes all mocked POS unit suites) |
| `test:sdk` (shared-sdk) | PASS — 14/14 |
| `test:packages` | PASS — all 10 packages green (config, document-engine, observability, localization, test-utils, reporting-engine, workflows, design-tokens, permissions, landing-content) |
| `tests/integration/*.test.mjs` (real Postgres) | PASS — 86/88, 2 skipped (pre-existing, unrelated: CRM-only restricted-runtime-role RLS tests requiring a separately-provisioned `DATABASE_URL` role not configured in this environment) |
| `test:security` | PASS — 4/4 |
| `test:enterprise-rbac` | PASS — 5/5 |
| `test:worker` | PASS — 102/102 |
| `permissions` package tests | PASS — 8/8 |
| `build:web` | PASS — 147 dynamic + 2 static routes, all `/pos/*` pages and `/api/pos/*` routes present in the manifest, no build errors |
| `verify:toolchain` | FAIL — pre-existing, unrelated (Node v26.5.0 vs. pinned v24; not touched by this pass) |
| `verify:experience` (optional) | FAIL — 3 pre-existing violations, all CRM-scoped (dashboard/forecast/import-export raw `<table>` usage), zero POS-related |

Individual POS real-Postgres integration files (all independently re-run and confirmed, not taken on trust from the agents that authored them):

| File | Pass |
|---|---|
| `pos-cart-tax-promotions-coupons-f277-f281.test.mjs` | 17/17 |
| `pos-store-access-f268-f273.test.mjs` | 11/11 |
| `pos-store-terminal-cashier-admin.test.mjs` | 6/6 |
| `pos-audit-integrity-and-usage-concurrency.test.mjs` | 7/7 |
| `pos-hold-resume-f287-f288.test.mjs` | 5/5 |
| `pos-cash-movements-and-shift-close-f299-f302.test.mjs` | 5/5 |
| `pos-exchange-f293.test.mjs` | 6/6 |
| `pos-cross-tenant-and-lifecycle-security.test.mjs` (new) | 8/8 |
| `pos-idempotency-and-price-integrity.test.mjs` (new) | 6/6 |
| `session-revocation-inactive-approver.test.mjs` (new) | 5/5 |

## 5. Playwright E2E suite

**Status at time of writing: build still in progress (background agent).** This section will be completed and this report republished once that run finishes and its results are independently re-verified. Do not treat POS E2E coverage as complete until this section is filled in.

## 6. Migrations added this pass

- `database/platform/migrations/040_pos_discount_approval_permission.sql` — registers `pos.discount.approve`, grants to `pos_manager`/`organization_owner`/`system_administrator`, revokes `pos.discount.apply` from `pos_manager`.
- `database/tenant/migrations/114_pos_discount_approval_integrity.sql` — `status`/`approval_request_id` on `pos_cart_discount_approvals`, nullable `approved_by`/`approved_at`, RLS.
- `database/tenant/migrations/115_pos_store_access.sql` — `tenant.pos_store_access` (the cashier/store eligibility model).
- `database/tenant/migrations/116_pos_exchange_lineage.sql` — `exchange_return_id` on `tenant.pos_sales`.

## 7. Genuinely blocked / deliberately deferred

- **F295 (lot/serial support) / matrix item #15** — blocked on Stock-module data model (no tracking-type column on `items`, no serial-status lifecycle in `stock/index.js`). Not a POS-side gap; POS was explicitly instructed not to invent its own lot/serial truth.
- **Matrix item #18, per-store half** — no `usage_limit_per_store` column exists on `pos_promotions`/`pos_coupons`. Small, disclosed, deferrable.
- **F283-F286 (payment providers, split tender), F297/F298 (offline/sync)** — explicitly deferred to the next major pass per the owner's own stated plan.
- **F303-F307 (Z-report/reconciliation/accounting posting/loyalty/analytics)** — explicitly deferred to the final major pass, alongside a complete F268-F307 atomic-requirement audit and performance/fault/security/release hardening.

## 8. Remaining plan (as previously agreed)

- **NEXT MAJOR PASS**: F283-F286 (payment providers/split tender) + F297/F298 (offline/sync).
- **FINAL MAJOR PASS**: F303-F307 (Z-report/reconciliation/accounting posting/loyalty/analytics) + complete audit + hardening.

See `POS_IMPLEMENTATION_TRACKER.md`'s "Next tranche to pick up" section for the fuller, itemized backlog (terminal-level cashier eligibility, promotion/coupon eligibility pickers, `listPointOfSaleResource` row-filtering for payments/cash-movements/reconciliations, etc.).
