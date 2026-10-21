// Recording a customer's payment from Sales (Sales audit B7). A company with Sales but not the Accounting app still takes payments: the
// invoice's Record Payment writes the receipt to the ledger (posted, into the chosen bank or cash account) and applies it to the invoice,
// so the invoice is Paid or Partly paid and the order's balance clears. With the Accounting app the same receipt appears there.
import { allocateCustomerReceipt, createCustomerReceipt, postCustomerReceipt } from "../../accounting/receivables.js";
import { companyToday } from "../today.js";
import { invoiceCan, invoiceScopeSql } from "./access.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "./constants.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = Object.freeze({ cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer (NEFT/RTGS/IMPS)", cheque: "Cheque", card: "Card", other: "Other" });
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

// Finance writes the receipt on Sales' behalf: the Sales permission checked here authorises it.
const receiptContext = (context) => ({
  organizationId: context.organizationId, userId: context.userId ?? null, roleSlugs: [],
  permissions: ["accounting.view", "accounting.receivables.manage", "accounting.receipts.manage"],
});

function requirePaymentPermission(context) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.recordPayment) && !invoiceCan(context, "accounting.receipts.manage"))
    throw new InvoiceError(403, "You do not have permission to record payments.", "PERMISSION_DENIED");
}

// The accounts a payment can be received into (bank and cash), and the ways of paying.
export async function listPaymentAccounts(client, context) {
  requirePaymentPermission(context);
  const accounts = (await client.query(
    `SELECT bank.id, bank.code, bank.account_name, bank.bank_name, bank.account_type, bank.currency_code
       FROM tenant.accounting_bank_accounts bank WHERE bank.organization_id = $1 AND bank.status = 'active' ORDER BY bank.account_type, bank.account_name`,
    [context.organizationId])).rows;
  return {
    accounts: accounts.map((row) => ({ id: row.id, code: row.code, name: row.account_name || row.bank_name || row.code, type: row.account_type, currencyCode: String(row.currency_code ?? "").trim() || null })),
    methods: Object.entries(METHODS).map(([code, label]) => ({ code, label })),
  };
}

// input: { amount, receiptDate?, paymentMethod?, reference?, bankAccountId? (else the company's bank account),
//          tdsAmount?, tdsSection? — TDS the customer deducted (194Q, 194J…): it settles that part of the invoice against TDS receivable }
export async function recordInvoicePayment(client, context, invoiceId, input = {}) {
  requirePaymentPermission(context);
  if (!UUID.test(String(invoiceId ?? ""))) throw new InvoiceError(404, "Invoice not found.", "SALES_INVOICE_NOT_FOUND");
  const invoice = (await client.query(
    `SELECT id, invoice_number, party_id, currency_code, outstanding_amount, status, invoice_type FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, invoiceId])).rows[0];
  if (!invoice || invoice.invoice_type !== "invoice") throw new InvoiceError(404, "Invoice not found.", "SALES_INVOICE_NOT_FOUND");
  if (!["posted", "partially_paid", "overdue", "disputed"].includes(invoice.status))
    throw new InvoiceError(409, invoice.status === "paid" ? "This invoice is already paid." : "Post the invoice before recording a payment.", "SALES_INVOICE_NOT_PAYABLE");
  const amount = Math.round(Number(input.amount) * 100) / 100;
  const outstanding = Number(invoice.outstanding_amount);
  if (!(amount > 0)) throw new InvoiceError(400, "Enter the amount received.", "SALES_PAYMENT_INVALID", { field: "amount" });
  const tds = Math.round(Number(input.tdsAmount ?? 0) * 100) / 100;
  if (!Number.isFinite(tds) || tds < 0) throw new InvoiceError(400, "Enter the TDS deducted (0 or more).", "SALES_PAYMENT_INVALID", { field: "tdsAmount" });
  if (amount + tds > outstanding + 0.005)
    throw new InvoiceError(409, `The invoice has ${outstanding.toFixed(2)} left to pay. Record more than that in Accounting as an advance.`, "SALES_PAYMENT_TOO_MUCH", { field: "amount" });
  const today = await companyToday(client);
  const receiptDate = input.receiptDate ? String(input.receiptDate).slice(0, 10) : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate) || receiptDate > today) throw new InvoiceError(400, "Enter the date the payment was received (not in the future).", "SALES_PAYMENT_INVALID", { field: "receiptDate" });
  const method = METHODS[input.paymentMethod] ? input.paymentMethod : "bank_transfer";
  const finance = receiptContext(context);
  let receipt;
  try {
    receipt = await createCustomerReceipt(client, finance, {
      partyId: invoice.party_id, receiptDate, currencyCode: String(invoice.currency_code).trim(), amount, paymentMethod: method,
      externalReference: text(input.reference) || null, bankAccountId: input.bankAccountId || null,
    });
    receipt = await postCustomerReceipt(client, finance, receipt.id);
    await allocateCustomerReceipt(client, finance, receipt.id, { allocations: [{ invoiceId: invoice.id, receiptAmount: amount, invoiceAmount: amount,
      ...(tds > 0 ? { withholdingAmount: tds, withholdingSection: String(input.tdsSection ?? "").trim().slice(0, 20) || null } : {}) }] });
  } catch (error) {
    if (error?.name !== "AccountingError") throw error;
    throw new InvoiceError(error.status ?? 409, `The payment could not be recorded: ${error.message}`, error.code ?? "SALES_PAYMENT_REFUSED");
  }
  const after = (await client.query("SELECT outstanding_amount, status FROM tenant.accounting_customer_invoices WHERE id = $1", [invoice.id])).rows[0];
  return { receiptId: receipt.id, receiptNumber: receipt.receipt_number, amount, tds, outstanding: Number(after.outstanding_amount), status: after.status };
}

// Payments received (Line-by-line audit: the most common document after an invoice had no list in Sales). Each receipt with the invoices
// it paid. A person who sees only some orders sees the payments applied to those orders' invoices; advances not yet applied need the
// view-all permission. filters: { search, from, to, limit, offset }
export async function listSalesPayments(client, context, filters = {}) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.paymentsView)) throw new InvoiceError(403, "You do not have permission to see payments.", "PERMISSION_DENIED");
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = "receipt.organization_id = $1 AND receipt.status <> 'draft'";
  const scope = invoiceScopeSql(context, values, "scoped_order");
  if (scope) where += ` AND EXISTS (SELECT 1 FROM tenant.accounting_customer_receipt_allocations allocation
      JOIN tenant.sales_invoices scoped_invoice ON scoped_invoice.organization_id = allocation.organization_id AND scoped_invoice.customer_invoice_id = allocation.customer_invoice_id
      JOIN tenant.sales_orders scoped_order ON scoped_order.organization_id = scoped_invoice.organization_id AND scoped_order.id = scoped_invoice.sales_order_id
     WHERE allocation.organization_id = receipt.organization_id AND allocation.receipt_id = receipt.id${scope})`;
  const search = text(filters.search, 100).toLowerCase();
  if (search) where += ` AND lower(concat_ws(' ', receipt.receipt_number, receipt.external_reference, party.display_name)) LIKE ${bind(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`;
  const day = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null);
  if (day(filters.from)) where += ` AND receipt.receipt_date >= ${bind(day(filters.from))}::date`;
  if (day(filters.to)) where += ` AND receipt.receipt_date <= ${bind(day(filters.to))}::date`;
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const { rows } = await client.query(
    `SELECT count(*) OVER () AS total_count, receipt.id, receipt.receipt_number, receipt.receipt_date::text AS receipt_date, receipt.amount, btrim(receipt.currency_code) AS currency_code,
            receipt.payment_method, receipt.external_reference, receipt.status, receipt.unapplied_amount, receipt.party_id, party.display_name AS customer_name,
            (SELECT json_agg(json_build_object('id', invoice.id, 'number', invoice.invoice_number, 'amount', allocation.allocated_amount) ORDER BY invoice.invoice_number)
               FROM tenant.accounting_customer_receipt_allocations allocation
               JOIN tenant.accounting_customer_invoices invoice ON invoice.id = allocation.customer_invoice_id
              WHERE allocation.organization_id = receipt.organization_id AND allocation.receipt_id = receipt.id) AS invoices
       FROM tenant.accounting_customer_receipts receipt
       LEFT JOIN tenant.business_parties party ON party.organization_id = receipt.organization_id AND party.id = receipt.party_id
      WHERE ${where}
      ORDER BY receipt.receipt_date DESC, receipt.receipt_number DESC LIMIT ${limit} OFFSET ${offset}`, values);
  return {
    rows: rows.map(({ total_count: _total, ...row }) => ({ ...row, amount: Number(row.amount), unapplied_amount: Number(row.unapplied_amount), methodLabel: METHODS[row.payment_method] ?? row.payment_method ?? null, invoices: row.invoices ?? [] })),
    total: Number(rows[0]?.total_count ?? 0), limit, offset,
  };
}
