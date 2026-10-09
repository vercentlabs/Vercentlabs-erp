// Procurement insights: the Home command centre (what needs action, counted from each authoritative module) and the operational reports —
// searchable, filterable tables read from the documents themselves (Finance's balances for what is owed and credited). Nothing is copied
// into a reporting store.
//
// Every report takes { supplierId?, buyingRegistrationId? (company), from?, to?, status? } and returns { key, title, description, columns,
// rows } where each row carries an href to its source document. Sections a person may not see are left out.
import { formatDecimal } from "../../../core/decimal.js";
import { companyToday } from "../../../core/payment-terms/index.js";
import { poCan, poScopeSql } from "../purchase-orders/access.js";
import { PurchaseOrderError, dayOf, isUuid, readDate } from "../purchase-orders/constants.js";
import { listRejections } from "../purchase-orders/rejection-records.js";
import { listPurchaseReturns } from "../purchase-returns/records.js";
import { listSupplierBills } from "../supplier-bills/records.js";
import { getSupplierDebitClaims } from "../vendor-credits/claims.js";
import { getVendorCredits } from "../vendor-credits/records.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const can = (context, ...permissions) => permissions.some((permission) => poCan(context, permission));
const SEE_ORDERS = ["procurement.po.view", "procurement.po.view_all"];
const SEE_BILLS = ["procurement.bills.view", "accounting.payables.manage", "accounting.payables.approve"];
const SEE_RETURNS = ["procurement.returns.view", "procurement.returns.manage", "procurement.po.view", "procurement.po.view_all"];
const SEE_CLAIMS = ["procurement.claims.view", "procurement.claims.manage", "accounting.payables.manage"];
const SEE_CREDITS = ["procurement.bills.view", "procurement.credits.manage", "procurement.credits.exceptional", "procurement.claims.view", "accounting.payables.manage", "accounting.payables.approve"];
const SEE_REJECTIONS = ["procurement.rejections.view", "procurement.rejections.view_all"];
const POSTED_SQL = "('posted', 'partially_paid', 'paid', 'overdue', 'disputed')";

function readFilters(filters = {}) {
  return {
    supplierId: isUuid(filters.supplierId) ? filters.supplierId : null, buyingRegistrationId: isUuid(filters.buyingRegistrationId) ? filters.buyingRegistrationId : null,
    from: readDate(filters.from, "From"), to: readDate(filters.to, "To"), status: filters.status ? String(filters.status) : null,
  };
}
const statusText = (value) => (value ? String(value).replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase()) : "");
const inRange = (day, { from, to }) => (!from || (day && day >= from)) && (!to || (day && day <= to));

// ---------------------------------------------------------------- home

// getProcurementOverview: the Home figures and the items that need someone to act.
export async function getProcurementOverview(client, context) {
  if (!can(context, ...SEE_ORDERS, ...SEE_BILLS)) throw new PurchaseOrderError(403, "You do not have permission to view Procurement.", "PERMISSION_DENIED");
  const organizationId = context.organizationId;
  const today = await companyToday(client, organizationId);
  const metrics = [];
  const attention = [];
  if (can(context, ...SEE_ORDERS)) {
    const scoped = [organizationId];
    const scope = poScopeSql(context, scoped);
    const orders = (await client.query(
      `SELECT count(*) FILTER (WHERE po.status = 'confirmed')::int AS open,
              count(*) FILTER (WHERE po.status = 'confirmed' AND EXISTS (SELECT 1 FROM tenant.purchase_order_line_status status WHERE status.organization_id = po.organization_id
                AND status.purchase_order_id = po.id AND status.receipt_required AND status.remaining_to_receive > 0))::int AS pending_receipts
         FROM tenant.purchase_orders po WHERE po.organization_id = $1${scope}`, scoped)).rows[0];
    metrics.push({ key: "open_orders", label: "Open Purchase Orders", value: orders.open, href: "/procurement/purchase-orders?view=confirmed" },
      { key: "pending_receipts", label: "Pending Receipts", value: orders.pending_receipts, href: "/procurement/purchase-orders?view=awaiting_receipt" });
    const held = (await client.query(
      `SELECT receipt.id, receipt.receipt_number, sum(line.held_quantity) AS held FROM tenant.goods_receipt_lines line
         JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
         JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
        WHERE line.organization_id = $1 AND receipt.status = 'posted' AND receipt.reversed_at IS NULL AND line.held_quantity > 0${scope}
        GROUP BY receipt.id, receipt.receipt_number ORDER BY receipt.receipt_number DESC LIMIT 5`, scoped)).rows;
    for (const row of held) attention.push({ kind: "Pending receipt inspection", title: row.receipt_number, detail: `${Number(row.held)} units on hold`, href: `/procurement/goods-receipts/${row.id}?tab=items` });
  }
  if (can(context, ...SEE_REJECTIONS)) {
    const issues = await listRejections(client, context, { view: "open" });
    metrics.push({ key: "receiving_issues", label: "Receiving Issues", value: issues.length, href: "/procurement/goods-receipts?view=receiving-issues" });
    for (const issue of issues.slice(0, 3)) attention.push({ kind: "Receiving issue", title: issue.rejectionNumber, detail: `${issue.reasonLabel} · ${issue.purchaseOrderNumber}`, href: `/procurement/receiving-issues/${issue.id}` });
  }
  if (can(context, ...SEE_BILLS)) {
    const mismatches = await listSupplierBills(client, context, { view: "matching_issues" });
    metrics.push({ key: "bill_mismatches", label: "Bills With Mismatches", value: mismatches.length, href: "/procurement/supplier-bills?view=matching-issues" });
    for (const bill of mismatches.slice(0, 3))
      attention.push({ kind: "Supplier Bill mismatch", title: bill.billNumber, detail: bill.discrepancy ?? "Matching needs attention", href: `/procurement/supplier-bills/${bill.id}?tab=matching` });
    // Finance's open instalments past their due date (the company's local date).
    const overdue = (await client.query(
      `SELECT count(DISTINCT bill.id)::int AS bills FROM tenant.accounting_vendor_bill_schedules schedule
         JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = schedule.organization_id AND bill.id = schedule.vendor_bill_id
        WHERE schedule.organization_id = $1 AND bill.bill_type = 'bill' AND bill.status IN ${POSTED_SQL} AND schedule.outstanding_amount > 0 AND schedule.due_date < $2`,
      [organizationId, today])).rows[0].bills;
    metrics.push({ key: "overdue_bills", label: "Overdue Supplier Bills", value: overdue, href: "/procurement/supplier-bills?view=overdue" });
  }
  if (can(context, ...SEE_RETURNS)) {
    const returns = (await listPurchaseReturns(client, context, { view: "awaiting_resolution" }));
    metrics.push({ key: "unresolved_returns", label: "Unresolved Returns", value: returns.length, href: "/procurement/purchase-returns?view=awaiting_resolution" });
    const financial = await listPurchaseReturns(client, context, { view: "awaiting_financial" });
    for (const entry of financial.slice(0, 3))
      attention.push({ kind: "Supplier credit pending", title: entry.returnNumber, detail: "Financial adjustment outstanding", href: `/procurement/purchase-returns/${entry.id}?tab=financial` });
    const replacements = await listPurchaseReturns(client, context, { view: "awaiting_replacement" });
    for (const entry of replacements.slice(0, 2))
      attention.push({ kind: "Replacement awaited", title: entry.returnNumber, detail: entry.replacementLabel, href: `/procurement/purchase-returns/${entry.id}?tab=resolution` });
  }
  if (can(context, ...SEE_CLAIMS)) {
    const claims = await getSupplierDebitClaims(client, context, { view: "awaiting_response" });
    for (const claim of claims.slice(0, 2)) attention.push({ kind: "Awaiting supplier response", title: claim.claimNumber, detail: `${claim.supplierName ?? ""} · ${dec(claim.claimedAmount)}`, href: `/procurement/debit-notes-credits/claims/${claim.id}` });
  }
  if (can(context, ...SEE_CLAIMS)) {
    const accepted = (await getSupplierDebitClaims(client, context, { view: "accepted_open" })).filter((claim) => Number(claim.remainingToCredit) > 0);
    metrics.push({ key: "pending_credits", label: "Pending Supplier Credits", value: accepted.length, href: "/procurement/reports/pending-supplier-credits" });
  }
  return { today, metrics, attention };
}

// ---------------------------------------------------------------- reports

const REPORTS = [
  { key: "purchases-by-period", title: "Purchases by Period", description: "Posted supplier bills less supplier credit notes, by month: bills, net purchases before tax, tax and total.", see: SEE_BILLS },
  { key: "purchases-by-supplier", title: "Purchases by Supplier", description: "Net purchases per supplier from posted bills less credit notes, with what is still owed.", see: SEE_BILLS },
  { key: "purchases-by-item", title: "Purchases by Item", description: "Quantities and net purchases per item from posted bill lines less credit-note lines.", see: SEE_BILLS },
  { key: "purchase-order-progress", title: "Purchase Order Progress", description: "Ordered, cancelled, received, billed and remaining quantities and values per order.", see: SEE_ORDERS },
  { key: "pending-goods-receipts", title: "Pending Goods Receipts", description: "Confirmed order quantities still awaiting physical delivery.", see: SEE_ORDERS },
  { key: "receiving-discrepancies", title: "Receiving Discrepancies", description: "Refused, short, held and rejected deliveries and their resolution.", see: SEE_REJECTIONS },
  { key: "unbilled-goods-receipts", title: "Unbilled Goods Receipts", description: "Received quantities eligible for billing not yet covered by posted bills.", see: SEE_ORDERS },
  { key: "bill-matching-issues", title: "Supplier Bill Matching Issues", description: "2-Way and 3-Way discrepancies and unresolved variances.", see: SEE_BILLS },
  { key: "bills-due-dates", title: "Supplier Bills & Due Dates", description: "Unpaid, partially paid, overdue and upcoming instalments, from Finance's balances.", see: SEE_BILLS },
  { key: "purchase-return-summary", title: "Purchase Return Summary", description: "Returned quantities, suppliers, reasons and resolution progress.", see: SEE_RETURNS },
  { key: "pending-supplier-credits", title: "Pending Supplier Credits", description: "Returns and accepted claims awaiting their financial correction.", see: SEE_CREDITS },
  { key: "vendor-credit-balances", title: "Vendor Credit Balances", description: "Posted, applied, refunded and unapplied credits, from Finance.", see: SEE_CREDITS },
];

export function getProcurementReportCatalog(context) {
  return REPORTS.filter((report) => can(context, ...report.see)).map(({ key, title, description }) => ({ key, title, description }));
}

const col = (key, label, type = "text") => ({ key, label, type });

// getProcurementReport. name: one of the catalog keys; filters: { supplierId?, buyingRegistrationId?, from?, to?, status? }.
export async function getProcurementReport(client, context, name, rawFilters = {}) {
  const report = REPORTS.find((entry) => entry.key === name);
  if (!report) throw new PurchaseOrderError(404, "Report not found.", "REPORT_NOT_FOUND");
  if (!can(context, ...report.see)) throw new PurchaseOrderError(403, "You do not have permission to view this report.", "PERMISSION_DENIED");
  const filters = readFilters(rawFilters);
  const organizationId = context.organizationId;
  const values = [organizationId];
  const bind = (value) => `$${values.push(value)}`;
  const poWhere = () => `${poScopeSql(context, values)}${filters.supplierId ? ` AND po.supplier_id = ${bind(filters.supplierId)}` : ""}${filters.buyingRegistrationId ? ` AND po.buying_registration_id = ${bind(filters.buyingRegistrationId)}` : ""}`
    + `${filters.from ? ` AND po.order_date >= ${bind(filters.from)}` : ""}${filters.to ? ` AND po.order_date <= ${bind(filters.to)}` : ""}`;
  let columns = [];
  let rows = [];
  switch (name) {
    case "purchase-order-progress": {
      columns = [col("number", "Purchase order"), col("supplier", "Supplier"), col("date", "Order date", "date"), col("status", "Status"), col("ordered", "Ordered", "number"),
        col("cancelled", "Cancelled", "number"), col("received", "Received", "number"), col("billed", "Billed", "number"), col("remainingToReceive", "To receive", "number"),
        col("remainingToBill", "To bill", "number"), col("value", "Order value", "money"), col("billedValue", "Billed value", "money")];
      const result = await client.query(
        `SELECT po.id, po.purchase_order_number, po.status, po.order_date, po.grand_total, po.currency_code, party.display_name AS supplier,
                sum(status.ordered_quantity) AS ordered, sum(status.cancelled_quantity) AS cancelled, sum(status.received_quantity) AS received, sum(status.posted_billed_quantity) AS billed,
                sum(status.remaining_to_receive) FILTER (WHERE status.receipt_required) AS to_receive, sum(GREATEST(status.bill_target_quantity - status.posted_billed_quantity, 0)) AS to_bill,
                sum(status.billed_amount) AS billed_value
           FROM tenant.purchase_orders po JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
           JOIN tenant.purchase_order_line_status status ON status.organization_id = po.organization_id AND status.purchase_order_id = po.id
          WHERE po.organization_id = $1 AND po.status <> 'draft'${poWhere()}${filters.status ? ` AND po.status = ${bind(filters.status)}` : ""}
          GROUP BY po.id, party.display_name ORDER BY po.order_date DESC, po.purchase_order_number DESC LIMIT 1000`, values);
      rows = result.rows.map((row) => ({ number: row.purchase_order_number, supplier: row.supplier, date: dayOf(row.order_date), status: statusText(row.status), ordered: dec(row.ordered),
        cancelled: dec(row.cancelled), received: dec(row.received), billed: dec(row.billed), remainingToReceive: dec(row.to_receive ?? 0), remainingToBill: dec(row.to_bill),
        value: dec(row.grand_total), billedValue: dec(row.billed_value ?? 0), currency: row.currency_code?.trim(), href: `/procurement/purchase-orders/${row.id}` }));
      break;
    }
    case "pending-goods-receipts": {
      columns = [col("number", "Purchase order"), col("supplier", "Supplier"), col("line", "Line"), col("item", "Item"), col("expected", "Expected", "date"), col("ordered", "Ordered", "number"),
        col("received", "Received", "number"), col("remaining", "Awaiting", "number"), col("overdue", "Overdue")];
      const today = await companyToday(client, organizationId);
      const result = await client.query(
        `SELECT po.id, po.purchase_order_number, party.display_name AS supplier, status.line_number, line.description, status.expected_delivery_date, status.ordered_quantity,
                status.received_quantity, status.remaining_to_receive
           FROM tenant.purchase_order_line_status status JOIN tenant.purchase_orders po ON po.organization_id = status.organization_id AND po.id = status.purchase_order_id
           JOIN tenant.purchase_order_lines line ON line.organization_id = status.organization_id AND line.id = status.purchase_order_line_id
           JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
          WHERE status.organization_id = $1 AND po.status = 'confirmed' AND status.receipt_required AND status.remaining_to_receive > 0${poWhere()}
          ORDER BY status.expected_delivery_date NULLS LAST, po.purchase_order_number LIMIT 2000`, values);
      rows = result.rows.map((row) => ({ number: row.purchase_order_number, supplier: row.supplier, line: row.line_number, item: row.description, expected: dayOf(row.expected_delivery_date),
        ordered: dec(row.ordered_quantity), received: dec(row.received_quantity), remaining: dec(row.remaining_to_receive),
        overdue: row.expected_delivery_date && dayOf(row.expected_delivery_date) < today ? "Overdue" : "", href: `/procurement/purchase-orders/${row.id}?tab=receipts` }));
      if (filters.status === "overdue") rows = rows.filter((row) => row.overdue);
      break;
    }
    case "receiving-discrepancies": {
      columns = [col("number", "Issue"), col("stage", "Custody stage"), col("reason", "Reason"), col("item", "Item"), col("quantity", "Quantity", "number"), col("open", "Open", "number"),
        col("order", "Purchase order"), col("receipt", "GRN"), col("supplier", "Supplier"), col("date", "Found", "date"), col("status", "Status")];
      const list = await listRejections(client, context, { view: filters.status ?? "all", supplierId: filters.supplierId ?? undefined, dateFrom: filters.from ?? undefined,
        dateTo: filters.to ?? undefined });
      rows = list.map((row) => ({ number: row.rejectionNumber, stage: row.stageLabel,
        reason: row.reasonLabel, item: row.description, quantity: dec(row.quantity), open: dec(row.open), order: row.purchaseOrderNumber, receipt: row.receiptNumber ?? "—", supplier: row.supplierName,
        date: dayOf(row.observedAt), status: row.status, href: `/procurement/receiving-issues/${row.id}` }));
      break;
    }
    case "unbilled-goods-receipts": {
      if (!can(context, ...SEE_ORDERS)) break;
      columns = [col("receipt", "Goods receipt"), col("date", "Receipt date", "date"), col("order", "Purchase order"), col("supplier", "Supplier"), col("item", "Item"),
        col("eligible", "Eligible to bill", "number"), col("billed", "Billed", "number"), col("unbilled", "Unbilled", "number")];
      const result = await client.query(
        `SELECT billing.goods_receipt_id, billing.receipt_number, billing.receipt_date, po.id AS order_id, po.purchase_order_number, party.display_name AS supplier, line.description,
                billing.billable_quantity, billing.allocated_quantity, billing.billable_quantity - billing.allocated_quantity AS unbilled
           FROM tenant.goods_receipt_line_billing billing
           JOIN tenant.goods_receipts receipt ON receipt.organization_id = billing.organization_id AND receipt.id = billing.goods_receipt_id
           JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
           JOIN tenant.goods_receipt_lines line ON line.organization_id = billing.organization_id AND line.id = billing.goods_receipt_line_id
           JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
          WHERE billing.organization_id = $1 AND receipt.status = 'posted' AND receipt.reversed_at IS NULL AND billing.billable_quantity > billing.allocated_quantity${poWhere()
            .replace(/po\.order_date/g, "billing.receipt_date")}
          ORDER BY billing.receipt_date, billing.receipt_number LIMIT 2000`, values);
      rows = result.rows.map((row) => ({ receipt: row.receipt_number, date: dayOf(row.receipt_date), order: row.purchase_order_number, supplier: row.supplier, item: row.description,
        eligible: dec(row.billable_quantity), billed: dec(row.allocated_quantity), unbilled: dec(row.unbilled), href: `/procurement/goods-receipts/${row.goods_receipt_id}?tab=billing` }));
      break;
    }
    case "bill-matching-issues": {
      columns = [col("bill", "Bill"), col("invoice", "Supplier invoice"), col("supplier", "Supplier"), col("order", "Purchase order"), col("date", "Invoice date", "date"), col("result", "Matching"),
        col("discrepancy", "Discrepancy"), col("total", "Total", "money")];
      const list = await listSupplierBills(client, context, { view: "matching_issues", supplierId: filters.supplierId ?? undefined, dateFrom: filters.from ?? undefined,
        dateTo: filters.to ?? undefined });
      rows = list.map((row) => ({ bill: row.billNumber, invoice: row.supplierInvoiceNumber, supplier: row.supplierName,
        order: row.purchaseOrderNumber ?? "—", date: row.supplierInvoiceDate, result: statusText(row.twoWayResult), discrepancy: row.discrepancy ?? "", total: row.invoiceTotal, currency: row.currencyCode,
        href: `/procurement/supplier-bills/${row.id}?tab=matching` }));
      break;
    }
    case "bills-due-dates": {
      columns = [col("bill", "Bill"), col("invoice", "Supplier invoice"), col("supplier", "Supplier"), col("installment", "Instalment"), col("due", "Due date", "date"), col("state", "Status"),
        col("scheduled", "Scheduled", "money"), col("outstanding", "Outstanding", "money")];
      const today = await companyToday(client, organizationId);
      const result = await client.query(
        `SELECT schedule.sequence, schedule.due_date, schedule.amount, schedule.outstanding_amount, bill.id, bill.bill_number, bill.supplier_invoice_reference, btrim(bill.currency_code) AS currency,
                party.display_name AS supplier
           FROM tenant.accounting_vendor_bill_schedules schedule JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = schedule.organization_id AND bill.id = schedule.vendor_bill_id
           JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
          WHERE schedule.organization_id = $1 AND bill.bill_type = 'bill' AND bill.status IN ${POSTED_SQL} AND schedule.outstanding_amount > 0
            ${filters.supplierId ? ` AND bill.supplier_id = ${bind(filters.supplierId)}` : ""}${filters.buyingRegistrationId ? ` AND bill.buying_registration_id = ${bind(filters.buyingRegistrationId)}` : ""}
            ${filters.from ? ` AND schedule.due_date >= ${bind(filters.from)}` : ""}${filters.to ? ` AND schedule.due_date <= ${bind(filters.to)}` : ""}
          ORDER BY schedule.due_date, bill.bill_number, schedule.sequence LIMIT 3000`, values);
      rows = result.rows.map((row) => {
        const due = dayOf(row.due_date);
        const state = due < today ? "Overdue" : due === today ? "Due today" : Number(row.outstanding_amount) < Number(row.amount) ? "Partially paid" : "Unpaid";
        return { bill: row.bill_number, invoice: row.supplier_invoice_reference, supplier: row.supplier, installment: row.sequence, due, state, scheduled: dec(row.amount),
          outstanding: dec(row.outstanding_amount), currency: row.currency, href: `/procurement/supplier-bills/${row.id}?tab=payment-schedule` };
      });
      if (filters.status) rows = rows.filter((row) => row.state.toLowerCase().replace(/ /g, "_") === filters.status);
      break;
    }
    case "purchase-return-summary": {
      columns = [col("number", "Return"), col("supplier", "Supplier"), col("order", "Purchase order"), col("date", "Return date", "date"), col("items", "Items", "number"),
        col("quantity", "Quantity", "number"), col("status", "Status"), col("resolution", "Resolution"), col("financial", "Financial")];
      const list = await listPurchaseReturns(client, context, { supplierId: filters.supplierId ?? undefined, status: filters.status ?? undefined, dateFrom: filters.from ?? undefined,
        dateTo: filters.to ?? undefined });
      rows = list.map((row) => ({ number: row.returnNumber, supplier: row.supplierName, order: row.purchaseOrderNumber, date: row.returnDate,
        items: row.items, quantity: row.quantity, status: row.statusLabel, resolution: row.resolutionLabel, financial: row.financialLabel, href: `/procurement/purchase-returns/${row.id}` }));
      break;
    }
    case "pending-supplier-credits": {
      columns = [col("kind", "Source"), col("number", "Document"), col("supplier", "Supplier"), col("date", "Date", "date"), col("status", "Status"), col("pending", "Awaiting credit", "money")];
      const returns = can(context, ...SEE_RETURNS) ? await listPurchaseReturns(client, context, { view: "awaiting_financial", supplierId: filters.supplierId ?? undefined }) : [];
      const claims = can(context, ...SEE_CLAIMS) ? await getSupplierDebitClaims(client, context, { view: "accepted_open", supplierId: filters.supplierId ?? undefined }) : [];
      rows = [
        ...returns.map((row) => ({ kind: "Purchase return", number: row.returnNumber, supplier: row.supplierName, date: row.returnDate, status: row.financialLabel, pending: null,
          href: `/procurement/purchase-returns/${row.id}?tab=financial` })),
        ...claims.filter((claim) => Number(claim.remainingToCredit) > 0).map((claim) => ({ kind: "Accepted debit claim", number: claim.claimNumber, supplier: claim.supplierName, date: claim.issueDate,
          status: claim.statusLabel, pending: claim.remainingToCredit, currency: claim.currencyCode, href: `/procurement/debit-notes-credits/claims/${claim.id}` })),
      ].filter((row) => inRange(row.date, filters));
      break;
    }
    case "vendor-credit-balances": {
      columns = [col("number", "Vendor credit"), col("supplier", "Supplier"), col("date", "Credit date", "date"), col("origin", "Origin"), col("total", "Credit", "money"),
        col("settled", "Applied / refunded", "money"), col("available", "Unapplied", "money"), col("settlement", "Settlement")];
      const list = await getVendorCredits(client, context, { supplierId: filters.supplierId ?? undefined, status: "posted", from: filters.from ?? undefined, to: filters.to ?? undefined });
      rows = list.filter((row) => !filters.status || row.settlementStatus === filters.status).map((row) => ({ number: row.number, supplier: row.supplierName, date: row.date, origin: row.originLabel, total: row.total, settled: row.settled, available: row.available,
        settlement: row.settlementLabel, currency: row.currencyCode, href: `/procurement/debit-notes-credits/vendor-credits/${row.id}` }));
      break;
    }
    // Purchases: posted supplier bills less supplier credit notes (Finance's vendor bills), net of discounts, before tax; per currency.
    case "purchases-by-period":
    case "purchases-by-supplier":
    case "purchases-by-item": {
      const where = `bill.organization_id = $1 AND bill.status IN ('posted','partially_paid','paid','overdue','disputed') AND bill.bill_type IN ('bill','credit_note')`
        + `${filters.supplierId ? ` AND bill.party_id = (SELECT party_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = ${bind(filters.supplierId)})` : ""}`
        + `${filters.from ? ` AND bill.bill_date >= ${bind(filters.from)}` : ""}${filters.to ? ` AND bill.bill_date <= ${bind(filters.to)}` : ""}`;
      const sign = "CASE WHEN bill.bill_type = 'credit_note' THEN -1 ELSE 1 END";
      if (name === "purchases-by-period") {
        columns = [col("period", "Month"), col("bills", "Bills", "number"), col("credits", "Credit notes", "number"), col("net", "Net purchases", "money"), col("tax", "Tax", "money"),
          col("total", "Total", "money")];
        const result = await client.query(
          `SELECT to_char(date_trunc('month', bill.bill_date), 'YYYY-MM') AS period, bill.currency_code, count(*) FILTER (WHERE bill.bill_type = 'bill') AS bills,
                  count(*) FILTER (WHERE bill.bill_type = 'credit_note') AS credits, sum(${sign} * (bill.subtotal - bill.discount_total)) AS net,
                  sum(${sign} * bill.tax_total) AS tax, sum(${sign} * bill.grand_total) AS total
             FROM tenant.accounting_vendor_bills bill WHERE ${where} GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 500`, values);
        rows = result.rows.map((row) => ({ period: row.period, bills: Number(row.bills), credits: Number(row.credits), net: dec(row.net), tax: dec(row.tax), total: dec(row.total),
          currency: row.currency_code?.trim(), href: "/procurement/supplier-bills" }));
      } else if (name === "purchases-by-supplier") {
        columns = [col("supplier", "Supplier"), col("bills", "Bills", "number"), col("net", "Net purchases", "money"), col("total", "Total", "money"), col("outstanding", "Outstanding", "money"),
          col("last", "Last bill", "date")];
        const result = await client.query(
          `SELECT supplier.id AS supplier_id, COALESCE(party.display_name, bill.supplier_snapshot->>'supplierName') AS supplier, bill.currency_code,
                  count(*) FILTER (WHERE bill.bill_type = 'bill') AS bills, sum(${sign} * (bill.subtotal - bill.discount_total)) AS net, sum(${sign} * bill.grand_total) AS total,
                  sum(bill.outstanding_amount) FILTER (WHERE bill.bill_type = 'bill') AS outstanding, max(bill.bill_date) AS last_bill
             FROM tenant.accounting_vendor_bills bill
             LEFT JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
             LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = bill.organization_id AND supplier.party_id = bill.party_id
            WHERE ${where} GROUP BY supplier.id, 2, bill.currency_code ORDER BY net DESC LIMIT 500`, values);
        rows = result.rows.map((row) => ({ supplier: row.supplier, bills: Number(row.bills), net: dec(row.net), total: dec(row.total), outstanding: dec(row.outstanding ?? 0),
          last: dayOf(row.last_bill), currency: row.currency_code?.trim(), href: row.supplier_id ? `/procurement/suppliers/${row.supplier_id}` : "/procurement/supplier-bills" }));
      } else {
        columns = [col("code", "SKU"), col("item", "Item"), col("bills", "Bills", "number"), col("quantity", "Quantity", "number"), col("net", "Net purchases", "money"), col("total", "Total", "money")];
        const result = await client.query(
          `SELECT line.item_id, item.code, COALESCE(item.name, line.description) AS item, bill.currency_code, count(DISTINCT bill.id) FILTER (WHERE bill.bill_type = 'bill') AS bills,
                  sum(${sign} * line.quantity) AS quantity, sum(${sign} * line.net_amount) AS net, sum(${sign} * line.line_total) AS total
             FROM tenant.accounting_vendor_bills bill
             JOIN tenant.accounting_vendor_bill_lines line ON line.organization_id = bill.organization_id AND line.vendor_bill_id = bill.id
             LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
            WHERE ${where} GROUP BY line.item_id, item.code, item.name, line.description, bill.currency_code ORDER BY net DESC LIMIT 500`, values);
        rows = result.rows.map((row) => ({ code: row.code ?? "—", item: row.item, bills: Number(row.bills), quantity: dec(row.quantity), net: dec(row.net), total: dec(row.total),
          currency: row.currency_code?.trim(), href: row.item_id ? `/inventory/items/${row.item_id}` : "/procurement/supplier-bills" }));
      }
      break;
    }
    default:
      break;
  }
  return { key: report.key, title: report.title, description: report.description, columns, rows, filters };
}

// ---------------------------------------------------------------- invoice matching workbench
// One place for 2-Way (PO ↔ bill) and 3-Way (PO ↔ GRN ↔ bill) matching: every PO-based supplier bill with its latest evaluation — the
// scope, the result, ordered, received and billed quantities of the lines it bills, the value expected and billed, the variance and the
// variances approved on it (Exceptions: bills whose match fails). Matching itself runs on the bill (recheck, approve an exception); this lists and opens.
// filters: view (all | two_way | three_way | matched | exceptions), supplierId, search.
export const INVOICE_MATCHING_VIEWS = Object.freeze([
  { key: "all", label: "All bills" }, { key: "two_way", label: "2-Way match" }, { key: "three_way", label: "3-Way match" },
  { key: "matched", label: "Matched" }, { key: "exceptions", label: "Exceptions" },
]);
export async function getInvoiceMatchingWorkbench(client, context, filters = {}) {
  if (!can(context, ...SEE_BILLS)) throw new PurchaseOrderError(403, "You do not have permission to view supplier bill matching.", "PERMISSION_DENIED");
  const view = INVOICE_MATCHING_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "all";
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  const where = ["bill.organization_id = $1", "bill.source_purchase_order_id IS NOT NULL", "bill.status NOT IN ('cancelled', 'reversed')", "bill.bill_type = 'bill'"];
  if (isUuid(filters.supplierId)) where.push(`bill.party_id = (SELECT party_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = ${bind(filters.supplierId)})`);
  const search = String(filters.search ?? "").trim();
  if (search) where.push(`lower(concat_ws(' ', bill.bill_number, bill.supplier_invoice_number, po.purchase_order_number, party.display_name)) LIKE ${bind(`%${search.toLowerCase()}%`)}`);
  const { rows } = await client.query(
    `SELECT bill.id, bill.bill_number, bill.supplier_invoice_number, bill.bill_date, bill.status, bill.matching_status, bill.currency_code, bill.grand_total,
            po.id AS po_id, po.purchase_order_number, party.display_name AS supplier,
            evaluation.match_scope, evaluation.result, evaluation.expected_amount, evaluation.actual_amount, evaluation.variance_amount, evaluation.evaluated_at,
            (SELECT count(*) FROM tenant.supplier_bill_match_exceptions exception WHERE exception.organization_id = bill.organization_id AND exception.vendor_bill_id = bill.id
               AND exception.status = 'approved') AS approved_exceptions,
            quantities.ordered, quantities.received, quantities.billed
       FROM tenant.accounting_vendor_bills bill
       JOIN tenant.purchase_orders po ON po.organization_id = bill.organization_id AND po.id = bill.source_purchase_order_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
       LEFT JOIN LATERAL (SELECT * FROM tenant.supplier_bill_match_evaluations entry WHERE entry.organization_id = bill.organization_id AND entry.vendor_bill_id = bill.id
                           ORDER BY entry.evaluated_at DESC LIMIT 1) evaluation ON true
       LEFT JOIN LATERAL (
         SELECT sum(status.ordered_quantity) AS ordered, sum(status.received_quantity) AS received, sum(line.quantity) AS billed
           FROM tenant.accounting_vendor_bill_lines line
           LEFT JOIN tenant.purchase_order_line_status status ON status.organization_id = line.organization_id AND status.purchase_order_line_id = line.purchase_order_line_id
          WHERE line.organization_id = bill.organization_id AND line.vendor_bill_id = bill.id AND line.purchase_order_line_id IS NOT NULL) quantities ON true
      WHERE ${where.join(" AND ")}
      ORDER BY bill.bill_date DESC, bill.bill_number DESC LIMIT 1000`, values);
  const list = rows.map((row) => {
    const approvedVariances = Number(row.approved_exceptions);
    const result = row.result ?? (row.matching_status === "pending" ? "pending_receipt" : row.matching_status === "exception" ? "mismatch" : row.matching_status === "matched" ? "matched" : null);
    return {
      id: row.id, billNumber: row.bill_number, supplierInvoiceNumber: row.supplier_invoice_number, billDate: dayOf(row.bill_date), status: row.status, supplier: row.supplier,
      purchaseOrderId: row.po_id, purchaseOrderNumber: row.purchase_order_number, scope: row.match_scope ?? null, result, approvedVariances,
      ordered: dec(row.ordered ?? 0), received: dec(row.received ?? 0), billed: dec(row.billed ?? 0),
      expected: dec(row.expected_amount), actual: dec(row.actual_amount), variance: dec(row.variance_amount), currency: row.currency_code?.trim(), evaluatedAt: row.evaluated_at,
      href: `/procurement/supplier-bills/${row.id}?tab=matching`, orderHref: `/procurement/purchase-orders/${row.po_id}`,
    };
  });
  const counts = Object.fromEntries(INVOICE_MATCHING_VIEWS.map((entry) => [entry.key, list.filter((row) => inView(row, entry.key)).length]));
  return { rows: list.filter((row) => inView(row, view)), counts, views: INVOICE_MATCHING_VIEWS, view };
}
const inView = (row, view) => view === "all" || (view === "two_way" && row.scope === "two_way") || (view === "three_way" && row.scope === "three_way")
  || (view === "matched" && ["matched", "approved_exception"].includes(row.result)) || (view === "exceptions" && row.result === "mismatch");
