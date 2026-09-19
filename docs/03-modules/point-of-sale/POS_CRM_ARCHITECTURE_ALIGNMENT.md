# POS ↔ CRM Architecture Alignment

This document records how the POS module's structure follows CRM's own established architectural conventions, where it reuses shared platform/cross-module infrastructure instead of duplicating it, and where a deliberate, disclosed difference exists.

## 1. Capability-directory backend structure

CRM's backend (`services/api/src/modules/crm/`) is organized into named capability directories matching `docs/02-register/CAPABILITY_REGISTER.csv` rows, with a pure named-export barrel `index.js` (no `export *`) as the module's only public surface.

POS mirrors this exactly:

```
services/api/src/modules/point-of-sale/
  shared/                                    # cross-cutting: errors, access-control, audit, resource-registry, accounting-bridge
  store-terminal-and-cashier-control/        # POS-CAP-001 (F268-F271)
  assortment-pricing-customer-and-cart/      # POS-CAP-002 (F272-F281)
  tender-and-payment-execution/              # POS-CAP-003 (F282-F286)
  transaction-continuity-and-documents/      # POS-CAP-004 (F287-F290)
  returns-refunds-and-exchanges/             # POS-CAP-005 (F291-F293)
  inventory-and-offline-continuity/          # POS-CAP-006 (F294-F298)
  cash-shift-day-end-and-reconciliation/     # POS-CAP-007 (F299-F305)
  pos-analytics/                             # POS-CAP-009 (F307)
  index.js                                   # pure named-export barrel, grouped by capability
  index.d.ts
```

(POS-CAP-008, Loyalty/F306, lives inside `assortment-pricing-customer-and-cart/loyalty.js` rather than its own directory — a deliberate exception recorded in the F306 merge commit `f1967b83`: redemption is itself a pre-tax cart discount, so it sits alongside cart pricing rather than in an isolated folder for one feature.)

Every capability file exports only named functions; `index.js` re-exports them grouped by `POS-CAP-00x` with a header comment identical in spirit to CRM's own barrel. No file does `export *` from a capability directory into the public barrel — every public function is named explicitly, so the barrel itself is the auditable contract.

## 2. Frontend feature-folder structure

CRM's frontend (`apps/web/src/features/crm/<object>/{api,components,screens}`) pairs one feature folder per business object. POS mirrors this per capability:

```
apps/web/src/features/pos/
  shared/            # http.ts, format.ts, pos-context.ts — cross-cutting only
  stores/ terminals/ cashiers/
  overview/ checkout/ promotions/ coupons/ loyalty/
  returns/ receipts/ invoices/
  offline/ day-end-reports/ reconciliation/ accounting/ analytics/
```

Each folder's `api/*.ts` wraps the shared `request`/`post`/`del` helpers (`shared/http.ts`) the same way CRM's per-object api files each wrap a shared request helper rather than hand-rolling `fetch`. Each `screens/*.tsx` is a real, functional screen — no capability ships an API-only backend with no UI, matching the mega-prompt's own "no requirement is complete without UI" standard.

## 3. Public cross-module contracts, not private-table reach-through

POS never writes to another module's private tables. Every cross-module effect goes through that module's own public `index.js` barrel, imported directly (verified by `pnpm verify:architecture`'s "public cross-module API contracts" check):

| POS needs | Calls | Not |
|---|---|---|
| Stock movement (sale, return, exchange) | `postStockMovement` from `stock/index.js` | A private POS-owned stock ledger |
| Tax/discount calculation | `services/api/src/core/tax-engine.js` (shared with Sales) | A second, POS-only tax engine |
| Customer master | `tenant.business_parties` (owned by CRM) | A forked POS customer table |
| Invoice document (F290) | `createCustomerInvoice`/`submitSubledgerDocument`/`postCustomerInvoice` from `accounting/index.js` | A POS-owned invoice table |
| General ledger posting (F305) | `createJournalEntry`/`postJournalEntry`/`getAccountMapping` from `accounting/index.js` | A POS-owned ledger |
| Approvals (discount, reconciliation, day-end finalize) | `public.approval_requests` + `COMMAND_DISPATCH` (`core/approvals.js`) | A parallel POS-only approval table |
| Idempotency | `core/idempotency.js`'s `beginIdempotentOperation`/`completeIdempotentOperation` (shared with every other module) | A bespoke POS retry-key scheme |
| Document numbering | `core/document-numbering.js`'s `nextDocumentNumber` (F303/F304) or Accounting's own `allocateNumber` (F290, matching `accounting_customer_invoices.invoice_number`'s own convention) | An invented numbering scheme |

This session's F290/F305 work required one genuine, minimal extension to Accounting's own contract rather than a workaround: `submitSubledgerDocument`/`postCustomerInvoice` gained the same `options.internal = true` bypass `createJournalEntry`/`postJournalEntry`/`createCustomerInvoice` already had, so a trusted system caller can move a document through Accounting's lifecycle without requiring the acting POS user to hold Accounting-module permissions. This mirrors the existing precedent exactly rather than inventing a new one, and is documented in both files' own code comments.

## 4. Security and audit conventions

- **Row-Level Security**: every new tenant table (`pos_settlement_batches`, `pos_settlement_entries`, `pos_reconciliation_corrections`) is `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY` with the identical `organization_id=tenant.current_organization_id()` policy every other tenant table uses — copied via the same `DO $$ ... FOREACH table_name ...` idiom migration 048 established.
- **Store-scoping**: every new domain function calls `assertPosStoreAccess`/`accessiblePosStoreIds` (`shared/access-control.js`), the same permissive-until-configured boundary every existing POS capability already enforces — never a second, parallel access model.
- **Maker-checker / SoD**: F304's `pos.reconciliation.manage` vs `pos.reconciliation.approve` blocking conflict (`packages/permissions/src/roles.js`) is structurally identical to F303's `pos.report.generate` vs `pos.report.finalize` conflict, which is itself structurally identical to F279's `pos.discount.apply` vs `pos.discount.approve` conflict — one established pattern, applied a third time, not three different patterns.
- **Immutability**: `pos_reconciliation_protect_resolved()` (migration 127) is modeled line-for-line on `pos_day_end_report_protect_closed()` (migration 121), itself modeled on `tenant.accounting_protect_posted_subledger_document()` (migration 011) — the same "once a financially-relevant record reaches its terminal state, only a linked correction row may follow" idiom used at every layer of the stack, not reinvented per feature.
- **Idempotency + audit**: F290/F304/F305 all use `beginIdempotentOperation`/`completeIdempotentOperation` for request-level idempotency and the shared `event()` writer (`shared/audit.js` → `tenant.pos_events`) for every state transition, identical to every prior POS capability.

## 5. No duplicate business logic

- Revenue/tax/rounding/COGS accounting mapping keys (`revenue`, `output_tax`, `rounding`, `cogs`) are the SAME keys Sales' own `postCustomerInvoice` already resolves via `getAccountMapping` — F305 does not invent parallel POS-specific revenue/tax accounts; an org's chart of accounts is one chart, shared across sales channels.
- F304's cash-reconciliation figures are read directly from F303's own already-computed `expected_cash_total`/`counted_cash_total`/`cash_variance_total` — never recomputed independently.
- F307's analytics aggregates read the exact same tables and status filters F303's Z-report and F304's reconciliation already treat as authoritative (`pos_sales.status IN ('completed','partially_returned','returned')`, etc.) — one definition of "a completed sale," not a second one living inside the analytics query.
- F290's invoice-line construction is validated (`assertLinesReconcileToSale`) against the SAME sale-header totals `completePosCart`/`completePointOfSale` already computed and persisted — never a second, independent pricing pass.

## 6. Where POS intentionally differs from CRM, and why

- **Loyalty (POS-CAP-008) has no dedicated capability directory.** CRM has no equivalent "cross-cutting discount mechanism" concept; POS's loyalty redemption is architecturally a cart-pricing concern (pre-tax discount), so it was placed with `cart-pricing.js`/`cart.js` rather than isolated. Disclosed in the F306 merge commit, not silently deviating from convention.
- **F305 posts through Accounting's journal contract directly, not through a subledger document.** CRM has no analog (CRM never posts financial entries). Sales' own `postCustomerInvoice` posts through the `accounting_customer_invoices` subledger because a Sales invoice is itself a real AR document with its own lifecycle (draft/approved/posted/paid). A POS SALE is not naturally an AR subledger document — it is an already-paid till transaction — so F305 posts a journal entry directly (mirroring `postVendorBill`'s own direct-journal pattern for the exact same reason: a vendor bill's underlying event, once matched, needs a GL entry, not a second interactive document lifecycle on top of the one Procurement's matching record already has).

## 7. Session 6 additions (F275, F289, F301, F302 gap closure)

All four fixes followed the conventions above without exception, not as new patterns:

- **F275 customer pricing**: reuses `tenant.sales_pricing_rules`, Sales' own table (§3's "Not a forked table" rule applied to pricing specifically, extending the existing "Tax/discount calculation" row).
- **F289 print evidence**: `tenant.pos_receipt_print_events` (migration 129) follows §4's RLS/immutability idiom exactly — `ENABLE/FORCE ROW LEVEL SECURITY` + the same organization-isolation policy, and a `BEFORE UPDATE OR DELETE` trigger modeled on the same lineage `pos_reconciliation_protect_resolved()`/`pos_day_end_report_protect_closed()` already established.
- **F301 shift-open idempotency**: `beginIdempotentOperation`/`completeIdempotentOperation` (§3/§4's shared idempotency contract), the exact same primitive `recordPosCashMovement` already used — not a new mechanism.
- **F302 decimal arithmetic**: `core/decimal.js`'s fixed-point utilities (§4's own standing "never native Number arithmetic for money" rule, applied to a function that had been missed).
