# Accounting: implementation tracker (F453-F510)

Status legend: **Verified** = exercised by a real-PostgreSQL integration test written this pass and/or a browser
spec; **Built, untested** = domain code exists and is wired into the UI/API but has no test of its own yet;
**Not built** = no screen or no domain function. This is a status record, not a completion claim.

## What existed and what this pass added

The Accounting domain (about 10,800 lines under `services/api/src/modules/accounting`) pre-dated this pass and had
**no tests and no web UI** (the route was a placeholder). This pass:

* wrote the first real-PostgreSQL integration tests for it (28 subtests, four files, all passing);
* found and fixed **six real defects** while doing so (below);
* built the web UI on the same Register / builder pattern used for CRM, HR, Support and Quality, plus the API
  routes, navigation, and route-security registration;
* reused (not rewrote) the existing subledger, journal, banking, tax, close and reporting code.

## Defects found by testing, and fixed

| # | Defect | Effect | Fix |
|---|--------|--------|-----|
| 1 | `completeBankReconciliation` used `FOR UPDATE` over a `LEFT JOIN` | Postgres rejects it, so **no bank reconciliation could ever complete** | `FOR UPDATE OF reconciliation` |
| 2 | `suggestBankMatches` compared a statement credit (deposit) with the journal line's **credit** side | Deposits were never suggested a match (a bank asset increases on the debit side) | Directions swapped |
| 3 | `fiscal_periods.status` CHECK allowed only `open/closed/locked` | The `soft_closed` state the close workflow relies on could never be stored | Migration `155` widens the constraint |
| 4 | `updateFiscalPeriodStatus` assigned an untyped `$4` inside a `CASE` to a uuid column | Every soft close failed with a type error | `$4::uuid` |
| 5 | `getVendorBill`, `getJournalEntry`, `getAsset`, bank-governance timeline and three setup readers ran several queries concurrently on one connection (`Promise.all`) | pg deprecation warning, an error in pg 9; `getCustomerInvoice` had already been fixed this way | Sequential awaits |
| 6 | Invoice and bill list queries did not return `party_id` | The receipt/payment allocation screen could not find a party's open documents | Column added |

## Behaviour worth knowing (found, documented, not changed)

* **Journal approval default is "always"**: `journal_approval_threshold` defaults to 0 and the check is `amount >= threshold`,
  so every journal entry needs a second approver until the threshold is raised, regardless of a journal's own flag.
* **Customer invoices default to no approval** (`required=false`, `threshold=0`, and the rule is `threshold > 0 AND amount >= threshold`),
  while **vendor bills and vendor payments default to approval required**. These are different formulas by design.
* A submitter can never approve their own document (journals, invoices, bills, payments), enforced in the domain.
* The web approve actions look the stored content hash up server-side; the domain still refuses if the content changed.

## Feature status

| Feature | Area | Status |
|---------|------|--------|
| F453, F456 | Chart of accounts; double-entry enforcement | Verified (seeded chart, unbalanced entry refused). Account create screen built |
| F454 | Ledgers / multi-ledger | Built, untested (primary ledger used throughout) |
| F455, F457-F459 | Journal entries: submit, approve, post, reverse; fiscal-period locks | Verified (maker-checker, reversal, closed period refusal) |
| F460-F462 | Dimensions, cost centres, departments on lines | Verified for department and cost centre on a line. Dimension values: built, untested |
| F463-F465 | Customer invoices (approval default, posting journal) | Verified |
| F466-F467 | Customer receipts and allocation | Verified |
| F468-F469 | Allocation guards (over and duplicate) | Verified |
| F470 | Customer credit notes applied to invoices | Verified |
| F471-F472 | Supplier bills, approval, no self-approval | Verified |
| F473-F474 | Supplier payments, allocation | Verified |
| F475 | Matching exception blocks posting | Verified |
| F476 | Bank accounts | Verified |
| F477-F478 | CSV statement import, hash de-duplication, match suggestions | Verified |
| F479-F480 | Reconciliation start, match, complete | Verified (defects 1 and 2 found here). Line-by-line match UI: **not built** (reconciliation start is on the statements list; matching is API-only) |
| F481-F484 | Tax ledger written on posting; tax return computed from it | Verified |
| F485-F487 | Tax return status machine, filing reference | Verified. TDS/TCS setup screens: **not built** |
| F488-F489 | Budgets: create, approval, activate | Create verified; approve/activate: built, untested. Budget vs actual report screen built, not exercised with data |
| F490 | Recurring journals | Domain built, untested. **No screen** (no create/list page) |
| F491-F493 | Accruals, deferrals, revenue recognition | Domain built, untested. Accrual list screen only (read-only). Prepayments / revenue schedule screens: **not built** |
| F494-F496 | Multi-currency, revaluation, FX gain/loss | Domain built, untested. Revaluation run list only (read-only) |
| F497-F499 | Intercompany, consolidation | Domain built, untested. Rule/group lists only (read-only) |
| F500 | Fiscal period soft close, reopen; hard close only via close run | Verified (defects 3 and 4 found here). Close run create/complete: built, untested |
| F501-F503 | Trial balance, P&L, balance sheet | Verified (trial balance balances; revenue on P&L) |
| F504-F506 | General ledger, aging, dashboard | Verified for reads. Cash flow, statements, exposure reports: built, untested |
| F507-F510 | Audit trail, compliance requests, saved views, governance dashboards | Domain built, untested. **No screens** except what the reports expose |
| Fixed assets | Categories, assets, capitalise, depreciate, dispose | Category and asset creation verified; capitalise, depreciate, dispose: built, untested |

## Web UI

Screens: dashboard; chart of accounts; journals (+ line builder); customer invoices (+ builder); receipts and payments
(three-step record / post-or-approve / allocate); supplier bills (+ builder); bank accounts; bank statements (CSV import);
tax returns; budgets; fiscal periods and period close; close runs; fixed assets; read-only lists for accruals,
revaluations, intercompany rules and consolidation groups; ten report pages driven by one report viewer.

Navigation: 28 previously "planned" items now available. Still planned: Credit, Reconciliation, TDS/TCS, Prepayments,
Revenue Schedules, Settings (no page yet).

## Tests

* `tests/integration/accounting-ledger.test.mjs` (8), `accounting-receivables-payables.test.mjs` (8),
  `accounting-banking-tax.test.mjs` (6), `accounting-close-reports.test.mjs` (6): real PostgreSQL, no mocks.
* `apps/web/e2e/accounting-journal.spec.ts`: accountant prepares, finance manager approves and posts, trial balance, denied user.

## Known gaps

* Roughly half of F488-F510 (recurring, accruals, FX, intercompany, consolidation, forecasting, compliance, governance
  dashboards) has domain code but **no independent test and, for most, no create screen**.
* Reconciliation line matching, TDS/TCS, settings and prepayment/revenue-schedule pages are not built.
* Reports render generically (one viewer over each report's rows); no charts, no CSV export from the report viewer.
* Only journals were driven through the browser; invoices, banking, tax and close screens were type-checked and
  linted but not walked in a browser.
