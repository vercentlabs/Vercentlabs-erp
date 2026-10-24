// Purchase analysis (Procurement report Phase 3): what suppliers billed, grouped by any one or two of supplier, item, category, buyer,
// supplier's state and month — a pivot with totals each way and an Excel copy. Billed means final supplier bills and debit notes less
// credit notes, at their taxable value in the company's currency, by accounting date. A category is the item's category, or a direct
// bill's expense category.
import { buildXlsxWorkbook } from "../../../core/platform/data-exchange/xlsx.js";
import { companyToday } from "../../../core/payment-terms/index.js";
import { poCan } from "../purchase-orders/access.js";
import { PurchaseOrderError } from "../purchase-orders/constants.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATE = "COALESCE(NULLIF(bill.supplier_tax_snapshot->>'stateCode', ''), NULLIF(bill.supplier_address_snapshot->>'stateCode', ''))";
export const PURCHASE_ANALYSIS_DIMENSIONS = Object.freeze({
  supplier: { label: "Supplier", key: "party.id::text", name: "party.display_name" },
  item: { label: "Item", key: "COALESCE(line.item_id::text, line.description, '')", name: "COALESCE(item.name, line.description, 'Other')" },
  category: { label: "Category", key: "COALESCE(category.id::text, expense.id::text, 'none')", name: "COALESCE(category.name, expense.name, 'No category')" },
  buyer: { label: "Buyer", key: "COALESCE(purchase_order.buyer_user_id::text, 'none')", name: "COALESCE(buyer.full_name, 'No buyer')" },
  state: { label: "Supplier's state", key: `COALESCE(${STATE}, '')`, name: `COALESCE(${STATE}, 'Not set')` },
  month: { label: "Month", key: "to_char(bill.accounting_date, 'YYYY-MM')", name: "to_char(bill.accounting_date, 'Mon YYYY')" },
});
const SIGN = "CASE WHEN bill.bill_type = 'credit_note' THEN -1 ELSE 1 END";
export const PURCHASE_ANALYSIS_MEASURES = Object.freeze({
  amount: { label: "Billed (taxable value)", sql: `sum(${SIGN} * line.net_amount * COALESCE(bill.exchange_rate, 1))` },
  quantity: { label: "Quantity", sql: `sum(${SIGN} * line.quantity)` },
  bills: { label: "Bills", sql: "count(DISTINCT bill.id) FILTER (WHERE bill.bill_type = 'bill')" },
});
const round = (value) => Math.round(Number(value) * 100) / 100;

// options: { rows, columns?, measure?, from?, to? }. Returns { rows: [{ key, label, total }], columns: [{ key, label, total }], cells, total }.
export async function getPurchaseAnalysis(client, context, options = {}) {
  if (!poCan(context, "procurement.reports.view") && !poCan(context, "procurement.bills.view") && !poCan(context, "accounting.payables.manage"))
    throw new PurchaseOrderError(403, "You do not have permission to see purchase reports.", "PERMISSION_DENIED");
  const rowDim = PURCHASE_ANALYSIS_DIMENSIONS[options.rows] ? options.rows : "supplier";
  const columnDim = options.columns && PURCHASE_ANALYSIS_DIMENSIONS[options.columns] && options.columns !== rowDim ? options.columns : null;
  const measure = PURCHASE_ANALYSIS_MEASURES[options.measure] ? options.measure : "amount";
  const today = await companyToday(client, context.organizationId);
  const year = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const from = DATE.test(String(options.from ?? "")) ? options.from : `${year}-04-01`;
  const to = DATE.test(String(options.to ?? "")) ? options.to : today;
  if (from > to) throw new PurchaseOrderError(400, "The start date is after the end date.", "PURCHASE_ANALYSIS_INVALID", { issues: [{ field: "from", message: "Start before the end." }] });
  const row = PURCHASE_ANALYSIS_DIMENSIONS[rowDim];
  const column = columnDim ? PURCHASE_ANALYSIS_DIMENSIONS[columnDim] : { key: "'total'", name: "'Total'" };
  const { rows } = await client.query(
    `SELECT ${row.key} AS row_key, min(${row.name}) AS row_label, ${column.key} AS column_key, min(${column.name}) AS column_label, ${PURCHASE_ANALYSIS_MEASURES[measure].sql} AS value
       FROM tenant.accounting_vendor_bill_lines line
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id AND bill.id = line.vendor_bill_id
       JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
       LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = item.group_id
       LEFT JOIN tenant.expense_categories expense ON expense.organization_id = line.organization_id AND expense.id = line.expense_category_id
       LEFT JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = bill.organization_id AND purchase_order.id = bill.source_purchase_order_id
       LEFT JOIN public.users buyer ON buyer.id = purchase_order.buyer_user_id
      WHERE line.organization_id = $1 AND bill.posted_at IS NOT NULL AND bill.bill_type IN ('bill', 'debit_note', 'credit_note')
        AND bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed') AND bill.accounting_date BETWEEN $2::date AND $3::date
      GROUP BY 1, 3`, [context.organizationId, from, to]);
  const rowMap = new Map();
  const columnMap = new Map();
  const cells = {};
  let total = 0;
  for (const entry of rows) {
    const value = round(entry.value ?? 0);
    const r = rowMap.get(entry.row_key) ?? { key: entry.row_key, label: entry.row_label ?? "—", total: 0 };
    const c = columnMap.get(entry.column_key) ?? { key: entry.column_key, label: entry.column_label ?? "—", total: 0 };
    r.total = round(r.total + value);
    c.total = round(c.total + value);
    total = round(total + value);
    rowMap.set(entry.row_key, r);
    columnMap.set(entry.column_key, c);
    (cells[entry.row_key] ??= {})[entry.column_key] = round((cells[entry.row_key][entry.column_key] ?? 0) + value);
  }
  const byMonth = (a, b) => String(a.key).localeCompare(String(b.key));
  const byTotal = (a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label));
  const rowList = [...rowMap.values()].sort(rowDim === "month" ? byMonth : byTotal);
  const columnList = [...columnMap.values()].sort(columnDim === "month" ? byMonth : byTotal);
  return {
    from, to, rowsBy: rowDim, columnsBy: columnDim, measure, measureLabel: PURCHASE_ANALYSIS_MEASURES[measure].label,
    dimensions: Object.entries(PURCHASE_ANALYSIS_DIMENSIONS).map(([key, entry]) => ({ key, label: entry.label })),
    measures: Object.entries(PURCHASE_ANALYSIS_MEASURES).map(([key, entry]) => ({ key, label: entry.label })),
    rows: rowList.slice(0, 500), columns: columnList.slice(0, 60), cells, total, truncated: rowList.length > 500 || columnList.length > 60,
  };
}

// The same as an Excel workbook: one row per row group, one column per column group, and the totals.
export async function exportPurchaseAnalysis(client, context, options = {}) {
  const analysis = await getPurchaseAnalysis(client, context, options);
  const columns = [{ key: "label", label: PURCHASE_ANALYSIS_DIMENSIONS[analysis.rowsBy].label },
    ...(analysis.columnsBy ? analysis.columns.map((column, index) => ({ key: `c${index}`, label: column.label })) : []), { key: "total", label: "Total" }];
  const rows = analysis.rows.map((row) => ({
    label: row.label, total: row.total,
    ...Object.fromEntries((analysis.columnsBy ? analysis.columns : []).map((column, index) => [`c${index}`, analysis.cells[row.key]?.[column.key] ?? 0])),
  }));
  rows.push({ label: "Total", total: analysis.total, ...Object.fromEntries((analysis.columnsBy ? analysis.columns : []).map((column, index) => [`c${index}`, column.total])) });
  return { fileName: `purchase-analysis-${analysis.from}-to-${analysis.to}.xlsx`, body: buildXlsxWorkbook({ sheetName: "Analysis", columns, rows }) };
}
