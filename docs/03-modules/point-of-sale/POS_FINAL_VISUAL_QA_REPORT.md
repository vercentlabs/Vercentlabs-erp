# POS Final Visual QA Report

Comprehensive visual, responsive, interaction and accessibility QA pass across the entire POS module, performed against the real running application (real dev server, real browser via Playwright, real seeded PostgreSQL data) — not inferred from a passing build. This is the companion document `POS_VISUAL_QA_HANDOFF.md` was written to hand off to; that document's per-screen notes and test-data setup instructions remain valid context, this report is the actual result.

## Method

- **App under test**: `apps/web` dev server (Next.js/Turbopack), real PostgreSQL (`vercentlabs-postgres` docker container), real seeded data — not mocked.
- **Automation**: `apps/web/e2e/pos-visual-qa.spec.ts` (new) drives three real, separately-authenticated personas (cashier/supervisor/manager, from `pos-fixtures.ts`) through every implemented POS route, seeds a richer dataset on top of the base fixture (a completed sale with a customer and a promotion+coupon applied, a second sale, a full return/refund, a closed day-end report + reconciliation, an accounting-posting failure queue), and saves a real full-page screenshot per viewport to `apps/web/e2e/visual-qa-screenshots/` (63 files, gitignored — regenerate with the command below).
- **Accessibility**: `apps/web/e2e/pos-accessibility.spec.ts` (new) runs `@axe-core/playwright` (wcag2a+wcag2aa tags, critical/serious violations block) against all 15 pages across all 3 personas — the same tool and threshold `accessibility.spec.ts` already uses for CRM.
- **Viewports**: 1440×900 (desktop), 1280×800 (laptop), 1024×900 (tablet landscape), 768×1024 (tablet portrait), 390×844 (mobile), 360×780 (mobile, narrow). Checkout and Analytics (the highest-traffic and highest-content-volume screens) got the full 6-viewport sweep; every other screen got the 3-viewport sample (1440/1024/390) — an admin/back-office screen was never a touch-first design target, matching CRM's own convention (see `POS_CRM_ARCHITECTURE_ALIGNMENT.md`).
- **Screenshots were actually opened and read** (via the image-reading tool), not assumed correct because the capture run exited 0. Every finding below was confirmed by looking at the real rendered pixels.

To regenerate:
```
# with the web dev server running on :3001 and Postgres up
QA_PORT=3001 QA_BASE_URL=http://localhost:3001 npx playwright test pos-visual-qa.spec.ts pos-accessibility.spec.ts --reporter=list
```

## Screen-by-screen inventory (19 screen/state combinations, 63 screenshots)

| Screen | Route | Persona | Viewports | States captured | Result |
|---|---|---|---|---|---|
| Checkout | `/pos/checkout` | cashier | 6 (full sweep) | Empty cart, populated tender panel | Bug found + fixed (cold-load race, see below) |
| Overview | `/pos` | manager | 3 | Dashboard with real counts | Clean |
| Stores | `/pos/stores` | manager | 3 | Populated list | Clean |
| Terminals | `/pos/terminals` | manager | 3 | Populated list | Clean |
| Cashiers | `/pos/cashiers` | manager | 3 | Populated list, horizontally-scrollable grid | Clean (grid overflow is by design, see below) |
| Promotions | `/pos/promotions` | supervisor | 3 | **Permission-denied** (see note) | Clean, correct |
| Promotions | `/pos/promotions` | cashier | 3 | Permission-denied | Clean |
| Coupons | `/pos/coupons` | supervisor | 3 | **Permission-denied** (see note) | Clean, correct |
| Loyalty | `/pos/loyalty` | supervisor | 3 | Populated program config form | Clean |
| Returns | `/pos/returns` | cashier | 3 | Populated list, one completed return | Clean |
| Receipt | `/pos/receipts/[saleId]` | cashier | 3 | Populated, with promotion evidence line | Bug found + fixed (discount amount, see below) |
| Invoices | `/pos/invoices` | cashier | 3 | Empty state | Clean |
| Day-end list | `/pos/reports/day-end` | manager | 3 | Populated, closed + reviewed reports | Bug found + fixed (raw ISO date, see below) |
| Day-end detail | `/pos/reports/day-end/[id]` | manager | 3 | Closed report detail | Bug found + fixed (raw ISO date, see below) |
| Reconciliation | `/pos/reconciliation` | manager | 3 | Empty (variance) filter | Clean |
| Accounting posting | `/pos/accounting` | manager | 3 | Populated pending queue + account-mapping config section | Clean (see load-timing note below) |
| Accounting posting | `/pos/accounting` | cashier | 3 | Permission-denied | Clean |
| Analytics | `/pos/analytics` | manager | 6 (full sweep) | Populated summary + all metric sections | Clean |
| Offline sync conflicts | `/pos/offline-sync-conflicts` | manager | 3 | Empty state | Clean |

**Note on Promotions/Coupons showing permission-denied for the supervisor persona**: this is correct, not a bug. `pos_supervisor` (`packages/permissions/src/roles.js`) is deliberately scoped as "store-floor override authority... does not configure stores/terminals/settings" and does not hold `pos.settings.manage`. The test's own seeding used a broader ad-hoc permission set for direct API calls (convenient for seeding data only), which is unrelated to what the real logged-in `pos_supervisor` role grants in the browser. The permission-denied screens themselves render correctly and are genuine, valuable evidence of the real access-control boundary working as designed.

## Journeys executed

- **Full checkout sweep** (cashier): shift-context resolution → empty cart → tender panel, across all 6 viewports.
- **Sale → return → refund → receipt** (cashier + supervisor, via seeding): a completed multi-line sale with a customer, a promotion and coupon applied, a full return with restock, approval, and completion — refund correctly allocated to cash — then the receipt viewed with real promotion/coupon/tax evidence.
- **Shift close → day-end generate → review → finalize → reconciliation** (supervisor + manager, via seeding): the supervisor's dedicated shift closed, a day-end report generated/reviewed, finalized by a different authority (manager), then a reconciliation generated against it — proving the real SoD (separation-of-duties) authority split renders correctly end to end.
- **Accounting posting retry queue** (manager): a real pending/failed posting queue populated from real sales/returns, plus the account-mapping configuration section (Gap C from the prior functional-closure pass) rendered together on the same screen.
- The 14-step interactive checkout journey (product search/scan → variants → quantities → customer → discounts/coupons → tax/totals → payment → split tender → receipt → hold/resume → returns → shift close) is exercised by the existing `apps/web/e2e/pos-checkout.spec.ts` functional suite, not re-driven interactively by this visual-QA pass — this pass's job was screenshot/layout/accessibility evidence, not re-proving functional correctness already covered by dedicated Playwright specs and the real-Postgres integration suite.

## CRM design-standard comparison (Phase 4)

POS's admin/back-office screens (`/pos/stores`, `/terminals`, `/cashiers`, `/promotions`, `/coupons`, `/reports/day-end`, `/reconciliation`, `/accounting`, `/offline-sync-conflicts`) already use the same shared components CRM's own list screens use: `EnterpriseListPage` for the header/filter shell and `EnterpriseDataGrid` for tabular data (same `overflow-auto` horizontally-scrollable, `max-h-[70vh]`-capped grid body, same `StatusBadge`/`Button`/`Select`/`TextField` design-system primitives). No divergent pattern was introduced.

`/pos/checkout` and `/pos/receipts/[saleId]` deliberately do **not** follow the CRM list/detail convention — they're a specialized single-screen, touch-first cashier-speed layout (product search, live cart, tender panel) and a print-optimized receipt document, respectively. This is an intentional, disclosed design decision (see `POS_VISUAL_QA_HANDOFF.md`'s "Responsive/device coverage expected" section), consistent with the instruction to keep checkout optimized for cashier speed rather than converting it into a CRM data-entry form. `/pos/analytics` and `/pos/reports/day-end/[id]` are content-heavy single-page layouts (metric-section stacks / a printable Z report), also intentionally distinct from the list/grid convention for the same reason — they're documents/dashboards, not editable records.

## Real bugs found (by actually inspecting screenshots) and fixed

1. **Checkout cold-load race** — `apps/web/src/features/pos/checkout/screens/PosCheckoutScreen.tsx`. On the very first navigation to `/pos/checkout` in a fresh browser session, the screen showed "No open shift found. Open a shift before starting checkout." — indistinguishable from a genuine no-shift state — even though the cashier's shift was already open. Root cause: `myOpenShift` was derived purely from `shiftsQuery.data`, which is `undefined` while the query is still in flight; the `!myOpenShift` guard fired before the query resolved. Every subsequent navigation (once React Query's result had settled) rendered correctly, which is exactly why this kind of bug survives a quick manual check but not a real first-load screenshot. **Fix**: check `shiftsQuery.isLoading` first and render a loading state.
2. **Raw ISO datetime shown for a calendar date** — `PosDayEndReportDetailScreen.tsx` and `PosDayEndReportsScreen.tsx`. "Business date" rendered as `2026-09-17T18:30:00.000Z` instead of `2026-09-17` on both the day-end report list and detail screens. Root cause: `business_date` (a DATE column) round-trips through the API as a full ISO datetime string once node-postgres/JSON hand it back as a Date object. **Fix**: added `calendarDate()` to `apps/web/src/features/pos/shared/format.ts`, which reads the first 10 characters as the calendar date rather than calling `new Date(value).toLocaleDateString()` — the latter would re-parse in the browser's local timezone and could shift the displayed day by one (exactly the class of bug being fixed, not just its symptom).
3. **Promotion discount stored and receipted 1,000,000× too large** — `services/api/src/modules/point-of-sale/assortment-pricing-customer-and-cart/cart-pricing.js`, `evaluatePromotions()`. The real receipt for a seeded sale showed a promotion discount line of **−INR 50,000,000.00** for what should have been a 10%-of-500 = −INR 50.00 discount (the "Discounts" summary line two rows above it correctly showed −INR 50.00, confirming the per-line evidence value specifically was wrong). Root cause: the raw BigInt-scaled `decimal.js` value (internal `SCALE` = 1,000,000) was pushed into the `applications` array and inserted directly into `tenant.pos_promotion_applications.discount_amount` without the `asDatabaseDecimal()` conversion every other DB-bound field in the same file receives — the same class of bug as the BigInt-into-JSON crash found and fixed in the prior gap-closure pass, in a codepath that fix didn't cover. The parallel coupon path (`priced.coupon.amount`) already converted correctly, which is what made the promotions path's omission identifiable as a genuine inconsistency rather than a deliberate design choice. **Fix**: convert at the point `amount` crosses into the DB-bound `applications` array. **Regression coverage**: `tests/integration/pos-cart-tax-promotions-coupons-f277-f281.test.mjs`'s F289 receipt test was strengthened to assert `discount_amount < grand_total` — it previously only asserted the promo code appeared in the evidence, which is exactly why a 1,000,000× inflation went undetected until a real screenshot was inspected.

Also fixed, test infrastructure only (not application code): `apps/web/e2e/pos-global-teardown.ts` never tore down `pos_day_end_reports`/`pos_reconciliations` at all (no prior spec had ever created one against fixture data), then — once that gap was closed — hit those tables' own intentional immutability triggers (a closed day-end report / resolved reconciliation cannot be deleted by design; `tenant.pos_day_end_report_protect_closed()`/`pos_reconciliation_protect_resolved()`, migrations 121/127). Now handled with a `SAVEPOINT` so that expected, by-design failure permanently retains just that run's store/shift/terminal chain (the same pattern already used for `public.users`, disabled rather than deleted) without rolling back the rest of that run's otherwise-successful cleanup.

## Non-bugs investigated and ruled out

- **`EnterpriseDataGrid` columns clipped on mobile screenshots** (Cashiers, Stores grids): the grid's own scroll container uses `overflow-auto` — real, keyboard-accessible (`tabIndex={0}`, `role="group"`) horizontal scroll, the same pattern CRM's own grids already use. Playwright's `fullPage` screenshot only extends vertically, not horizontally, so a screenshot cropping off-viewport columns is a capture-tool limitation, not an application bug.
- **A dev-server-only "1 Issue" floating pill** visible in the bottom-left corner of every screenshot: this is Next.js 16's built-in dev-mode indicator, not application UI — it does not exist in a production build (confirmed via `build:web`, which produces no such chrome) and carries no POS-specific content.
- **The breadcrumb org-switcher text clipping at the right edge on narrow mobile widths** (e.g. `CRM E2E Fixture Co · Head Offic…`): this is shared app-shell chrome used by every module, not POS-owned code, and pre-dates this pass. Flagged here for visibility but intentionally not modified — fixing shared shell chrome is outside this pass's scope and could affect every other module.
- **A "Loading…" state caught mid-render on one Accounting Posting screenshot early in this pass**: not a real bug — the capture helper's original fixed 400ms post-`networkidle` wait wasn't always enough for this screen's client-side query waterfall on a dev server compiling routes on demand. Fixed in the capture tooling itself (`pos-visual-qa.spec.ts`'s `shoot()` now waits for all "Loading…" text to clear, bounded at 8s, before capturing) rather than treated as an application defect.
- **Accumulated `E2E-POS-*` fixture stores/terminals visible in list screenshots**: leftover rows from earlier debugging runs in this same session (an in-session teardown bug, now fixed, plus one bulk-delete cleanup blocked by this environment's own destructive-action permission classifier). Harmless — fixture store codes are timestamp-suffixed and never collide — and unrelated to the module's actual correctness. Not cleaned up in this pass (the safe path, a scoped `DELETE` across several tables, was declined by the permission system as a mass-delete action); a person with direct database access can remove them at their discretion.

## Accessibility findings (Phase 8)

`pos-accessibility.spec.ts`: 16/16 passing — **zero critical/serious axe violations** across all 15 POS pages tested against 3 personas (manager: overview/stores/terminals/cashiers/day-end/reconciliation/accounting/analytics/offline-sync-conflicts; supervisor: promotions/coupons/loyalty; cashier: checkout/returns/invoices). wcag2a + wcag2aa tags, same tool and threshold as CRM's existing `accessibility.spec.ts`.

## Responsive results (Phase 5)

No overflow/clipping/overlap/alignment defects were found at any of the 6 tested breakpoints beyond the non-bugs listed above. Checkout stacks cleanly to a single column at 390/360px with all controls reachable and readable. Analytics' metric-section stack reads fine full-width down to 360px (long vertical scroll, as expected for a dashboard of this content volume — not a defect, matches the screen's own documented design intent in `POS_VISUAL_QA_HANDOFF.md`). Admin/back-office grids remain usable down to 390px via their existing horizontal-scroll convention.

## Screen states verified (Phase 7)

| State | Verified where |
|---|---|
| Loading | Checkout (fixed, see bugs above); Accounting posting (capture-tooling fix, not app bug) |
| Empty | Invoices, Reconciliation (no exceptions), Offline sync conflicts |
| Populated | Checkout (tender panel), Stores/Terminals/Cashiers, Returns, Receipt, Day-end list/detail, Accounting posting queue, Analytics, Loyalty |
| Permission-denied | Promotions/Coupons (supervisor — real role boundary), Promotions/Accounting (cashier) |
| Success (completed sale/return) | Returns list (completed status), Receipt (paid, change computed) |

States not separately captured by screenshot in this pass (already covered by the existing functional/integration suites rather than re-proven visually): validation-error, API-failure, duplicate-submission, conflict/retry, offline, sync-conflict, and provider-not-configured. These are functional-correctness states already asserted against real PostgreSQL in `tests/integration/*.test.mjs` and the dedicated `pos-*.spec.ts` Playwright specs; this pass's screenshot evidence focuses on the states a real user encounters during normal screen navigation.

## Full regression results (Phase 10)

Run after every fix in this report was applied.

| Gate | Result | Baseline |
|---|---|---|
| `test:api` | 1112/1112 | 1112/1112 |
| `test:web` | 21/21 | 21/21 |
| `test:sdk` | 14/14 | 14/14 |
| `test:worker` | 102/102 | 102/102 |
| `test:security` | 4/4 | 4/4 |
| `node --test tests/integration/*.test.mjs` (real PostgreSQL) | 161/161 | 161/161 |
| `typecheck:web` | clean | clean |
| `lint:web` | clean, 0 warnings | clean |
| `build:web` | clean, all POS routes present | clean |
| `verify:architecture` | OK (all 7 checks) | OK |
| `verify:db` | OK — 128 tenant migrations, 45 platform | OK |
| `verify:routes` | OK — 221 route.ts, 92 page.tsx | OK |
| `verify:route-security` | OK — 171 mutation routes, 0 gaps | OK |
| `playwright test pos-visual-qa.spec.ts` | 7/7 | new |
| `playwright test pos-accessibility.spec.ts` | 16/16, 0 critical/serious violations | new |

No baseline number regressed. The integration-suite count (161) is unchanged from the prior pass — this pass strengthened an existing assertion rather than adding a new test file.

## Final requirement-level status (F268–F307)

Unchanged from `POS_FINAL_FUNCTIONAL_VERIFICATION.md`'s feature table except where this visual-QA pass found and fixed a real defect (noted below); none of this pass's findings downgrade any feature's status, since every defect found was fixed with verification evidence in the same pass.

| Status | Features |
|---|---|
| **FULLY VERIFIED** | F268, F269, F270, F271, F272, F273, F274, F276, F277, F278, F279, F280, F281, F282, F285, F286, F287, F288, F289 (bug found + fixed this pass, now verified), F290, F291, F292 (bug found + fixed this pass, now verified), F293, F294, F295, F296, F297, F298, F299, F300, F301, F302, F303 (bug found + fixed this pass, now verified), F304, F305, F306, F307 |
| **PARTIAL (deliberate, disclosed)** | F275 (own simpler price lookup by design, not a gap) |
| **EXTERNAL ACTIVATION BLOCKED** | F283, F284 (code-complete and verified against the sandbox adapter; no live merchant-certified provider credential exists in this environment) |
| **FUNCTIONALLY INCOMPLETE** | none |
| **VISUAL ISSUE** | none remaining (three found this pass, all fixed and reverified — see "Real bugs found" above) |
| **ENVIRONMENTALLY UNVERIFIED** | none — the real dev server, real browser, and real PostgreSQL were all successfully used for every check this pass required |

The module is not being called "fully complete": F283/F284 remain genuinely blocked on an external credential this environment cannot obtain (disclosed, not a functional gap), and F275's simpler price lookup is a disclosed, deliberate design decision. Every other requirement in F268–F307 has real backend, UI, database, security, accessibility and visual evidence as of this pass.
