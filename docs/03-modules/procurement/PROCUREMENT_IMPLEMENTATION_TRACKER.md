# Procurement implementation tracker

Status of the Procurement module (features F063–F096) against real evidence. "Verified" means exercised by a
test on real PostgreSQL and/or a real-browser journey with real role permissions — not "code exists".

**This is not a completion claim.** The acceptance register was not re-audited row by row. What follows is what
was built and proven, and — equally important — what is still open.

## How it was verified

| Layer | Evidence |
|---|---|
| Domain on real Postgres (RLS on, seeded-role permission sets, no owner bypass) | `tests/integration/procurement-source-to-pay.test.mjs` (27 tests) |
| Real browser, real personas (requester, buyer, approver, manager, goods-receipt user; owner only where the seeded roles hold no permission) | `apps/web/e2e/procurement-{requests,sourcing-orders,receiving,planning-analytics,settings}.spec.ts` |
| Real ledger | the receiving spec reads `tenant.stock_balances` directly: only accepted quantity enters stock, a return's dispatch takes it out |
| Static gates | route-security matrix (0 gaps), billing gate, eslint, tsc |

## Defects found by running against a real database (and fixed)

1. **No seeded role could complete an RFQ award.** `awardSourcingEvent` requires `procurement.sourcing.award`
   but then created the PO with the caller's own permissions, and `po.create` is held by no award-holder.
   The award now authorises the PO/agreement it creates.
2. **Every invoice match that produced an exception crashed** (foreign-key violation): the exception tried to
   re-insert the match record as a child row of the exception. Details now live on the exception.
3. **A partial invoice always looked like a variance**: 4 of 10 units at the right price was compared with the
   whole order line's value. Comparison is now pro rata to the invoiced quantity.
4. **Dispatching a purchase return never took stock out**; an orchestration now issues it (not best-effort).
5. **PO amendment could be approved by its own requester** (segregation of duties); now refused.
6. **A rejected requisition/PO was editable but could not be resubmitted**; now it can.
7. **`policies`, `source-rules`, `portal-users` could not be written at all** (their tables lacked the version /
   hash columns every other child table has), so the invoice-matching tolerance was unsettable. Migration
   `134_procurement_settings_tables_versioning.sql`.

8. **Call-offs were unbounded**: an order under an agreement could exceed, or ignore, what the agreement committed. Now enforced.

## Feature status

Legend: **Built+verified** · **Partial** (works, with named gaps) · **Not built**

| ID | Feature | Status | Notes / open gaps |
|---|---|---|---|
| F063 | Supplier master | Built+verified | Create/edit/list, lifecycle (submit → qualify by a different person → activate; suspend/block with reason), sensitive banking fields gated. Open: duplicate-supplier detection UI, merge. |
| F064 | Supplier contacts & addresses | Built+verified | Sites with contact fields. Open: multiple contacts per site as separate records. |
| F065 | Supplier onboarding | Partial | Qualification assessments and certifications, submit/qualify flow. **Supplier self-service portal onboarding is not built** (portal users resource exists; no portal UI). |
| F066 | Supplier categories | Built+verified | Categories CRUD-create; supplier form uses them. Open: category edit/hierarchy UI. |
| F067 | Purchase requisitions | Built+verified | Create/edit/submit/approve/reject/close/cancel; reject → revise → resubmit. |
| F068 | Requisition approvals | Built+verified | Approval queue across document types; creator cannot approve; reasons required. Open: **no amount-based approval thresholds/routing** (every requisition/PO needs one approval), no delegation. |
| F069 | RFQ creation | Built+verified | From scratch or from a requisition. |
| F070 | RFQ to multiple vendors | Built+verified | Invitations to several suppliers. Open: emailing invitations / supplier portal responses (bids are keyed in by the buyer). |
| F071 | Supplier quotations | Built+verified | Recorded per RFQ with per-line prices, lead time, validity. |
| F072 | Bid comparison | Built+verified | Side-by-side with lowest price and weighted score highlighted. Comparison totals are computed in the browser from bid lines (labelled as such); the awarded PO is priced by the server. |
| F073 | Supplier selection | Built+verified | Award (needs `sourcing.award`) creates a draft PO or agreement for the winner; once only. |
| F074 | Purchase orders | Built+verified | From scratch, requisition, RFQ award, agreement call-off or reorder. |
| F075 | PO approvals | Built+verified | Submit/approve (not by creator)/reject/dispatch/acknowledge/cancel. Open: see F068 thresholds. |
| F076 | PO amendments | Built+verified | Versioned; amendment approved by someone other than its requester; history shown. |
| F077 | Blanket purchase orders | Built+verified | Agreements of type blanket with call-off orders and consumption view. Call-offs are enforced: only an active agreement, only covered items, cumulative quantity never above the commitment (cancelling frees it). Open: value caps and price-vs-agreement checks. |
| F078 | Purchase agreements & contracts | Built+verified | Approval (contracts approver), activation, validity. Open: expiry handling / renewal alerts, contract document attachments. |
| F079 | Supplier price lists | Built+verified | Register with quantity breaks and validity; used to price reorder POs. **Not applied automatically when a buyer picks an item on a manual PO.** |
| F080 | Goods receipt (GRN) | Built+verified | From a PO, approval posts accepted quantity to real stock; reversal takes it back out. |
| F081 | Partial receipts | Built+verified | Multiple receipts per PO; PO moves partially_received → received; over-receiving refused. |
| F082 | Rejected receipts | Built+verified | Per-line rejection with reason; Rejections register; whole-receipt rejection with reason. Open: **no quarantine/rework location for rejected stock** (rejected quantity simply never enters stock). |
| F083 | Purchase returns | Built+verified | Against an approved receipt; dispatch issues stock. Open: PO received quantity is not reduced by a return; no debit-note posting. |
| F084 | Supplier invoices | Partial | Invoice matching register and entry. **Invoices are not stored as documents** (no attachment/scan/OCR, no invoice header record) — only the match ledger. |
| F085 | 2-way matching | Built+verified | Order price/quantity within tolerance. |
| F086 | 3-way matching | Built+verified | Against received quantity; exceptions with causes; resolve/override with reason; duplicate invoice numbers refused. No seeded role below admin holds `procurement.matching.manage` (a segregation choice, but leaves no operational AP role). |
| F087 | Landed costs | Partial | Recorded against an order/receipt with an allocation method. **Allocation into item cost / stock valuation is not performed.** |
| F088 | Payment terms | Partial | Terms text/days on supplier and PO; invoice tolerance policy configurable. Terms are not enforced into due dates or Accounting schedules from Procurement. |
| F089 | Supplier performance | Built+verified | On-time delivery and rejection rate from real receipts plus scorecards; computed in the browser over the latest 200 orders/receipts. |
| F090 | Supplier rating | Built+verified | A–D band from the scorecard (or from delivery/quality when none). Banding thresholds are fixed, not configurable. |
| F091 | Supplier lead times | Built+verified | Register; used when dating reorder POs. Not used to warn on PO delivery dates. |
| F092 | Spend analysis | Built+verified | Spend by supplier, contract compliance, maverick spend, savings, price variance (tables). No charts or category/department drill-down. |
| F093 | Purchase history | Built+verified | Order lines with supplier/item filters and price range (over the latest 200 orders). |
| F094 | Reorder-generated purchasing | Built+verified | Candidates from Stock reorder rules; request → draft PO priced from the supplier price list; idempotent. Open: no scheduled auto-generation; no consolidation of several items into one PO. |
| F095 | Subcontract purchasing | Partial | Subcontract order register/creation. **Material issue to and receipt back from the subcontractor is not modelled.** |
| F096 | Procurement dashboard | Built+verified | Live counters and links; readiness (blockers/warnings) on documents; governance snapshots/saved views exist in the domain but have **no UI**. |

## Known limits of this session's work

- Cross-module hand-offs stop at the boundary: a clean match creates an Accounting vendor bill **only when the
  supplier is linked to an Accounting party** (settable from the supplier's Accounting tab), and the vendor-bill
  creation itself was **not** exercised end to end (it needs a full Accounting foundation in the test organisation).
- No supplier portal, e-mail sending, document attachments, or mobile/offline.
- Accessibility and visual-regression gates were not run beyond the browser journeys.
- Procurement lists fetch up to 200 rows per query; the performance and history screens aggregate that page in
  the browser.
- The invoice, landed-cost and price registers use the shared operation-register screen; per-record detail pages
  for them do not exist.
