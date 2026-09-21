# Assets: implementation tracker (F231-F267)

Status legend: **Verified** = exercised by a real-PostgreSQL integration test written this pass and/or a browser
spec; **Built, untested** = code exists and is wired but has no test of its own; **Partial** = works with a stated
limit; **Not built** = absent. This is a status record, not a completion claim.

## What existed and what this pass added

Before this pass Assets was a 470-line thin domain (`index.js`: float arithmetic, one-step capitalize and dispose,
no depreciation engine, no transfer or verification logic, no Accounting handoff) plus a placeholder page. That file
is untouched. This pass added, in `services/api/src/modules/assets/`:

| File | Scope |
|------|-------|
| `register.js` | settings, categories, locations tree, asset master + tag codes, documents, creation from a supplier-bill line, capitalisation |
| `custody.js` | assignment / return, transfer workflow (request, approve, reject, cancel, complete), movement history |
| `value.js` | straight-line / declining-balance / units-of-production maths in integer minor units, schedule, runs (approve, post, reverse), usage readings, revaluation and impairment |
| `maintenance.js` | plans and generated work, work-order lifecycle, parts, downtime, repair history, warranties and claims, inspections, calibration |
| `control.js` | physical-verification campaigns and discrepancy resolution |
| `disposal.js` | sale / scrap / write-off / donation / return-to-vendor workflow with gain/loss |
| `reports.js` | dashboard and ten reports, including the register-to-ledger reconciliation |
| `accounting-bridge.js` | the only path to Accounting: one balanced, posted journal per financial event via Accounting's own internal API |
| `desk.js` | public names, prefixed so they cannot collide with Quality / Manufacturing / Accounting |

Migrations `156` (schema expansion), `157` and `158` (run-reversal uniqueness). Web: 22 pages, 48 read views and
55 actions over two dispatcher routes, wrappers registered in the route-security matrix.

## Design points

* **Money is integer minor units** (BigInt) end to end in depreciation, true-ups, adjustments and disposal gain/loss;
  the last period always trues up, and nothing depreciates below salvage.
* **Maker-checker**, all enforced in the domain, not the UI: capitalisation (registrar cannot capitalize), transfer,
  depreciation run, revaluation/impairment and disposal (requester cannot approve). Reject / cancel restore state.
* **Posted history is immutable.** A depreciation run is corrected by reversal (latest first); a value adjustment
  regenerates only the not-yet-posted schedule lines; a stale adjustment (value moved since it was requested) is refused.
* **Accounting handoff** posts through Accounting's own journal path, so its balance check, period lock and audit apply.
  With no accounts configured on the category, or no Accounting foundation, the event is recorded as `not_configured`
  rather than failing the asset operation.
* **Scope:** a person holding only `assets.view` is a custodian: they see only assets assigned to them, and cost / NBV
  are masked for anyone without a financial permission. Label payloads never carry value.
* No new permission keys were introduced: approvals use the existing `assets.accounting.handoff`.

## Defects found by testing, and fixed

| # | Defect | Fix |
|---|--------|-----|
| 1 | Migration 157 named a unique constraint by its untruncated name, so it never dropped and a reversed run blocked re-running the same date | Migration 158 finds it by its columns |
| 2 | Insert placeholder count off by one in `registerAsset` (caught by the first run) | Corrected |
| 3 | Category and location edits post only changed fields, which a whole-record validator rejects | Edits are completed from the stored row before validation |

## Feature status

| Feature | Area | Status |
|---------|------|--------|
| F231 | Asset register, list/search/filter, profile (children, movements, maintenance, warranties, schedule, events) | Verified |
| F232 | Categories with policy and ledger accounts | Verified (account validation, percentages) |
| F233 | Identity, tag code, scan resolution, label payload | Verified. Barcode/QR **image rendering and camera scanning: not built** (a tag box accepts scanner/keyboard input) |
| F234 | Location hierarchy, loop refusal | Verified |
| F235 | Custodian | Verified (assignment) |
| F236 | Department / cost centre on assignment and transfer | Verified for transfer and assignment |
| F237 | Capitalisation: threshold, SoD, journal, schedule | Verified |
| F238 | Creation from a posted supplier bill line, once | Verified. Creation from a goods receipt: **not built** (purchase-order source recorded without cost); one asset per bill line |
| F239 | Transfers with approval | Verified |
| F240 | Assignment and return, hand-over | Verified |
| F241 | Effective-dated movement history | Verified |
| F242-F244 | Value, useful life, salvage | Verified |
| F245 | Straight-line with full / mid / next-month convention and true-up | Verified (pure maths and posted runs) |
| F246 | Declining balance (explicit rate or double-declining) | Verified (pure maths) |
| F247 | Units of production from usage readings | Verified |
| F248 | Depreciation schedule | Verified |
| F249 | Runs: approve, post one journal, reverse | Verified |
| F250 | Revaluation up / down, reserve | Verified (up); down path built, untested |
| F251 | Impairment and reversal, stale guard | Verified |
| F252 | Work orders, lifecycle, availability | Verified |
| F253-F254 | Preventive plans, generated work, next due | Verified (time-based). Meter-based plans store the reading but **do not auto-generate** from meter readings |
| F255 | Repair history and cost | Verified |
| F256 | Downtime | Verified |
| F257 | Warranty, expiry alert, claims | Verified |
| F258 | Inspection, corrective work order | Verified. Checklist items are accepted by the API; the screen records the overall result only |
| F259 | Calibration, failed calibration out of service | Verified |
| F260 | Physical verification, discrepancy workflow | Verified |
| F261 | Scan classification | Verified server-side; mobile/offline queueing **not built** |
| F262-F265 | Disposal, sale, scrap, gain/loss, SoD, depreciation-first rule | Verified. A sale does **not** raise a customer invoice: proceeds are debited to the category's proceeds account |
| F266 | Accounting integration and reconciliation report | Verified (cost reconciles to the ledger after capitalisation and disposal) |
| F267 | Dashboard and reports, permission-safe | Verified |
| Parts | Maintenance parts are costed onto the order; **no Stock issue movement** is posted | Partial |
| Insurance, leases, asset-depreciation books (multiple books) | Not in this pass | Not built |

## Tests

`tests/integration/assets-register.test.mjs` (9), `assets-custody-value.test.mjs` (11), `assets-maintenance.test.mjs` (7),
`assets-control-disposal.test.mjs` (6): real PostgreSQL, no mocks; they reuse the Accounting world so every financial
event is checked against a real ledger. `apps/web/e2e/assets-lifecycle.spec.ts`: register, capitalize by someone else,
depreciation run approved and posted by someone else, report, denied user.

## Known gaps

* Only the register-to-depreciation journey was driven in a browser; the other screens were type-checked and linted.
* The register edit dialog changes descriptive fields only; component-of and supplier changes go through it too but were not walked.
* No print/label rendering, no camera scan, no offline queue, no Stock issue for maintenance parts, no goods-receipt source.
