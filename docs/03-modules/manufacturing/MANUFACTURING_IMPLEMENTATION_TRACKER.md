# Manufacturing implementation tracker

Status of the Manufacturing module (features F145–F192, numbered as in `docs/03-modules/manufacturing/features/`)
against real evidence. "Verified" means exercised by a test on real PostgreSQL and/or a real-browser journey
with real role permissions — not "code exists".

**This is not a completion claim.** The acceptance register was not re-audited row by row. What follows is what
was built and proven, and — equally important — what is still open.

## How it was verified

| Layer | Evidence |
|---|---|
| Domain on real Postgres (RLS on, role permission sets, no owner bypass; Stock, Assets and Sales rows are real) | `tests/integration/manufacturing-{engineering,routing,shopfloor,planning,execution,costing}.test.mjs` |
| Regression of every module that shares stock | Manufacturing + Inventory + Procurement + Sales + POS integration suites run together: 328 pass, 0 fail |
| Real browser, real personas (`manufacturing_manager` ×2 so a second person can approve, `quality_manager` as view-only) | `apps/web/e2e/manufacturing-{engineering,process,production,planning,execution,insights}.spec.ts` |
| Real ledger | the production journey reads `tenant.stock_balances` directly: components consumed, finished goods received |
| Static gates | route-security matrix (0 gaps), billing gate, eslint, tsc |

**Browser-suite caveat (open):** the six Manufacturing specs each pass when run on their own, but run back-to-back
against one shared seeded world, 3 of 6 fail (production: duplicate stock-balance seed insert; engineering: two ECN
rows match one locator; insights: yield aggregates other specs' orders). These are test-isolation defects in the specs
(they need a fresh world per spec), not product defects, and are **not yet fixed**.

## Defects found by running against a real database / browser (and fixed)

1. **The existing `postProduction` issued every material and received finished goods in one call**, with no
   reservation, no partial issue, no WIP cost and no batch/serial handling. Production is now a proper flow
   (reserve → issue/backflush → report → absorb WIP into finished-goods cost); the old function is left in place, unused by the UI.
2. **Components sitting in a bin could not be issued or reserved** (stock is held per location/batch; a request with
   no location found nothing). Manufacturing now allocates across the balances that hold the stock.
3. **A `pg` `date` column comes back as a local-midnight JS Date**, shifting planning dates by a day across
   time zones; all planning dates are read as text.
4. **`logTime` failed on a text-typed numeric parameter** (found by the integration test).
5. **MRP horizon was silently capped at a year** and a test order fell outside it (test assumption, made explicit).
6. Browser findings on UI locators only (dependent dropdown retries, ambiguous number-field labels).

## Feature status

Legend: **Built+verified** · **Partial** (works, with named gaps) · **Not built**

| ID | Feature | Status | Notes / open gaps |
|---|---|---|---|
| F145 | Bill of materials | Built+verified | Create/edit draft, submit, approve by a *different* person, send back with reason, obsolete (refused while open orders use it). Components with quantity, scrap %, issue method. |
| F146 | Multi-level BOM | Built+verified | Explosion to any depth (12 levels max) with scrap allowance; circular structures refused; where-used across levels. Explosion uses each sub-assembly's default active BOM on a date. |
| F147 | BOM versions | Built+verified | New version = copy → edit → approve; the old version is retired but kept; effectivity dates decide which applies. |
| F148 | BOM revisions | Built+verified | Revision label and note per version, supersedes link, one revision in progress at a time. |
| F149 | Alternate BOM | Partial | Alternate structures per product (coexist with the default; a work order can be created from one) and substitute components with a ratio. **Substitutes are recorded but not offered or applied at issue time**, and MRP ignores them. |
| F150 | Routings | Built+verified | Versioned like a BOM; one default per product; operations with sequence, work center, setup/run/queue/move minutes, inspection flag, subcontract flag. |
| F151 | Operations | Built+verified | Copied onto each order with planned minutes; run in sequence; skip needs a reason. |
| F152 | Work centres | Built+verified | Type, status (maintenance/inactive), calendar, machines, efficiency, cost rates (rates hidden without costing.view), asset link. |
| F153 | Machine / work-centre capacity | Built+verified | Daily minutes = shifts × machines × efficiency, less closures, weekends, maintenance; load from open orders; overload flagged. **Capacity is per work center, not per individual machine.** |
| F154 | Shift calendars | Built+verified | Working weekdays, non-overlapping shifts with breaks, holidays/closures/extra days. |
| F155 | Manufacturing orders | Built+verified | Production orders from an active BOM; default routing; snapshot of the BOM; release/cancel/close-short. |
| F156 | Work orders | Built+verified | Same object (Manufacturing calls it both). Status flow planned → released → in progress → completed, with hold. |
| F157 | Job cards | Built+verified | Shop-floor queue by priority; start/complete an operation with actual minutes; next operation opens. **No barcode/tablet kiosk mode.** |
| F158 | Production planning | Partial | MRP recommendations convert to production orders (once, idempotent). **Nothing is scheduled to run automatically; no lot-sizing rules or planning-horizon fences.** |
| F159 | MRP | Built+verified | Level-by-level netting with low-level codes; demand = open orders' components + confirmed sales lines + reorder minimum/safety stock; supply = usable stock + open orders' output + open purchase lines. Purchase recommendations are **not raised in Procurement** from here. No forecast demand. |
| F160 | Material requirements | Built+verified | Per-item gross/supply/net with pegging to what drives it. |
| F161 | Material availability | Built+verified | What-if for any product/quantity across all levels; makeable-from-stock quantity. |
| F162 | Raw-material reservations | Built+verified | Release reserves components across balances; a shortage blocks release unless accepted; reservations shrink on issue and free on close/cancel. |
| F163 | Material issue | Built+verified | Manual issue (cannot exceed requirement), issue from any bin/batch, idempotent. |
| F164 | Material consumption | Built+verified | Issues, returns (at issue cost, with reason) and scrap as a register; extra usage is recorded as scrap/waste. |
| F165 | Backflushing | Built+verified | Per-component or company-wide; consumed proportionally when output is reported; manual materials must already be issued. |
| F166 | Work in progress | Built+verified | WIP cost per order (material + labour + machine + subcontract − absorbed). **WIP is a cost ledger on the order; there is no WIP stock balance/warehouse and no Accounting journal.** |
| F167 | Finished goods receipt | Built+verified | Receipt at the cost absorbed from WIP; partial receipts; overproduction control; completes the order and writes a cost snapshot. |
| F168 | Production scheduling | Built+verified | Finite-capacity forward scheduling (priority order, operation sequence, daily capacity), preview then apply, late and blocked orders flagged; original date kept as the due date. **No drag-and-drop Gantt, no backward scheduling.** |
| F169 | Labor time | Built+verified | Time entries (timer or minutes) costed at the work center's hourly rate; operator label. **Not linked to HR employees/payroll.** |
| F170 | Machine time | Built+verified | Machine entries costed at the overhead (machine-hour) rate. |
| F171 | Setup time | Built+verified | Setup entries costed like labour; logged time replaces the estimated cost at completion (no double count). |
| F172 | Scrap | Built+verified | Product scrap and component scrap with coded reason; scrap cost tracked. |
| F173 | Waste | Built+verified | Same mechanism with a waste category; component waste consumes stock. |
| F174 | By-products / co-products | Built+verified | Defined per BOM with quantity and cost share; received with the main product, taking their share of cost. |
| F175 | Rework | Built+verified | Scrapped units go to a rework order (own routing run, no new material). **No rework cost roll-up back to the parent.** |
| F176 | Batch manufacturing | Built+verified | Batch-tracked products need a batch number (created on the fly, with expiry); stock lands in that batch. **No batch genealogy of consumed component batches.** |
| F177 | Serial tracking | Built+verified | Serial-tracked output needs exactly one serial per unit, registered atomically with the stock. **Serial components are refused** (not supported on a BOM). |
| F178 | Make-to-stock | Built+verified | Default demand type; MRP-created orders are make-to-stock. |
| F179 | Make-to-order | Built+verified | Order tied to a live Sales order; goods produced are reserved for that order. **Sales fulfilment counters are not updated.** |
| F180 | Subcontract manufacturing | Partial | Send an operation out with material, receive back with a cost that joins WIP. Subcontractor is a **free-text label**, not a Procurement supplier/PO; the existing Procurement subcontract register is separate. |
| F181 | Production quality inspections | Partial | In-process inspections per operation; an operation flagged "inspection required" cannot complete without a passing one; a failure can scrap units or hold the order. **Not linked to the Quality module's inspection records or holds.** |
| F182 | Production hold | Built+verified | Hold with reason, blocks issue/output/starting work, resume restores the prior status. |
| F183 | Production costing | Built+verified | Actual cost per order/unit and a period cost report (cost needs costing.view). |
| F184 | Standard vs actual costing | Built+verified | Standard is *computed* from the current BOM, routing, item standard costs (or stock average) and work center rates; compared with actual. **Standard is not stored per order or period.** |
| F185 | Cost variance | Built+verified | Material price and usage, labour, overhead per order, adding up to the total. Variance is not posted to Accounting. |
| F186 | Yield analysis | Built+verified | Good ÷ (good + scrapped), attainment against plan, scrap reasons. |
| F187 | Production efficiency | Built+verified | OEE per work center: availability × performance × quality (up to 60 days). Quality is order-level, not per operation. |
| F188 | Downtime | Built+verified | Log/end with coded reason and planned/unplanned; can take the work center out of service (removing its capacity); Pareto summary in the domain. **The Pareto is not shown on its own screen** (only the register). |
| F189 | Maintenance integration | Partial | A breakdown can raise a real corrective maintenance order on the work center's linked asset in Assets. **One-way: maintenance completion does not restore the work center, and there is no maintenance-driven capacity block.** |
| F190 | Engineering change control | Built+verified | Propose against an active BOM → submit → decided by someone other than the requester → implement into a new active version; open orders keep their BOM. |
| F191 | Production reports | Partial | Production summary, cost, variance, yield, efficiency, WIP, scrap, consumption, output, capacity — each a live view with CSV export. **No scheduled/emailed reports, no charts.** |
| F192 | Production dashboard | Partial | Live order counts by state, late/held/shortage orders, floor load, open downtime, 30-day yield, last MRP, WIP value for permitted roles. No trends. |

## Known limits of this work

- Stock effects go through Stock's own functions (idempotent, RLS-scoped) with a narrow elevated context created **after**
  the caller's Manufacturing permission is checked; there is no Manufacturing-owned stock write.
- No Accounting journals are posted for WIP, variances, scrap or subcontract cost.
- The old `createWorkOrder` / `releaseWorkOrder` / `postProduction` functions remain exported but the UI does not use them.
- Costing depends on Inventory's costing method for the cost of material issued (FIFO / moving average / standard).
- Accessibility and visual-regression gates were not run beyond the browser journeys. Registers fetch up to 250–500 rows per view.
- Only work-center rates and item standard costs drive standard cost; there is no cost-roll-up run that freezes a standard.
