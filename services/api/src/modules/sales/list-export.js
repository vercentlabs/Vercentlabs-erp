// Export on every Sales list (CRM parity: every CRM list exports what it shows, or just the rows ticked). The list is read through its
// own function with the filters on screen — so the caller's scope and permission to see it apply unchanged — up to 5,000 rows, and
// written as CSV; `ids` keeps only the ticked rows. Each list says which of its columns go out and how.
import { listSalesInvoices } from "./invoices/index.js";
import { listSalesPayments } from "./invoices/payments.js";
import { listCreditNotes } from "./credit-notes/index.js";
import { listDeliveries } from "./deliveries/index.js";
import { listSalesReturns } from "./returns/index.js";
import { companyToday } from "./today.js";
import { SalesError } from "./index.js";

const LIMIT = 5000;
const PAGE = 100;
const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : "");
const cell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  // A leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const LISTS = Object.freeze({
  invoices: { list: listSalesInvoices, file: "invoices", columns: [
    ["Invoice", (row) => row.invoice_number], ["Date", (row) => day(row.invoice_date)], ["Due", (row) => day(row.due_date)], ["Customer", (row) => row.customer_name],
    ["Customer number", (row) => row.customer_number], ["Sales order", (row) => row.sales_order_number], ["Salesperson", (row) => row.owner_name], ["Currency", (row) => row.currency_code],
    ["Total", (row) => row.grand_total], ["Balance due", (row) => row.balance_due], ["Status", (row) => row.statusLabel], ["Payment", (row) => row.paymentStatusLabel],
    ["Overdue", (row) => (row.overdue ? "Yes" : "")], ["Credited", (row) => row.credited_total || ""], ["Payment terms", (row) => row.payment_term_name], ["Sent", (row) => day(row.sent_at)],
  ] },
  "credit-notes": { list: listCreditNotes, file: "credit-notes", columns: [
    ["Credit note", (row) => row.invoice_number], ["Date", (row) => day(row.invoice_date)], ["Customer", (row) => row.customer_name], ["Customer number", (row) => row.customer_number],
    ["Against invoice", (row) => row.source_invoice_number], ["Sales order", (row) => row.sales_order_number], ["Return", (row) => row.return_number], ["Reason", (row) => row.reasonLabel],
    ["Currency", (row) => row.currency_code], ["Total", (row) => row.grand_total], ["Tax", (row) => row.tax_total], ["Applied", (row) => row.applied ?? ""],
    ["Not applied", (row) => row.unapplied ?? ""], ["Refunded", (row) => row.refunded ?? ""], ["Status", (row) => row.statusLabel],
  ] },
  deliveries: { list: listDeliveries, file: "deliveries", columns: [
    ["Delivery", (row) => row.delivery_number], ["Sales order", (row) => row.sales_order_number], ["Customer", (row) => row.customer_name], ["Customer PO", (row) => row.customer_po_number],
    ["Warehouse", (row) => row.warehouse_name], ["Ship to", (row) => row.ship_to_label ?? row.ship_to_city], ["Dispatched", (row) => day(row.dispatch_date)],
    ["Expected", (row) => day(row.expected_delivery_date)], ["Delivered", (row) => day(row.delivered_at)], ["Carrier", (row) => row.carrier], ["Tracking number", (row) => row.tracking_number],
    ["Lines", (row) => row.line_count], ["Quantity", (row) => row.total_quantity], ["Status", (row) => row.statusLabel],
  ] },
  returns: { list: listSalesReturns, file: "returns", columns: [
    ["Return", (row) => row.return_number], ["Date", (row) => day(row.return_date)], ["Customer", (row) => row.customer_name], ["Sales order", (row) => row.sales_order_number],
    ["Delivery", (row) => row.delivery_number], ["Warehouse", (row) => row.warehouse_name], ["Reason", (row) => row.reasonLabel], ["Lines", (row) => row.line_count],
    ["Quantity", (row) => row.total_quantity], ["Invoices", (row) => row.invoice_numbers], ["Credit notes", (row) => row.credit_note_numbers], ["Credit", (row) => row.creditStatusLabel],
    ["Status", (row) => row.statusLabel],
  ] },
  payments: { list: listSalesPayments, file: "payments", columns: [
    ["Receipt", (row) => row.receipt_number], ["Date", (row) => day(row.receipt_date)], ["Customer", (row) => row.customer_name], ["Method", (row) => row.methodLabel],
    ["Reference", (row) => row.external_reference], ["Currency", (row) => row.currency_code], ["Amount", (row) => row.amount], ["Not applied", (row) => row.unapplied_amount || ""],
    ["Invoices", (row) => (row.invoices ?? []).map((invoice) => `${invoice.number} (${Number(invoice.amount).toFixed(2)})`).join("; ")],
  ] },
});

export const EXPORTABLE_LISTS = Object.freeze(Object.keys(LISTS));

// kind: invoices | credit-notes | deliveries | returns | payments. filters: the list's own; filters.ids: "id,id,…" for the ticked rows.
// Returns { csv, fileName, rows }.
export async function exportSalesList(client, context, kind, filters = {}) {
  const spec = LISTS[kind];
  if (!spec) throw new SalesError(404, "This list cannot be exported.", "SALES_EXPORT_UNKNOWN");
  const ids = new Set(String(filters.ids ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  const { ids: _ids, limit: _limit, offset: _offset, ...rest } = filters;
  const rows = [];
  for (let offset = 0; offset < LIMIT; offset += PAGE) {
    const page = await spec.list(client, context, { ...rest, limit: PAGE, offset });
    rows.push(...(ids.size ? page.rows.filter((row) => ids.has(row.id)) : page.rows));
    if (page.rows.length < PAGE || (ids.size && rows.length >= ids.size)) break;
  }
  const lines = [spec.columns.map(([label]) => cell(label)).join(","), ...rows.map((row) => spec.columns.map(([, value]) => cell(value(row))).join(","))];
  return { csv: `${lines.join("\r\n")}\r\n`, fileName: `${spec.file}-${await companyToday(client)}.csv`, rows: rows.length };
}
