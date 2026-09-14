# F079 Supplier price lists — Atomic requirement trace

Dossier: effective-dated supplier-item/uom/quantity/currency purchase
prices with deterministic precedence, import/audit support. Lifecycle:
`PLANNED/FUTURE -> ACTIVE -> EXPIRED/INACTIVE; overlapping rules explicitly
resolved`.

`upsertSupplierPurchasePrice` (`pass1-operations.js:34-51`) is the real
implementation — a distinct, non-generic function (not the generic
document/child engine), backed by `tenant.procurement_supplier_prices`.
Real UI: `pass1-operations-workspace.tsx`'s `upsert-supplier-price` action
(supplier/item/UOM pickers, minimum quantity, rate, currency, valid-from/to).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS | Real, permission-gated (`procurement.catalog.manage`) upsert with genuine cross-entity validation: supplier and item must belong to the same company (`PROCUREMENT_SUPPLIER_PRICE_COMPANY_MISMATCH`), UOM must be active if specified, currency must be a 3-letter code, `validFrom <= validTo` enforced. Working create/edit UI. |
| **CAP-002 — quantity-break pricing.** | PASS (partial) | `minimumQuantity` is a real field and part of the upsert's uniqueness key (`WHERE ... AND minimum_quantity=$5 AND valid_from=$6 ... FOR UPDATE`) — multiple price tiers for the same supplier/item at different minimum quantities are structurally supported. Not independently verified that the *purchase-order line pricing* path actually looks up and applies this table when building a PO line (checked `normalizeDocument`'s `purchase-orders` case: line pricing is caller-supplied `unitPrice`, not auto-populated from `procurement_supplier_prices`) — **this is a real, confirmed gap**: the price list exists and can be maintained, but nothing in PO creation actually consults it to default a line's price. |
| **CAP-002 — overlap resolution / precedence.** | PARTIAL | The upsert key (`supplier_id, item_id, uom_id, minimum_quantity, valid_from`) prevents exact-duplicate rows via `FOR UPDATE` + update-in-place, but there's no explicit precedence rule enforced for genuinely overlapping date ranges at different quantity breaks (e.g., two rows with overlapping `[validFrom,validTo]` windows and different `minimumQuantity` values are both allowed to coexist with no deterministic "which one wins" rule surfaced anywhere). |
| VAL-001/002 | PASS | Strong field-level validation as described above. |
| SEC-001 | PASS | Company-scoped via the supplier/item's own company. |
| **IMPORT-EXPORT.** | GAP | No bulk-import path for price lists was found (matches the dossier's own import/audit-support ask). |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

Price-list maintenance itself is real, validated, and usable through a
working UI. The most material gap is that **PO line pricing doesn't
actually consult this table** — a buyer creating a PO still types in the
unit price manually every time, with no auto-population from the
supplier's own maintained price list. That disconnect undermines the
feature's practical value even though the data layer is correct.
