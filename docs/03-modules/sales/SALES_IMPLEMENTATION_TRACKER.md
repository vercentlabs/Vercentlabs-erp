# Sales implementation tracker

Status of the Sales module (features F031–F062) against real evidence. "Verified" means exercised by a
test on real PostgreSQL and/or a real-browser journey with real role permissions — not "code exists".

**This is not a completion claim.** The acceptance register holds 1,184 Sales sub-requirements; they were
not individually re-audited. What follows is what was built and proven, and — equally important — what is
still open.

## How it was verified

| Layer | Evidence |
|---|---|
| Domain on real Postgres (RLS on) | `tests/integration/sales-quotation-lifecycle-f036-f041.test.mjs`, `tests/integration/sales-order-lifecycle-f042-f048.test.mjs` (33 tests passing across both) |
| Real browser, real personas (rep, manager, second manager, customer with no session) | `apps/web/e2e/sales-{quotations,orders,registers,insights,deliveries,customers}.spec.ts` |
| Static gates | route-security matrix (0 gaps), billing mutation gate, `verify-experience` (no Sales violations), eslint, tsc |

Personas hold the seeded `sales_representative` / `sales_manager` roles — no bypass role — so permission
boundaries are tested as they ship (e.g. a rep is not offered "New return"; the margin report is refused for
a rep by the server; standard cost is absent from a rep's catalogue payload).

## Defects found by running against a real database (and fixed)

These were all invisible to the code that existed before, because no Sales backend test existed:

1. **No sales order could ever be confirmed.** `submitSalesOrder`/`approveSalesOrder` write
   `lifecycle_status='approved'` and `confirmSalesOrder` requires it, but the DB `CHECK` (migration 008)
   omitted `approved`. Fixed by migration `133_sales_order_approved_state.sql`.
2. **Order amendment always failed** — the line `INSERT` had 31 placeholders for 32 columns.
3. **Amendment approval request failed** — code `UPDATE`d `sales_order_amendments`, an immutable table;
   the approval id is now known before the single `INSERT`.
4. **Self-approval was not blocked** (F041-SEM-04). The role split alone did not stop a user holding both
   permissions from approving their own submission. Enforced in the domain for quotations, orders and
   amendments.
5. **Retrying a stock reservation with the same idempotency key failed** instead of replaying.
6. Pricing preview leaked cost/margin to any `sales.view` user; now an explicit projection.

## Feature status

Legend: **Built+verified** · **Partial** (works, with named gaps) · **Not built**

| ID | Feature | Status | Notes / open gaps |
|---|---|---|---|
| F031 | Customer master | Built+verified | List/search/create/edit/archive/restore, terms, currency, credit limit; server-side duplicate protection. Open: customer hierarchy UI, merge, import/export, credit-limit change history. |
| F032 | Addresses and contacts | Built+verified | Add/edit/remove on the customer page; required address fields validated (400, not 500). Open: contact roles, multiple-primary rules not independently tested. |
| F033 | Products and services | Partial | Read-only catalogue (cost hidden without margin permission). Item maintenance lives in inventory setup, not Sales. |
| F034 / F035 | Price lists / customer prices | Partial | Screen and API shipped in an earlier commit; **not re-verified in this session**. |
| F036 | Quotations | Built+verified | Create, server-priced preview, submit, approve, send, public customer link (accept/decline once), convert. |
| F037 | Versions and revisions | Built+verified | Revise creates an immutable version; compare API exists (UI shows summary). |
| F038 | Quotation expiry | Partial | Expiry scan verified in a test; **no scheduler is wired to run it** — it is an endpoint only. |
| F039 | Discounts | Partial | Line and whole-document discounts, price-override permission; Discounts page lists customer pricing rules (create/edit them under Price Lists). No discount-approval matrix UI. |
| F040 | Taxes | Built+verified | GST computed server-side (verified totals). Multi-jurisdiction/tax-inclusive cases beyond the seeded 18% not exhaustively tested. |
| F041 | Approval workflow | Partial | Quotation/order/amendment approval with self-approval blocked and permission split, verified. **No UI to configure thresholds** (`order_approval_amount` etc. are settings-table only); approver assignment only via API. |
| F042 | Sales orders | Built+verified | Create, list, detail, versions, activity. |
| F043 | Order confirmation | Built+verified | Auto-approve or approve → confirm; credit exposure check; holds/release. |
| F044 | Order amendments | Built+verified | Manager amends, a **different** manager approves; version history shown. Amending drops individual charges (orders keep only the charge total) — carried over as one editable line. |
| F045 | Availability check | Built+verified | Per line against real stock balances. |
| F046 | Stock reservation | Built+verified | Reserve from stock, idempotent. Stock context is built server-side and limited to view/reserve/issue. |
| F047 | Partial fulfilment | Built+verified | Deliver part of a line; issues real stock; refused over-delivery issues nothing. |
| F048 | Backorders | Built+verified | Register derived from progress counters. Open: no automatic re-allocation when stock arrives. |
| F049 | Delivery and shipment | Partial | Fulfilment requests and completion with stock movement. Open: carrier/tracking, packing, proof of delivery. |
| F050 | Sales invoices | Partial | Invoice **requests** raised and listed. Sales does not generate the invoice — Accounting owns that; the hand-off is not verified end to end from Sales. |
| F051 | Partial invoicing | Partial | Quantity basis (ordered / fulfilled) supported on the request; no per-line partial invoicing UI. |
| F052 | Advance payments | Built+verified | Capped at order total, reference required, register + dialog. Open: application of an advance against an invoice. |
| F053 | Credit limits | Built+verified | Limit check on confirmation, blocked without override, finance override needs permission and a reason. Open: credit-limit administration/reporting screen beyond the customer field. |
| F054 | Customer returns | Partial | Return requests bounded by fulfilled quantity, idempotent, registered. **Return approval/receipt/restock is not built** — only the request. |
| F055 | Credit notes and refunds | Partial | Requests validated and registered; **posting to Accounting is not built**. |
| F056 | Drop shipping | Partial | Request bounded by line quantity, idempotent. **Purchase-order creation in Procurement is not wired** (`procurement_reference` stays empty). |
| F057 | Sales commissions | Partial | Rules, accrual (idempotent, net-sales or margin basis), register; automatic accrual on confirmation is best-effort by design. **No payout/settlement.** |
| F058 | Payment terms | Partial | Terms chosen per document and snapshotted; Terms page is a read-only reference. Terms are maintained elsewhere (Settings). Installments/early-payment discount not implemented. |
| F059 | Order status tracking | Built+verified | Fulfilment, holds, billing readiness, approvals, expiring quotations. |
| F060 | Sales analytics | Partial | Conversion, intake, customer performance as tables. No charts/forecast/target views. |
| F061 | Margin and profitability | Built+verified | Margin report gated by `sales.margin.view`, enforced server-side; cost never sent otherwise. |
| F062 | Order-to-cash reporting | Partial | Individual reports exist; no consolidated order-to-cash pipeline or ageing view. |

## Known limits of this session's work

- The 1,184-row acceptance register was **not** re-audited; do not read the table above as sign-off.
- Cross-module hand-offs (Accounting invoices/credit notes, Procurement drop-ship POs, Stock returns) stop at
  the Sales boundary.
- Not built for Sales at all: saved views UI, bulk update UI, governance snapshot/dashboard UI (the domain
  functions exist), quotation templates, e-signature beyond typed acknowledgement, mobile/offline.
- Accessibility and visual regression gates were not run beyond the browser journeys above.
- The login endpoint is rate-limited (correctly). The e2e fixture signs each persona in once per process and
  reuses the session; running many separate Playwright processes in quick succession can hit HTTP 429.
