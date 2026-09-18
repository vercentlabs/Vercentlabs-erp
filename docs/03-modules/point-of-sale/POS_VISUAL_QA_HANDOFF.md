# POS Visual QA Handoff

**Status: the visual/UX/accessibility QA pass this document was written to hand off has now been performed.** See `POS_FINAL_VISUAL_QA_REPORT.md` for the full screen-by-screen inventory, viewport coverage, screenshot evidence locations, and the real bugs found and fixed. This document is kept as-is below for its original context (test-data setup, per-screen notes) — treat its "known non-visual limitations" list as historical; the current list is in the final report.

Every screen below is functionally complete and backed by real backend/API/DB work (see `POS_FINAL_FUNCTIONAL_VERIFICATION.md`). This document exists so the next session can be **visual/UX QA only** — checking layout, spacing, responsiveness, accessibility and polish, not chasing missing functionality. Where a screen has a known non-visual limitation, it is called out explicitly and separated from anything that's merely "not yet visually reviewed."

No POS wireframes exist anywhere in this repository (a standing gap recorded since Session 1) — every screen below was built directly against the design system's existing primitives and the visual conventions already established by CRM/Accounting screens, not against a visual spec. Visual QA should expect to be the FIRST real design review these screens receive.

## Test data setup (no seed script exists)

There is no `db:seed` command for POS demo data. To exercise these screens with real data, either:

1. **Manually**, in this order: Settings → create/verify an active company → `/pos/stores` (create a store) → `/pos/terminals` (create a terminal on that store) → assign yourself/a test user via `/pos/cashiers` (only needed once an org has configured any `pos_store_access` row — see the store-access "permissive until configured" note in `POS_CRM_ARCHITECTURE_ALIGNMENT.md`) → `/pos/checkout` to open a shift and ring up sales → `/pos/loyalty` and `/pos/promotions`/`/pos/coupons` for their own admin data.
2. **Reuse the permanent Playwright fixtures** at `apps/web/e2e/pos-fixtures.ts` — three real, separately-authenticated personas (`pos_cashier`/`pos_supervisor`/`pos_manager`) with real scrypt-hashed passwords, already-provisioned stores/terminals/shifts. These are built for automated E2E, not manual QA, but are the fastest way to get a realistic multi-role dataset if the automated suite is run first (`apps/web/e2e/pos-*.spec.ts`) and its `pos-global-teardown.ts` is skipped/disabled temporarily.
3. **Card/UPI payments**: only the `sandbox` adapter is registered — configure `tenant.pos_payment_provider_configs` for a store (`payment_method: 'card'|'upi'`, `provider_key: 'sandbox'`) and set `pos_stores.allowed_payment_methods` to include them (API-only today, no store-settings UI field for this specific array — see the Known Non-Visual Limitations section).
4. **Accounting posting (F305)**: requires a company that has run Accounting's own foundation setup (`initializeAccountingCompany`, normally triggered by enabling the Accounting module for a company) plus, for card/UPI tender and inventory relief specifically, two new account-mapping rows (`pos_card_clearing`/`pos_upi_clearing`/`pos_wallet_clearing`/`pos_store_credit_liability`/`inventory`/`pos_loyalty_liability`/`pos_loyalty_program_expense`) configured through Accounting's existing generic mapping API — cash/bank/revenue/tax/rounding/COGS work with zero extra configuration.

## Screens

### `/pos` — Overview
Shift open/close, dashboard, cash paid-in/paid-out. Desktop-first, also used as a landing page after login into the POS module.

### `/pos/checkout` — Checkout (the primary, highest-frequency screen)
Product search/scan, cart lines with quantity/discount controls, customer select, coupon/cart-discount, loyalty balance + redeem, tender (cash/card/split), held-cart dialog, offline-mode fallback panel. **Kiosk/touch-first is the primary use case** — test at a touch-first tablet width (768–1024px landscape) as the priority viewport, not just desktop. Test the offline banner/panel by simulating `navigator.onLine=false` in devtools.

### `/pos/stores`, `/pos/terminals`, `/pos/cashiers` — Store/terminal/cashier administration
Standard list/create/edit admin screens. Desktop-first (back-office use).

### `/pos/promotions`, `/pos/coupons` — Promotion/coupon administration
List/create/edit/activate-deactivate. **Known gap**: item/item-group/customer eligibility is set via raw ID arrays, not a search-picker (no item/item-group search-select component exists anywhere in the app yet) — this is a genuine, disclosed functional gap, not a visual one; flag it but don't spend visual-polish time on the raw-ID-array fields themselves.

### `/pos/loyalty` — Loyalty program + customer balance/ledger
Program configuration (gated by `pos.loyalty.manage`) and a real customer balance/ledger lookup (open to any authenticated POS user). Two-panel layout; check both the config-visible (manager) and config-hidden (cashier) states.

### `/pos/returns` — Returns/refunds
Search by receipt number, select returnable lines/quantities, approve, complete. Includes the "Exchange" hand-off action that routes to `/pos/checkout?exchangeReturnId=`.

### `/pos/receipts/[saleId]` — Receipt (+ invoice generation)
Print-optimized layout (`print:` Tailwind variants throughout — test both screen AND print-preview rendering). The new F290 "Generate invoice" panel sits below the receipt body, hidden in print (`print:hidden`) since it's an on-screen action, not part of the printed document. Three states to check: no customer attached (button disabled, explanatory text), customer attached with no invoice yet (button enabled), invoice already generated (invoice number/status/total shown instead of the button).

### `/pos/invoices` — Invoice ledger (new, F290)
A flat, searchable-by-nothing-yet list (no filters in the UI beyond what the API already supports — `storeId`/`customerId` query params exist server-side but have no picker in this screen). Each row links to that sale's receipt (where the invoice detail actually lives). Visual QA candidate: consider whether this screen needs its own filter UI, or whether linking out to the receipt is sufficient — a product decision, not something to silently "fix" during visual QA.

### `/pos/reports/day-end` and `/pos/reports/day-end/[id]` — Day-end (Z) reports
List + detail. The detail screen is print-optimized (Z report itself is a printable document) and now also hosts the F304 reconciliation panel and F305 accounting-posting panel (both `print:hidden`, both real actions with real API calls — not placeholders). Check the workflow button states across all four statuses (draft/reviewed/closed/void) and confirm the "different person must finalize" messaging reads correctly.

### `/pos/reconciliation` — Payment reconciliation (new, F304)
Settlement-evidence import form (manager/supervisor only) + a cross-report exception queue defaulting to the `variance` filter. The resolve action reveals an inline notes field + confirm button. Test the empty state (no exceptions) and a populated exception with a long resolution-notes string for text wrapping.

### `/pos/accounting` — Accounting posting queue (new, F305)
A flat retry queue, filterable by status. Each row shows the real posting-failure error message inline when present (can be a fairly long, technical Accounting error string — e.g. "Account mapping pos_card_clearing is not configured." — check text truncation/wrapping behavior for long messages).

### `/pos/analytics` — Analytics (new, F307)
Date-range + store filter, then a long vertical stack of metric sections (summary/store/terminal/cashier/product/tender/discounts/returns/cash-variance/reconciliation/offline/accounting-posting/loyalty/margin). This is the single largest screen in the module by content volume — the primary visual QA target for information density, section spacing, and whether some sections should collapse/tab instead of stacking. The `margin` section only renders when at least one sold line has a traceable cost (a linked stock movement) — test both with and without tracked-inventory items in the date range.

### `/pos/offline-sync-conflicts` — Offline sync conflicts (F297/298)
List of conflicts with resolve actions. Unaffected by this session's work.

## Responsive/device coverage expected

- **Checkout**: touch-first tablet (primary), desktop (secondary). Not designed for phone-width.
- **Receipts/Z-reports**: screen + print preview, both matter equally.
- **Everything else (admin/back-office screens)**: desktop-first; verify they don't visually break below ~1024px, but touch/phone optimization was never a design goal for back-office screens, matching CRM's own convention.

## Accessibility

No screen in this session's additions does anything CRM's own equivalent screens don't already do (same design-system primitives: `Button`, `Select`, `TextField`, `TextArea`, `NumberField`, `StatusBadge`, `ErrorState`). No new accessibility patterns were introduced; if CRM's existing screens pass a given accessibility bar, POS's new screens should too — but neither has had a dedicated accessibility audit, which is explicitly in scope for the visual QA pass.

## Known non-visual limitations (do not "fix" as a visual bug — see `POS_FINAL_FUNCTIONAL_VERIFICATION.md`)

- No item/item-group/customer picker on promotion/coupon eligibility fields (raw ID arrays).
- No terminal-level cashier eligibility (store-level only).
- No UI for configuring `pos_stores.allowed_payment_methods` or Accounting account mappings — both API-only today.
- No live card/UPI payment provider (sandbox only) — a card/UPI checkout flow will only ever show the sandbox's own deterministic outcomes.
- The `/pos/invoices` list has no in-screen filter UI (server supports `storeId`/`customerId` filters; no picker built).

## What "done" means for this handoff

Every screen listed above renders real data through a real, tested API — none is a placeholder, none silently no-ops on submit. A visual QA pass should be evaluating polish, consistency, responsiveness and accessibility, not discovering that a button doesn't work.
