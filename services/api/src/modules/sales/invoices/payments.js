// Recording a customer's payment from Sales (Sales audit B7). A company with Sales but not the Accounting app still takes payments: the
// invoice's Record Payment writes the receipt to the ledger (posted, into the chosen bank or cash account) and applies it to the invoice,
// so the invoice is Paid or Partly paid and the order's balance clears. With the Accounting app the same receipt appears there.
import { allocateCustomerReceipt, createCustomerReceipt, postCustomerReceipt } from "../../accounting/receivables.js";
import { companyToday } from "../today.js";
import { invoiceCan } from "./access.js";
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
