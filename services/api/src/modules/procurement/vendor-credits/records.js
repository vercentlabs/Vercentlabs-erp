// Debit Notes & Vendor Credits, read side: one credit in full (lines, source bills and returns, taxes, allocations and refunds, accounting,
// history), the lists, and the reports — a return's and a bill's credit progress and a supplier's credit statement.
import { add, decimal, sub } from "../../../core/decimal.js";
import { journalOf } from "../supplier-bills/records.js";
import { getSupplierDebitClaims, supplierOf } from "./claims.js";
import { creditedOnBillLines, loadCredit, returnLineEntitlement } from "./credits.js";
import { getVendorCreditAllocations, getVendorCreditRefunds } from "./settlement.js";
import {
  CLAIM_STATUS_LABELS, CREDIT_ORIGINS, CREDIT_REASONS, CREDIT_STATUS_LABELS, LIVE_SQL, ORIGIN_LABELS, POSTED_SQL, POSTED_STATUSES, REASON_LABELS, SETTLEMENT_LABELS, TAX_TREATMENTS,
  TAX_TREATMENT_LABELS, VC_PERMISSIONS, VC_VIEWS, can, creditStatus, dayOf, dec, readDate, requireCreditView, requireUuid, settlementStatus,
} from "./constants.js";

function creditRow(row) {
  const status = creditStatus(row);
  const settlement = settlementStatus(row);
  const total = decimal(row.grand_total);
  const available = POSTED_STATUSES.includes(row.status) ? decimal(row.outstanding_amount) : 0n;
  return {
    id: row.id, kind: "credit", number: row.bill_number, status, statusLabel: CREDIT_STATUS_LABELS[status] ?? row.status, settlementStatus: settlement, settlementLabel: SETTLEMENT_LABELS[settlement],
    supplierId: row.supplier_id, supplierName: row.supplier_snapshot?.displayName ?? row.supplier_snapshot?.supplierName ?? row.supplier_name ?? null,
    origin: row.credit_origin, originLabel: ORIGIN_LABELS[row.credit_origin] ?? "Supplier credit note", supplierCreditNoteNumber: row.supplier_invoice_reference,
    supplierCreditNoteDate: dayOf(row.supplier_credit_note_date), date: dayOf(row.bill_date), postingDate: dayOf(row.accounting_date), currencyCode: row.currency_code.trim(),
    taxTreatment: row.tax_treatment ?? "gst_adjusting", taxTreatmentLabel: TAX_TREATMENT_LABELS[row.tax_treatment ?? "gst_adjusting"], reason: row.debit_note_reason,
    taxable: dec(row.taxable_total ?? sub(decimal(row.subtotal), decimal(row.discount_total))), tax: dec(row.tax_total), withholding: dec(row.withholding_total), total: dec(total),
    available: dec(available), settled: dec(POSTED_STATUSES.includes(row.status) ? sub(total, available) : 0n), debitClaimId: row.debit_claim_id, claimNumber: row.claim_number ?? null,
    sourceBillId: row.source_bill_id, purchaseReturnId: row.source_purchase_return_id, purchaseOrderId: row.source_purchase_order_id, createdAt: row.created_at,
    href: `/procurement/debit-notes-credits/vendor-credits/${row.id}`,
  };
}

const CREDIT_SELECT = `SELECT credit.*, claim.claim_number FROM tenant.accounting_vendor_bills credit
  LEFT JOIN tenant.supplier_debit_claims claim ON claim.organization_id = credit.organization_id AND claim.id = credit.debit_claim_id`;

// getVendorCredits. filters: { view?, supplierId?, status?, settlementStatus?, origin?, search?, from?, to?, billId?, purchaseReturnId?, claimId?, limit? }
export async function getVendorCredits(client, context, filters = {}) {
  requireCreditView(context);
  const values = [context.organizationId];
  const push = (value) => { values.push(value); return `$${values.length}`; };
  let where = " AND credit.bill_type = 'credit_note'";
  if (filters.supplierId) where += ` AND credit.supplier_id = ${push(requireUuid(filters.supplierId, "Supplier"))}`;
  if (filters.origin) where += ` AND credit.credit_origin = ${push(String(filters.origin))}`;
  if (filters.claimId) where += ` AND credit.debit_claim_id = ${push(requireUuid(filters.claimId, "Debit claim"))}`;
  if (filters.purchaseReturnId) where += ` AND EXISTS (SELECT 1 FROM tenant.purchase_return_financial_allocations allocation WHERE allocation.organization_id = credit.organization_id
      AND allocation.debit_note_id = credit.id AND allocation.purchase_return_id = ${push(requireUuid(filters.purchaseReturnId, "Purchase return"))})`;
  if (filters.billId) where += ` AND (credit.source_bill_id = ${push(requireUuid(filters.billId, "Supplier bill"))} OR EXISTS (SELECT 1 FROM tenant.accounting_vendor_bill_lines line
      JOIN tenant.accounting_vendor_bill_lines source ON source.organization_id = line.organization_id AND source.id = line.source_bill_line_id
      WHERE line.organization_id = credit.organization_id AND line.vendor_bill_id = credit.id AND source.vendor_bill_id = $${values.length}))`;
  const status = filters.status ?? { credit_drafts: "draft", credits_posted: "posted" }[filters.view];
  if (status === "draft") where += " AND credit.status = 'draft'";
  if (status === "awaiting_approval") where += " AND credit.status IN ('pending_approval', 'approved')";
  if (status === "posted") where += ` AND credit.status IN ${POSTED_SQL}`;
  if (status === "cancelled" || status === "reversed") where += ` AND credit.status = ${push(status)}`;
  if (filters.view === "cancelled_reversed") where += " AND credit.status IN ('cancelled', 'reversed')";
  const settlement = filters.settlementStatus ?? { unapplied: "unapplied", partially_applied: "partially_applied", settled: "fully_settled" }[filters.view];
  if (settlement === "unapplied") where += ` AND credit.status IN ${POSTED_SQL} AND credit.outstanding_amount >= credit.grand_total`;
  if (settlement === "partially_applied") where += ` AND credit.status IN ${POSTED_SQL} AND credit.outstanding_amount > 0 AND credit.outstanding_amount < credit.grand_total`;
  if (settlement === "fully_settled") where += ` AND credit.status IN ${POSTED_SQL} AND credit.outstanding_amount <= 0`;
  if (filters.from) where += ` AND credit.bill_date >= ${push(readDate(filters.from, "From"))}`;
  if (filters.to) where += ` AND credit.bill_date <= ${push(readDate(filters.to, "To"))}`;
  if (filters.search) where += ` AND (credit.bill_number ILIKE ${push(`%${String(filters.search).trim()}%`)} OR credit.supplier_invoice_reference ILIKE $${values.length}
      OR credit.supplier_snapshot->>'displayName' ILIKE $${values.length} OR claim.claim_number ILIKE $${values.length})`;
  const { rows } = await client.query(`${CREDIT_SELECT} WHERE credit.organization_id = $1${where} ORDER BY credit.bill_date DESC, credit.created_at DESC
     LIMIT ${Math.min(Number(filters.limit) || 200, 500)}`, values);
  return rows.map(creditRow);
}

// listDebitNotesAndCredits: the "Debit Notes & Vendor Credits" list — claims and credits together, by view.
export async function listDebitNotesAndCredits(client, context, filters = {}) {
  const view = VC_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "all";
  const claimViews = VC_VIEWS.filter((entry) => entry.group === "claims").map((entry) => entry.key);
  const creditViews = VC_VIEWS.filter((entry) => entry.group === "credits").map((entry) => entry.key);
  const wantClaims = !creditViews.includes(view) && (can(context, VC_PERMISSIONS.claimsView) || can(context, VC_PERMISSIONS.claimsManage) || can(context, VC_PERMISSIONS.payablesManage));
  const wantCredits = !claimViews.includes(view);
  const claims = wantClaims ? (await getSupplierDebitClaims(client, context, { ...filters, view })).map((claim) => ({
    id: claim.id, kind: "claim", number: claim.claimNumber, status: claim.status, statusLabel: CLAIM_STATUS_LABELS[claim.status], settlementStatus: null, settlementLabel: null,
    supplierId: claim.supplierId, supplierName: claim.supplierName, origin: null, originLabel: "Debit claim to supplier", supplierCreditNoteNumber: claim.supplierReference, date: claim.issueDate,
    currencyCode: claim.currencyCode, reason: claim.reason, total: claim.claimedAmount, accepted: claim.acceptedAmount, disputed: claim.disputedAmount, available: claim.remainingToCredit,
    href: `/procurement/debit-notes-credits/claims/${claim.id}` })) : [];
  const credits = wantCredits ? await getVendorCredits(client, context, { ...filters, view }) : [];
  const rows = [...claims, ...credits].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { rows, views: VC_VIEWS };
}

// getVendorCredit: the credit in full.
export async function getVendorCredit(client, context, creditId) {
  const row = await loadCredit(client, context, creditId);
  const organizationId = context.organizationId;
  const claim = row.debit_claim_id ? (await client.query(`SELECT id, claim_number, status, accepted_amount FROM tenant.supplier_debit_claims WHERE organization_id = $1 AND id = $2`,
    [organizationId, row.debit_claim_id])).rows[0] : null;
  const lines = (await client.query(
    `SELECT line.*, source.sequence AS source_sequence, source.quantity AS source_quantity, source.net_amount AS source_taxable, bill.id AS bill_id, bill.bill_number, bill.supplier_invoice_reference,
            ret.id AS return_id, ret.return_number, return_line.line_number AS return_line_number
       FROM tenant.accounting_vendor_bill_lines line
       LEFT JOIN tenant.accounting_vendor_bill_lines source ON source.organization_id = line.organization_id AND source.id = line.source_bill_line_id
       LEFT JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = source.organization_id AND bill.id = source.vendor_bill_id
       LEFT JOIN tenant.purchase_return_lines return_line ON return_line.organization_id = line.organization_id AND return_line.id = line.purchase_return_line_id
       LEFT JOIN tenant.purchase_returns ret ON ret.organization_id = return_line.organization_id AND ret.id = return_line.purchase_return_id
      WHERE line.organization_id = $1 AND line.vendor_bill_id = $2 ORDER BY line.sequence`, [organizationId, row.id])).rows;
  const components = (await client.query(`SELECT * FROM tenant.supplier_bill_line_taxes WHERE organization_id = $1 AND vendor_bill_id = $2`, [organizationId, row.id])).rows;
  const billIds = [...new Set(lines.map((line) => line.bill_id).filter(Boolean))];
  const bills = billIds.length ? (await client.query(`SELECT id, bill_number, supplier_invoice_reference, bill_date, grand_total, outstanding_amount, status FROM tenant.accounting_vendor_bills
     WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY bill_date`, [organizationId, billIds])).rows : [];
  const returns = (await client.query(
    `SELECT ret.id, ret.return_number, ret.return_date, sum(allocation.allocated_quantity) AS quantity FROM tenant.purchase_return_financial_allocations allocation
       JOIN tenant.purchase_returns ret ON ret.organization_id = allocation.organization_id AND ret.id = allocation.purchase_return_id
      WHERE allocation.organization_id = $1 AND allocation.debit_note_id = $2 GROUP BY ret.id, ret.return_number, ret.return_date`, [organizationId, row.id])).rows;
  const posted = POSTED_STATUSES.includes(row.status);
  const allocations = await getVendorCreditAllocations(client, context, row.id);
  const refunds = await getVendorCreditRefunds(client, context, row.id);
  const journal = await journalOf(client, organizationId, row.journal_entry_id);
  const reversal = await journalOf(client, organizationId, row.reversal_journal_entry_id);
  const history = await client.query(`SELECT event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, account.full_name AS actor FROM tenant.accounting_events event
        LEFT JOIN public.users account ON account.id = event.actor_user_id WHERE event.organization_id = $1 AND event.entity_type = 'vendor_bill' AND event.entity_id = $2 ORDER BY event.occurred_at`,
      [organizationId, row.id]).then((result) => result.rows);
  const open = posted && decimal(row.outstanding_amount) > 0n ? await client.query(
      `SELECT id, bill_number, supplier_invoice_reference, bill_date, due_date, outstanding_amount FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND party_id = $2 AND bill_type = 'bill'
         AND status IN ('posted', 'partially_paid', 'overdue', 'disputed') AND outstanding_amount > 0 AND currency_code = $3
         AND ($4::uuid IS NULL OR buying_registration_id IS NULL OR buying_registration_id = $4) ORDER BY due_date, bill_date`,
      [organizationId, row.party_id, row.currency_code, row.buying_registration_id]).then((result) => result.rows) : [];

  const view = creditRow({ ...row, claim_number: claim?.claim_number });
  const refunded = refunds.filter((refund) => refund.status === "posted").reduce((total, refund) => add(total, decimal(refund.amount)), 0n);
  const applied = allocations.reduce((total, allocation) => add(total, decimal(allocation.amount)), 0n);
  const status = view.status;
  return {
    credit: { ...view, applied: dec(applied), refunded: dec(refunded), authorizationReason: row.credit_authorization_reason, notes: row.notes, buyingRegistration: row.buying_registration_snapshot,
      supplier: row.supplier_snapshot, supplierTax: row.supplier_tax_snapshot, placeOfSupply: row.place_of_supply, cancelReason: row.cancel_reason, reversalReason: row.reversal_reason,
      postedAt: row.posted_at, claim: claim && { id: claim.id, number: claim.claim_number, status: claim.status, href: `/procurement/debit-notes-credits/claims/${claim.id}` } },
    lines: lines.map((line) => ({
      id: line.id, sequence: line.sequence, description: line.description, reason: line.credit_reason, reasonLabel: REASON_LABELS[line.credit_reason] ?? null,
      basis: line.credit_basis ?? (line.adjustment_kind === "quantity" ? "quantity" : "amount"), quantity: dec(line.quantity), unitPrice: dec(line.unit_price), taxable: dec(line.net_amount),
      tax: dec(line.tax_amount), withholding: dec(line.withholding_amount), total: dec(line.line_total), hsnSac: line.hsn_sac_code,
      billId: line.bill_id, billNumber: line.bill_number, billLineId: line.source_bill_line_id, purchaseReturnLineId: line.purchase_return_line_id, billLineSequence: line.source_sequence, billedQuantity: dec(line.source_quantity), billedTaxable: dec(line.source_taxable),
      returnId: line.return_id, returnNumber: line.return_number, returnLineNumber: line.return_line_number,
      components: components.filter((component) => component.vendor_bill_line_id === line.id).map((component) => ({ taxType: component.tax_type, label: component.label,
        rate: dec(component.tax_rate), taxable: dec(component.taxable_base), amount: dec(component.tax_amount) })),
    })),
    sourceBills: bills.map((bill) => ({ id: bill.id, number: bill.bill_number, supplierInvoice: bill.supplier_invoice_reference, date: dayOf(bill.bill_date), total: dec(bill.grand_total),
      outstanding: dec(bill.outstanding_amount), status: bill.status, creditedHere: dec(lines.filter((line) => line.bill_id === bill.id).reduce((total, line) => add(total, decimal(line.line_total)), 0n)),
      href: `/procurement/supplier-bills/${bill.id}` })),
    sourceReturns: returns.map((entry) => ({ id: entry.id, number: entry.return_number, date: dayOf(entry.return_date), quantity: dec(entry.quantity), href: `/procurement/purchase-returns/${entry.id}` })),
    allocations, refunds, openBills: open.map((bill) => ({ id: bill.id, number: bill.bill_number, supplierInvoice: bill.supplier_invoice_reference, date: dayOf(bill.bill_date),
      dueDate: dayOf(bill.due_date), outstanding: dec(bill.outstanding_amount) })),
    accounting: { journal, reversal },
    history: history.map((entry) => ({ type: entry.event_type, from: entry.from_status, to: entry.to_status, details: entry.metadata, actor: entry.actor, at: entry.occurred_at })),
    actions: {
      edit: status === "draft" && (can(context, VC_PERMISSIONS.creditsManage) || can(context, VC_PERMISSIONS.payablesManage)),
      post: status === "draft" && can(context, VC_PERMISSIONS.payablesManage),
      approve: status === "awaiting_approval" && can(context, VC_PERMISSIONS.payablesApprove),
      cancel: ["draft", "awaiting_approval"].includes(status) && (can(context, VC_PERMISSIONS.creditsManage) || can(context, VC_PERMISSIONS.payablesManage)),
      allocate: posted && decimal(row.outstanding_amount) > 0n && can(context, VC_PERMISSIONS.payments) && open.length > 0,
      refund: posted && decimal(row.outstanding_amount) > 0n && can(context, VC_PERMISSIONS.payments),
      unapply: posted && allocations.length > 0 && can(context, VC_PERMISSIONS.payments),
      reverse: posted && can(context, VC_PERMISSIONS.payablesApprove),
      reverseRefund: can(context, VC_PERMISSIONS.payments),
      pdf: true,
    },
  };
}

// getPurchaseReturnCreditProgress: per returned line — returned, billed, credited (posted), pending in draft credits, still to credit.
export async function getPurchaseReturnCreditProgress(client, context, returnId) {
  requireCreditView(context);
  const ret = (await client.query(`SELECT id, return_number, document_status FROM tenant.purchase_returns WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(returnId, "Purchase return")])).rows[0];
  if (!ret) return null;
  const lines = (await client.query(`SELECT id, line_number, description, quantity FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2 ORDER BY line_number`,
    [context.organizationId, ret.id])).rows;
  const posted = new Map((await client.query(
    `SELECT allocation.purchase_return_line_id, sum(allocation.allocated_quantity) AS quantity, sum(allocation.allocated_value) AS value FROM tenant.purchase_return_financial_allocations allocation
       JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = allocation.organization_id AND credit.id = allocation.debit_note_id
      WHERE allocation.organization_id = $1 AND allocation.purchase_return_id = $2 AND allocation.allocation_type = 'debit_note' AND credit.status IN ${POSTED_SQL}
      GROUP BY allocation.purchase_return_line_id`, [context.organizationId, ret.id])).rows.map((row) => [row.purchase_return_line_id, row]));
  const out = [];
  for (const line of lines) {
    const shares = await returnLineEntitlement(client, context.organizationId, line.id);
    const billed = shares.reduce((total, share) => add(total, share.billed), 0n);
    const live = shares.reduce((total, share) => add(total, share.credited), 0n);
    const credited = decimal(posted.get(line.id)?.quantity ?? 0);
    out.push({ lineId: line.id, lineNumber: line.line_number, description: line.description, returned: dec(line.quantity), billed: dec(billed), credited: dec(credited),
      creditedValue: dec(posted.get(line.id)?.value ?? 0), pendingInDrafts: dec(sub(live, credited)), open: dec(sub(billed, live) > 0n ? sub(billed, live) : 0n) });
  }
  const sum = (key) => dec(out.reduce((total, line) => add(total, decimal(line[key])), 0n));
  return { returnId: ret.id, returnNumber: ret.return_number, lines: out, totals: { returned: sum("returned"), billed: sum("billed"), credited: sum("credited"), open: sum("open") } };
}

// getSupplierBillCreditSummary: per bill line — billed, credited (posted) and still creditable; the credits that corrected the bill.
export async function getSupplierBillCreditSummary(client, context, billId) {
  requireCreditView(context);
  const bill = (await client.query(`SELECT id, bill_number, grand_total, outstanding_amount FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2 AND bill_type = 'bill'`,
    [context.organizationId, requireUuid(billId, "Supplier bill")])).rows[0];
  if (!bill) return null;
  const lines = (await client.query(`SELECT id, sequence, description, quantity, net_amount, reverse_charge FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2
     ORDER BY sequence`, [context.organizationId, bill.id])).rows;
  const live = await creditedOnBillLines(client, context.organizationId, lines.map((line) => line.id));
  const posted = new Map((await client.query(
    `SELECT line.source_bill_line_id, COALESCE(sum(line.quantity) FILTER (WHERE line.adjustment_kind = 'quantity'), 0) AS quantity, COALESCE(sum(line.net_amount), 0) AS taxable
       FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = line.organization_id AND credit.id = line.vendor_bill_id
      WHERE line.organization_id = $1 AND line.source_bill_line_id = ANY($2::uuid[]) AND credit.bill_type = 'credit_note' AND credit.status IN ${POSTED_SQL} GROUP BY line.source_bill_line_id`,
    [context.organizationId, lines.map((line) => line.id)])).rows.map((row) => [row.source_bill_line_id, row]));
  const credits = await getVendorCredits(client, context, { billId: bill.id });
  return {
    billId: bill.id, billNumber: bill.bill_number,
    lines: lines.map((line) => {
      const held = live.get(line.id) ?? { quantity: 0n, taxable: 0n };
      return { lineId: line.id, sequence: line.sequence, description: line.description, reverseCharge: line.reverse_charge, billedQuantity: dec(line.quantity), billedTaxable: dec(line.net_amount),
        creditedQuantity: dec(posted.get(line.id)?.quantity ?? 0), creditedTaxable: dec(posted.get(line.id)?.taxable ?? 0),
        openQuantity: dec(sub(decimal(line.quantity), held.quantity)), openTaxable: dec(sub(decimal(line.net_amount), held.taxable)) };
    }),
    credits, creditedTotal: dec(credits.filter((credit) => credit.status === "posted").reduce((total, credit) => add(total, decimal(credit.total)), 0n)),
  };
}

// getSupplierCreditStatement: a supplier's credits, applications and refunds in a period, with the running unapplied balance per currency.
// filters: { from?, to? }
export async function getSupplierCreditStatement(client, context, supplierId, filters = {}) {
  requireCreditView(context);
  const supplier = await supplierOf(client, context.organizationId, supplierId);
  const from = readDate(filters.from, "From") ?? "1900-01-01";
  const to = readDate(filters.to, "To") ?? "2999-12-31";
  const { rows } = await client.query(
    `SELECT * FROM (
       SELECT credit.bill_date AS day, credit.created_at AS at, 'credit' AS kind, credit.bill_number AS number, credit.currency_code, credit.grand_total AS amount, credit.id AS credit_id, NULL::text AS against
         FROM tenant.accounting_vendor_bills credit WHERE credit.organization_id = $1 AND credit.party_id = $2 AND credit.bill_type = 'credit_note' AND credit.posted_at IS NOT NULL
       UNION ALL
       SELECT credit.reversed_at::date, credit.reversed_at, 'reversal', credit.bill_number, credit.currency_code, -credit.grand_total, credit.id, NULL
         FROM tenant.accounting_vendor_bills credit WHERE credit.organization_id = $1 AND credit.party_id = $2 AND credit.bill_type = 'credit_note' AND credit.status = 'reversed' AND credit.posted_at IS NOT NULL
       UNION ALL
       SELECT allocation.allocated_at::date, allocation.allocated_at, 'applied', credit.bill_number, credit.currency_code, -allocation.allocated_amount, credit.id, bill.bill_number
         FROM tenant.accounting_vendor_credit_allocations allocation JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = allocation.organization_id AND credit.id = allocation.credit_note_id
         JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
        WHERE allocation.organization_id = $1 AND credit.party_id = $2
       UNION ALL
       SELECT refund.refund_date, refund.created_at, 'refund', credit.bill_number, credit.currency_code, -refund.amount, credit.id, refund.refund_number
         FROM tenant.accounting_vendor_credit_refunds refund JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = refund.organization_id AND credit.id = refund.credit_note_id
        WHERE refund.organization_id = $1 AND credit.party_id = $2
       UNION ALL
       SELECT refund.reversed_at::date, refund.reversed_at, 'refund_reversed', credit.bill_number, credit.currency_code, refund.amount, credit.id, refund.refund_number
         FROM tenant.accounting_vendor_credit_refunds refund JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = refund.organization_id AND credit.id = refund.credit_note_id
        WHERE refund.organization_id = $1 AND credit.party_id = $2 AND refund.status = 'reversed'
     ) entry ORDER BY entry.day, entry.at`, [context.organizationId, supplier.party_id]);
  const balances = new Map();
  const opening = new Map();
  const entries = [];
  for (const row of rows) {
    const currency = row.currency_code.trim();
    const amount = decimal(row.amount);
    const day = dayOf(row.day);
    const balance = add(balances.get(currency) ?? 0n, amount);
    balances.set(currency, balance);
    if (day < from) { opening.set(currency, balance); continue; }
    if (day > to) continue;
    entries.push({ date: day, kind: row.kind, number: row.number, against: row.against, currencyCode: currency, amount: dec(amount), balance: dec(balance), creditId: row.credit_id });
  }
  const closing = new Map();
  for (const entry of entries) closing.set(entry.currencyCode, entry.balance);
  return {
    supplierId: supplier.id, supplierName: supplier.display_name, from: filters.from ?? null, to: filters.to ?? null, entries,
    opening: [...opening].map(([currencyCode, amount]) => ({ currencyCode, amount: dec(amount) })),
    closing: [...new Set([...opening.keys(), ...closing.keys()])].map((currencyCode) => ({ currencyCode, amount: closing.get(currencyCode) ?? dec(opening.get(currencyCode) ?? 0n) })),
  };
}

// getVendorCreditOptions: what the forms choose from — reasons, origins, treatments; for a supplier, its posted bills' creditable lines, its posted
// returns with billed goods still to credit, its accepted claims, and the bank accounts for refunds.
export async function getVendorCreditOptions(client, context, filters = {}) {
  requireCreditView(context);
  const organizationId = context.organizationId;
  const base = {
    reasons: CREDIT_REASONS, origins: CREDIT_ORIGINS, taxTreatments: TAX_TREATMENTS, views: VC_VIEWS,
    permissions: { claimsManage: can(context, VC_PERMISSIONS.claimsManage), claimsRespond: can(context, VC_PERMISSIONS.claimsRespond), creditsManage: can(context, VC_PERMISSIONS.creditsManage)
      || can(context, VC_PERMISSIONS.payablesManage), exceptional: can(context, VC_PERMISSIONS.creditsExceptional), post: can(context, VC_PERMISSIONS.payablesManage),
      settle: can(context, VC_PERMISSIONS.payments) },
    suppliers: (await client.query(`SELECT supplier.id, supplier.supplier_number, party.display_name FROM tenant.procurement_suppliers supplier
        JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
       WHERE supplier.organization_id = $1 AND supplier.status <> 'blocked' ORDER BY party.display_name LIMIT 500`, [organizationId])).rows
      .map((row) => ({ id: row.id, number: row.supplier_number, name: row.display_name })),
    bankAccounts: (await client.query(`SELECT id, bank_name, account_name, masked_account_number, currency_code FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND status = 'active'
       ORDER BY bank_name`, [organizationId])).rows.map((row) => ({ id: row.id, name: `${row.bank_name} · ${row.account_name}${row.masked_account_number ? ` (${row.masked_account_number})` : ""}`,
      currencyCode: row.currency_code?.trim() })),
  };
  if (!filters.supplierId) return { ...base, bills: [], returns: [], claims: [] };
  const supplier = await supplierOf(client, organizationId, filters.supplierId);
  const excludeCreditId = filters.excludeCreditId ? requireUuid(filters.excludeCreditId, "Vendor credit") : null;
  const bills = (await client.query(`SELECT id, bill_number, supplier_invoice_reference, bill_date, currency_code, grand_total, outstanding_amount, buying_registration_id FROM tenant.accounting_vendor_bills
     WHERE organization_id = $1 AND party_id = $2 AND bill_type = 'bill' AND status IN ${POSTED_SQL} ORDER BY bill_date DESC LIMIT 100`, [organizationId, supplier.party_id])).rows;
  const billLines = bills.length ? (await client.query(`SELECT id, vendor_bill_id, sequence, description, quantity, unit_price, net_amount, tax_amount, reverse_charge FROM tenant.accounting_vendor_bill_lines
     WHERE organization_id = $1 AND vendor_bill_id = ANY($2::uuid[]) ORDER BY sequence`, [organizationId, bills.map((bill) => bill.id)])).rows : [];
  const credited = await creditedOnBillLines(client, organizationId, billLines.map((line) => line.id), { excludeCreditId });
  const returns = (await client.query(`SELECT ret.id, ret.return_number, ret.return_date FROM tenant.purchase_returns ret WHERE ret.organization_id = $1 AND ret.supplier_id = $2 AND ret.document_status = 'posted'
     AND EXISTS (SELECT 1 FROM tenant.purchase_return_financial_allocations allocation WHERE allocation.organization_id = ret.organization_id AND allocation.purchase_return_id = ret.id
       AND allocation.allocation_type = 'billed') ORDER BY ret.return_date DESC LIMIT 50`, [organizationId, supplier.id])).rows;
  const returnLines = [];
  for (const ret of returns) {
    const lines = (await client.query(`SELECT id, line_number, description, quantity FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2 ORDER BY line_number`,
      [organizationId, ret.id])).rows;
    for (const line of lines) {
      const shares = await returnLineEntitlement(client, organizationId, line.id, { excludeCreditId });
      returnLines.push({ returnId: ret.id, lineId: line.id, lineNumber: line.line_number, description: line.description, returned: dec(line.quantity),
        billed: dec(shares.reduce((total, share) => add(total, share.billed), 0n)), open: dec(shares.reduce((total, share) => add(total, share.open), 0n)) });
    }
  }
  const claims = (await getSupplierDebitClaims(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), VC_PERMISSIONS.claimsView])] }, { supplierId: supplier.id }))
    .filter((claim) => ["accepted", "partially_accepted"].includes(claim.status) && decimal(claim.remainingToCredit) > 0n);
  return {
    ...base, supplier: { id: supplier.id, name: supplier.display_name, currencyCode: supplier.default_currency?.trim() ?? null },
    bills: bills.map((bill) => ({ id: bill.id, number: bill.bill_number, supplierInvoice: bill.supplier_invoice_reference, date: dayOf(bill.bill_date), currencyCode: bill.currency_code.trim(),
      total: dec(bill.grand_total), outstanding: dec(bill.outstanding_amount),
      lines: billLines.filter((line) => line.vendor_bill_id === bill.id).map((line) => {
        const held = credited.get(line.id) ?? { quantity: 0n, taxable: 0n };
        return { id: line.id, sequence: line.sequence, description: line.description, quantity: dec(line.quantity), unitPrice: dec(line.unit_price), taxable: dec(line.net_amount),
          tax: dec(line.tax_amount), reverseCharge: line.reverse_charge, openQuantity: dec(sub(decimal(line.quantity), held.quantity)), openTaxable: dec(sub(decimal(line.net_amount), held.taxable)) };
      }) })),
    returns: returns.map((ret) => ({ id: ret.id, number: ret.return_number, date: dayOf(ret.return_date), lines: returnLines.filter((line) => line.returnId === ret.id) })),
    claims: claims.map((claim) => ({ id: claim.id, number: claim.claimNumber, accepted: claim.acceptedAmount, remaining: claim.remainingToCredit, currencyCode: claim.currencyCode })),
  };
}

