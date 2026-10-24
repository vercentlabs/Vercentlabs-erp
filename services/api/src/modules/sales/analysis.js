// Sales analysis (Sales report Phase 3): what was billed, grouped by any one or two of customer, product, salesperson, beat, state and
// month — a pivot like Odoo's, with totals each way and an Excel copy. Billed means final invoices and debit notes less credit notes, at
// their taxable value in the company's currency. Someone without "see all invoices" sees their own customers' sales only.
import { buildXlsxWorkbook } from "../../core/platform/data-exchange/xlsx.js";
import { SalesError } from "./index.js";
import { companyToday } from "./today.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));

export const ANALYSIS_DIMENSIONS = Object.freeze({
  customer: { label: "Customer", key: "party.id::text", name: "party.display_name" },
  product: { label: "Product", key: "COALESCE(line.item_id::text, line.description)", name: "COALESCE(sales_line.item_name_snapshot, line.description)" },
  salesperson: { label: "Salesperson", key: "COALESCE(sales.owner_user_id::text, 'none')", name: "COALESCE(owner.full_name, 'No salesperson')" },
  beat: { label: "Beat", key: "COALESCE(party.sales_route_id::text, 'none')", name: "COALESCE(route.name, 'No beat')" },
  state: { label: "State", key: "COALESCE(invoice.place_of_supply, '')", name: "COALESCE(NULLIF(invoice.place_of_supply, ''), 'Not set')" },
  month: { label: "Month", key: "to_char(invoice.invoice_date, 'YYYY-MM')", name: "to_char(invoice.invoice_date, 'Mon YYYY')" },
});
export const ANALYSIS_MEASURES = Object.freeze({
  amount: { label: "Billed (taxable value)", sql: "sum(CASE WHEN invoice.invoice_type = 'credit_note' THEN -1 ELSE 1 END * line.net_amount * COALESCE(invoice.exchange_rate, 1))" },
  quantity: { label: "Quantity", sql: "sum(CASE WHEN invoice.invoice_type = 'credit_note' THEN -1 ELSE 1 END * line.quantity)" },
  invoices: { label: "Invoices", sql: "count(DISTINCT invoice.id) FILTER (WHERE invoice.invoice_type = 'invoice')" },
});
const round = (value) => Math.round(Number(value) * 100) / 100;

// options: { rows, columns?, measure?, from?, to? }. Returns { rows: [{ key, label, total }], columns: [{ key, label, total }], cells: { rowKey: { columnKey: value } }, total }.
export async function getSalesAnalysis(client, context, options = {}) {
  if (!can(context, "sales.reports.view")) throw new SalesError(403, "You do not have permission to see Sales reports.", "PERMISSION_DENIED");
  const rowDim = ANALYSIS_DIMENSIONS[options.rows] ? options.rows : "customer";
  const columnDim = options.columns && ANALYSIS_DIMENSIONS[options.columns] && options.columns !== rowDim ? options.columns : null;
  const measure = ANALYSIS_MEASURES[options.measure] ? options.measure : "amount";
  const today = await companyToday(client);
  const year = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const from = DATE.test(String(options.from ?? "")) ? options.from : `${year}-04-01`;
  const to = DATE.test(String(options.to ?? "")) ? options.to : today;
  if (from > to) throw new SalesError(400, "The start date is after the end date.", "SALES_ANALYSIS_INVALID", { field: "from" });
  const values = [context.organizationId, from, to];
  const own = can(context, "sales.invoice.view_all") ? "" : (values.push(context.userId ?? null), ` AND (sales.owner_user_id = $${values.length} OR party.owner_user_id = $${values.length})`);
  const row = ANALYSIS_DIMENSIONS[rowDim];
  const column = columnDim ? ANALYSIS_DIMENSIONS[columnDim] : { key: "'total'", name: "'Total'" };
  const { rows } = await client.query(
    `SELECT ${row.key} AS row_key, min(${row.name}) AS row_label, ${column.key} AS column_key, min(${column.name}) AS column_label, ${ANALYSIS_MEASURES[measure].sql} AS value
       FROM tenant.accounting_customer_invoice_lines line
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.customer_invoice_id
       JOIN tenant.business_parties party ON party.organization_id = invoice.organization_id AND party.id = invoice.party_id
       LEFT JOIN tenant.sales_routes route ON route.organization_id = party.organization_id AND route.id = party.sales_route_id
       LEFT JOIN tenant.sales_invoice_lines sales_line ON sales_line.customer_invoice_line_id = line.id
       LEFT JOIN tenant.sales_invoices sales ON sales.organization_id = invoice.organization_id AND sales.customer_invoice_id = COALESCE(invoice.source_invoice_id, invoice.id)
       LEFT JOIN public.users owner ON owner.id = sales.owner_user_id
      WHERE line.organization_id = $1 AND invoice.posted_at IS NOT NULL AND invoice.invoice_type IN ('invoice', 'debit_note', 'credit_note')
        AND invoice.status NOT IN ('reversed', 'cancelled', 'draft') AND invoice.invoice_date BETWEEN $2::date AND $3::date${own}
      GROUP BY 1, 3`, values);
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
    from, to, rowsBy: rowDim, columnsBy: columnDim, measure, measureLabel: ANALYSIS_MEASURES[measure].label,
    rows: rowList.slice(0, 500), columns: columnList.slice(0, 60), cells, total, truncated: rowList.length > 500 || columnList.length > 60,
  };
}

// The same as an Excel workbook: one row per row group, one column per column group, and the totals.
export async function exportSalesAnalysis(client, context, options = {}) {
  const analysis = await getSalesAnalysis(client, context, options);
  const columns = [{ key: "label", label: ANALYSIS_DIMENSIONS[analysis.rowsBy].label }, ...(analysis.columnsBy ? analysis.columns.map((column, index) => ({ key: `c${index}`, label: column.label })) : []),
    { key: "total", label: "Total" }];
  const rows = analysis.rows.map((row) => ({
    label: row.label, total: row.total,
    ...Object.fromEntries((analysis.columnsBy ? analysis.columns : []).map((column, index) => [`c${index}`, analysis.cells[row.key]?.[column.key] ?? 0])),
  }));
  rows.push({ label: "Total", total: analysis.total, ...Object.fromEntries((analysis.columnsBy ? analysis.columns : []).map((column, index) => [`c${index}`, column.total])) });
  return { fileName: `sales-analysis-${analysis.from}-to-${analysis.to}.xlsx`, body: buildXlsxWorkbook({ sheetName: "Analysis", columns, rows }) };
}
