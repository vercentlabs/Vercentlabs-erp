# Inventory implementation tracker

Status of the Inventory (stock) module, features F097–F144 as numbered in `docs/03-modules/stock/features/`,
against real evidence. "Verified" means exercised by a test on real PostgreSQL and/or a real-browser journey with
real role permissions — not "code exists".

**This is not a completion claim.** The acceptance register was not re-audited row by row. What follows is what was
built and proven, and — equally important — what is still open.

## How it was verified

| Layer | Evidence |
|---|---|
| Domain on real Postgres (RLS on, role permission sets, no owner bypass) | `tests/integration/inventory-{stock-foundation,counts,valuation,exceptions,outbound}.test.mjs` |
| Regression of every module that posts stock | POS, Sales, Procurement and Inventory integration suites re-run together after the costing change (268 pass at that point; Inventory suites grew afterwards) |
| Real browser, real personas (`inventory_manager` ×2, `pos_supervisor` issue-only, `pos_cashier` view-only) | `apps/web/e2e/inventory-{foundation,counts,valuation,outbound}.spec.ts` |
| Static gates | route-security matrix (0 gaps), billing gate, eslint, tsc |

## Defects found by running against a real database / browser (and fixed)

1. **Layers were never drawn down.** `stock_valuation_layers.remaining_quantity` was written but never consumed, so
   FIFO could not exist and "remaining" was meaningless (this also broke landed-cost apportionment). Every issue now
   consumes layers oldest-first; surplus left by history is retired from the oldest end before the first FIFO issue.
2. **A pick line with no location reserved a bin but shipped from "no location"** and failed with "Insufficient
   available stock". Lines now adopt the location/batch the reservation landed on.
3. **"Insufficient available stock" was misleading when the stock existed in another bin.** The message now says the
   warehouse holds enough elsewhere and to choose the location/batch.
4. **Reorder rules ignored safety stock** and had no suggested quantity; the trigger is now minimum + safety and the
   suggestion is order-up-to when a maximum is set.
5. **Cost leaked to view-only users** through balances, ledger, item rows and the dashboard; cost is now stripped
   server-side without `stock.valuation.view`.
6. React hook called after an early return in the shared register (found by eslint).

## Feature status

Legend: **Built+verified** · **Partial** (works, with named gaps) · **Not built**

| ID | Feature | Status | Notes / open gaps |
|---|---|---|---|
| F097 | Item master | Built+verified | Create/edit/deactivate over the business-data engine; tracking, valuation, barcode, prices. Identity fields (tracking, unit, valuation method) are locked once an item has movements. Open: item images/attachments, bulk import UI. |
| F098 | Item categories | Built+verified | Nested categories. Open: category-level defaults (valuation, tracking). |
| F099 | SKUs | Partial | SKU + barcode live on variants; scan resolves them. Open: SKU generation rules. |
| F100 | Variants | Partial | Variant register (SKU, barcode, prices). **Stock is not variant-keyed**: balances and movements are per item, so per-variant stock is not tracked. |
| F101 | Multiple units of measure | Built+verified | Unit register with decimals/category. |
| F102 | UOM conversions | Partial | Per-item conversion register. **Movements are not converted** — quantities are posted in the item's own unit. |
| F103 | Warehouses | Built+verified | Register with type and negative-stock flag. Active-branch scoping depends on the engine. |
| F104 | Locations and bins | Built+verified | Hierarchy (zone/aisle/rack/bin/quality/…), capacity recorded. Open: capacity is not enforced. |
| F105 | Multi-warehouse inventory | Built+verified | Balances, transfers and reports across warehouses. |
| F106 | Real-time stock balance | Built+verified | Availability screen; balance updated in the same transaction as the ledger. |
| F107 | Stock ledger | Built+verified | Append-only, filterable by type, CSV export. |
| F108 | Goods receipts | Built+verified | Manual receipts here; Procurement receipts post through the same function. |
| F109 | Goods issues | Built+verified | Manual issues; serial items issue from the Serial numbers screen. |
| F110 | Internal transfers | Built+verified | Draft → complete moves stock. Open: no in-transit state and no cancel (schema allows them, no function). |
| F111 | Stock adjustments | Built+verified | Direction, reason required. |
| F112 | Reservations | Built+verified | Manual holds, release; pick lists reserve. Sales/POS reserve through the domain. |
| F113 | Available stock | Built+verified | On hand − reserved − quality-held. |
| F114 | Available to promise | Partial | Domain computes it (quality-adjusted); the screens show available, **no incoming-supply ATP**. |
| F115 | Batch tracking | Built+verified | Create, block/unblock/expire with reason, enforced on issue. |
| F116 | Lot tracking | Built+verified | Same register (batch = lot). |
| F117 | Serial tracking | Built+verified | Receive registers serials + stock atomically; issue per serial. Serial items are excluded from counts and pick lists. |
| F118 | Expiry dates | Built+verified | Expiry screen with windows; block/expire actions. Open: **no automatic expiry sweep** (a batch does not flip to expired by itself). |
| F119 | Barcode scanning | Partial | Scan/lookup by item/variant/batch/serial code. **No camera / hardware scanner integration.** |
| F120 | Cycle counting | Built+verified | Snapshot → count → submit → different person approves → variances post. Blind mode, reasons, freeze option. |
| F121 | Physical inventory | Built+verified | Whole-warehouse count, warehouse frozen by default. Open: the delta is applied to the snapshot, so a non-frozen count assumes intervening movements were legitimate. |
| F122 | Reorder point | Built+verified | Rule register (upsert per item+warehouse). |
| F123 | Min/max stock | Built+verified | Maximum makes the suggestion order-up-to. |
| F124 | Safety stock | Built+verified | Trigger is minimum + safety. |
| F125 | Automatic replenishment | Partial | Replenishment screen lists candidates and links to Procurement planning, which raises the request/PO. **Nothing runs on a schedule**; no consolidation. |
| F126 | Negative stock control | Built+verified | Company, item and warehouse flags; blocked with a clear error. |
| F127 | FIFO valuation | Built+verified | Issues consume oldest layers per item+warehouse. Layers are per warehouse, not per location/batch. |
| F128 | Weighted moving average | Built+verified | Default method. |
| F129 | Standard costing | Built+verified | Carried at standard; receipt price variance recorded per movement and reported. Variance is not posted to Accounting. |
| F130 | Inventory valuation | Built+verified | By item/warehouse/method; FIFO value from layers. **No period-end snapshot / GL reconciliation.** |
| F131 | Landed cost allocation | Built+verified | Allocates a Procurement landed cost across the receipt's movements (value or quantity); capitalises only stock still on hand, the rest goes to cost of sales; idempotent; standard-costed items book variance. Open: **no journal is posted to Accounting**; "weight"/"manual" methods fall back to value. |
| F132 | Stock aging | Built+verified | Age buckets from layers. |
| F133 | Slow-moving inventory | Built+verified | Threshold parameter (default 90 days without an issue). |
| F134 | Dead stock reporting | Built+verified | Threshold parameter (default 180 days without any movement). |
| F135 | Picking | Built+verified | Pick list reserves stock, short picks with reasons free the difference. **Not created from Sales orders**: lines are entered by hand (up to 3 in the dialog) with a free reference label. |
| F136 | Packing | Built+verified | Packages with weights; cannot pack more than picked. Open: no dimensions, labels or box types. |
| F137 | Shipping | Partial | Ship consumes the reservation and issues stock once. **Not linked to Sales fulfilment**: Sales fulfilled-quantity counters are not updated, and no carrier integration / label. |
| F138 | Returns | Partial | Customer returns recorded (good → restock, damaged → quarantine location only). POS and supplier returns appear from their modules. **No return authorisation / credit-note linkage.** |
| F139 | Damaged stock | Built+verified | Write-off with cause and reason; reported. Open: no approval threshold, no salvage/recovery. |
| F140 | Quarantine / quality-held | Partial | Screen lists active Quality holds and stock in quality-type locations. Holds are placed/released in the Quality module; **Inventory has no action to place one**. |
| F141 | Batch/serial traceability | Built+verified | Genealogy: receipt → every movement → what is left → holds. Movements carry the source document type and id; **the sales customer is not resolved** (reference id only). |
| F142 | Movement history | Built+verified | Ledger + per-item movement summary over a period, with cost variance. |
| F143 | Stock reports | Partial | Availability, ledger, valuation, aging, movement, expiry, replenishment, counts, landed cost — each exportable to CSV. **No scheduled/emailed reports, no charts.** |
| F144 | Inventory dashboard | Partial | Live counters (stocked items, units, reserved, warehouses, below reorder point, value for permitted roles) and scan box. No trend charts or alerts. |

## Known limits of this work

- Costing is per **item + warehouse**, not per location or batch. Changing a company's costing method affects later
  movements only; nothing is revalued retroactively.
- FIFO layers created before this work were never drawn down; the first FIFO issue retires the surplus from the
  oldest end (correct for FIFO), but historical cost-of-goods figures were not restated.
- Cross-module hand-offs stop at the boundary: no Accounting journals for adjustments, write-offs, variances or landed
  cost; no Sales-order-driven picking.
- Accessibility and visual-regression gates were not run beyond the browser journeys. Registers fetch up to 250–500
  rows per view.
- Cost fields on the item form are visible to anyone with `items.manage` (the server strips *reading* cost without
  `stock.valuation.view`, but does not block *editing* it).
- The `stock.count.self_approve` permission is honoured by the domain but is not seeded to any role.
