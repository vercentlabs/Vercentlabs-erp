// Payments Received inside Sales (Sales plan, Phase 2). A customer pays — by UPI, NEFT/RTGS, cheque or cash — and the money is applied to
// its bills, oldest first unless the person chooses; what is left stays the customer's advance and is offered on its next invoice.
// Sales only wraps Finance (accounting/receivables.js: the receipt, its posting and its allocation), so a receipt made here is the same
// record Accounting › Receipts shows, and it works without the Accounting app as invoices do.
import { allocateCustomerReceipt, createCustomerReceipt, postCustomerReceipt } from "../../accounting/receivables.js";
import { loadCustomerRow } from "../customers/records.js";
import { invoiceCan } from "../invoices/access.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "../invoices/constants.js";
import { companyToday } from "../today.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PAYMENT_METHODS = Object.freeze({ upi: "UPI", bank_transfer: "NEFT / RTGS / IMPS", cheque: "Cheque", cash: "Cash", card: "Card", other: "Other" });
const OPEN = "('posted','partially_paid','overdue','disputed')";
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const cents = (value) => Math.round(Number(value) * 100);
const rupees = (value) => Math.round(Number(value) * 100) / 100;

// Finance writes on Sales' behalf: the Sales permission checked here authorises it.
const finance = (context) => ({
  organizationId: context.organizationId, userId: context.userId ?? null, roleSlugs: [],
  permissions: ["accounting.view", "accounting.receivables.manage", "accounting.receipts.manage"],
});
const refused = (error, what) => {
  if (error?.name !== "AccountingError") return error;
  return new InvoiceError(error.status ?? 409, `${what}: ${error.message}`, error.code ?? "SALES_PAYMENT_REFUSED");
};

function requireRecord(context) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.recordPayment) && !invoiceCan(context, "accounting.receipts.manage"))
    throw new InvoiceError(403, "You do not have permission to record payments.", "PERMISSION_DENIED");
}
function requireView(context) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.paymentsView) && !invoiceCan(context, INVOICE_PERMISSIONS.recordPayment))
    throw new InvoiceError(403, "You do not have permission to see payments.", "PERMISSION_DENIED");
}

async function openInvoices(client, organizationId, partyId, currencyCode = null) {
  return (await client.query(
    `SELECT id, invoice_number, invoice_type, invoice_date::text AS invoice_date, due_date::text AS due_date, btrim(currency_code) AS currency_code, grand_total, outstanding_amount,
            GREATEST(tenant.company_today() - due_date, 0) AS days_overdue
       FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND party_id = $2 AND invoice_type IN ('invoice', 'debit_note', 'opening') AND status IN ${OPEN} AND outstanding_amount > 0
        AND ($3::text IS NULL OR btrim(currency_code) = $3)
      ORDER BY due_date NULLS LAST, invoice_date, invoice_number`, [organizationId, partyId, currencyCode])).rows
    .map((row) => ({ ...row, grand_total: Number(row.grand_total), outstanding_amount: Number(row.outstanding_amount), days_overdue: Number(row.days_overdue) }));
}

async function advancesOf(client, organizationId, partyId, currencyCode = null) {
  return (await client.query(
    `SELECT id, receipt_number, receipt_date::text AS receipt_date, btrim(currency_code) AS currency_code, amount, unapplied_amount, payment_method, external_reference
       FROM tenant.accounting_customer_receipts
      WHERE organization_id = $1 AND party_id = $2 AND status IN ('posted', 'partially_applied') AND unapplied_amount > 0 AND ($3::text IS NULL OR btrim(currency_code) = $3)
      ORDER BY receipt_date, receipt_number`, [organizationId, partyId, currencyCode])).rows
    .map((row) => ({ ...row, amount: Number(row.amount), unapplied_amount: Number(row.unapplied_amount) }));
}

// What the customer owes, bill by bill (oldest due first), and the money it has with the company: advances not yet applied and credit
// notes not yet used. The New Payment form allocates against it.
export async function getCustomerOpenItems(client, context, partyId) {
  requireRecord(context);
  const customer = await loadCustomerRow(client, context, partyId);
  const credits = (await client.query(
    `SELECT id, invoice_number, invoice_date::text AS invoice_date, btrim(currency_code) AS currency_code, outstanding_amount FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND party_id = $2 AND invoice_type = 'credit_note' AND status IN ('posted', 'partially_paid') AND outstanding_amount > 0
      ORDER BY invoice_date`, [context.organizationId, customer.id])).rows.map((row) => ({ ...row, outstanding_amount: Number(row.outstanding_amount) }));
  const currency = String(customer.currency_code ?? "").trim() || null;
  return {
    customer: { id: customer.id, name: customer.display_name, currencyCode: currency },
    invoices: await openInvoices(client, context.organizationId, customer.id),
    advances: await advancesOf(client, context.organizationId, customer.id),
    credits,
  };
}

// Oldest bill first: as much of `amount` as each still owes, until it runs out.
export function allocateOldestFirst(invoices, amount) {
  let left = cents(amount);
  const allocations = [];
  for (const invoice of invoices) {
    if (left <= 0) break;
    const take = Math.min(left, cents(invoice.outstanding_amount));
    if (take > 0) allocations.push({ invoiceId: invoice.id, amount: take / 100 });
    left -= take;
  }
  return allocations;
}

// input: { partyId, amount, receiptDate?, paymentMethod?, reference? (UTR / transaction id), chequeNumber?, chequeDate?, draweeBank?,
//          bankAccountId?, currencyCode?, notes?,
//          allocations? [{ invoiceId, amount, tdsAmount?, tdsSection? }] — omitted: oldest first; [] keeps it all as an advance }
// Returns { receiptId, receiptNumber, amount, applied, advance, allocations: [{ invoiceId, invoiceNumber, amount }] }.
export async function recordCustomerPayment(client, context, input = {}) {
  requireRecord(context);
  const customer = await loadCustomerRow(client, context, input.partyId);
  const amount = rupees(input.amount);
  if (!(amount > 0)) throw new InvoiceError(400, "Enter the amount received.", "SALES_PAYMENT_INVALID", { field: "amount" });
  const today = await companyToday(client);
  const receiptDate = input.receiptDate ? String(input.receiptDate).slice(0, 10) : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate) || receiptDate > today)
    throw new InvoiceError(400, "Enter the date the payment was received (not in the future).", "SALES_PAYMENT_INVALID", { field: "receiptDate" });
  const method = PAYMENT_METHODS[input.paymentMethod] ? input.paymentMethod : "bank_transfer";
  const chequeNumber = text(input.chequeNumber, 20) || null;
  const chequeDate = input.chequeDate ? String(input.chequeDate).slice(0, 10) : null;
  if (method === "cheque") {
    if (!chequeNumber) throw new InvoiceError(400, "Enter the cheque number.", "SALES_PAYMENT_INVALID", { field: "chequeNumber" });
    if (!chequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)) throw new InvoiceError(400, "Enter the date on the cheque.", "SALES_PAYMENT_INVALID", { field: "chequeDate" });
  }
  const currency = text(input.currencyCode, 3).toUpperCase() || String(customer.currency_code ?? "").trim()
    || String((await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.base_currency ?? "").trim() || null;
  const open = await openInvoices(client, context.organizationId, customer.id, currency);
  const byId = new Map(open.map((invoice) => [invoice.id, invoice]));
  const requested = Array.isArray(input.allocations) ? input.allocations : allocateOldestFirst(open, amount);
  const allocations = [];
  for (const entry of requested) {
    const value = rupees(entry.amount ?? 0);
    const tds = rupees(entry.tdsAmount ?? 0);
    if (!(value > 0) && !(tds > 0)) continue;
    const invoice = byId.get(entry.invoiceId);
    if (!invoice) throw new InvoiceError(409, "A bill chosen is not open for this customer (paid, or in another currency).", "SALES_PAYMENT_INVOICE_NOT_OPEN");
    if (value < 0 || tds < 0) throw new InvoiceError(400, `${invoice.invoice_number}: enter an amount of 0 or more.`, "SALES_PAYMENT_INVALID");
    if (cents(value) + cents(tds) > cents(invoice.outstanding_amount))
      throw new InvoiceError(409, `${invoice.invoice_number} has ${invoice.outstanding_amount.toFixed(2)} left to pay.`, "SALES_PAYMENT_TOO_MUCH");
    allocations.push({ invoice, amount: value, tds, tdsSection: text(entry.tdsSection, 20) || null });
  }
  const applied = rupees(allocations.reduce((total, entry) => total + entry.amount, 0));
  if (cents(applied) > cents(amount)) throw new InvoiceError(409, `The bills chosen take ${applied.toFixed(2)}, more than the ${amount.toFixed(2)} received.`, "SALES_PAYMENT_TOO_MUCH");
  let receipt;
  try {
    receipt = await createCustomerReceipt(client, finance(context), {
      partyId: customer.id, receiptDate, currencyCode: currency ?? undefined, amount: amount.toFixed(2), paymentMethod: method,
      externalReference: text(input.reference) || (chequeNumber ? `Cheque ${chequeNumber}` : null), bankAccountId: input.bankAccountId || null,
    });
    await client.query(
      `UPDATE tenant.accounting_customer_receipts SET cheque_number = $3, cheque_date = $4, drawee_bank = $5, notes = COALESCE($6, notes) WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, receipt.id, chequeNumber, chequeDate, text(input.draweeBank, 100) || null, text(input.notes, 1000) || null]);
    receipt = await postCustomerReceipt(client, finance(context), receipt.id);
    if (allocations.length)
      await allocateCustomerReceipt(client, finance(context), receipt.id, { allocations: allocations.map((entry) => ({
        invoiceId: entry.invoice.id, receiptAmount: entry.amount.toFixed(2), invoiceAmount: entry.amount.toFixed(2),
        ...(entry.tds > 0 ? { withholdingAmount: entry.tds.toFixed(2), withholdingSection: entry.tdsSection } : {}),
      })).filter((entry) => Number(entry.receiptAmount) > 0 || entry.withholdingAmount) });
  } catch (error) {
    throw refused(error, "The payment could not be recorded");
  }
  return {
    receiptId: receipt.id, receiptNumber: receipt.receipt_number, amount, applied, advance: rupees(amount - applied),
    allocations: allocations.map((entry) => ({ invoiceId: entry.invoice.id, invoiceNumber: entry.invoice.invoice_number, amount: entry.amount, tds: entry.tds })),
  };
}

// The customer's advances that can still go to an invoice of the same currency.
export async function listInvoiceAdvances(client, context, invoiceId) {
  requireRecord(context);
  const invoice = (await client.query(
    "SELECT id, party_id, btrim(currency_code) AS currency_code, outstanding_amount, status FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2",
    [context.organizationId, UUID.test(String(invoiceId ?? "")) ? invoiceId : null])).rows[0];
  if (!invoice) throw new InvoiceError(404, "Invoice not found.", "SALES_INVOICE_NOT_FOUND");
  await loadCustomerRow(client, context, invoice.party_id);
  const advances = await advancesOf(client, context.organizationId, invoice.party_id, invoice.currency_code);
  return { outstanding: Number(invoice.outstanding_amount), payable: ["posted", "partially_paid", "overdue", "disputed"].includes(invoice.status), advances,
    available: rupees(advances.reduce((total, row) => total + row.unapplied_amount, 0)) };
}

// Applies the customer's advances (oldest first, or the one chosen) to the invoice, up to what it owes. input: { receiptId?, amount? }
export async function applyAdvanceToInvoice(client, context, invoiceId, input = {}) {
  const state = await listInvoiceAdvances(client, context, invoiceId);
  if (!state.payable || state.outstanding <= 0) throw new InvoiceError(409, "This invoice has nothing left to pay.", "SALES_INVOICE_NOT_PAYABLE");
  const sources = input.receiptId ? state.advances.filter((row) => row.id === input.receiptId) : state.advances;
  if (!sources.length) throw new InvoiceError(409, "The customer has no advance to apply.", "SALES_PAYMENT_NO_ADVANCE");
  let left = cents(Math.min(state.outstanding, input.amount ? rupees(input.amount) : state.outstanding));
  const used = [];
  try {
    for (const receipt of sources) {
      if (left <= 0) break;
      const take = Math.min(left, cents(receipt.unapplied_amount));
      if (take <= 0) continue;
      await allocateCustomerReceipt(client, finance(context), receipt.id, { allocations: [{ invoiceId, receiptAmount: (take / 100).toFixed(2), invoiceAmount: (take / 100).toFixed(2) }] });
      used.push({ receiptId: receipt.id, receiptNumber: receipt.receipt_number, amount: take / 100 });
      left -= take;
    }
  } catch (error) {
    throw refused(error, "The advance could not be applied");
  }
  const after = (await client.query("SELECT outstanding_amount, status FROM tenant.accounting_customer_invoices WHERE id = $1", [invoiceId])).rows[0];
  return { applied: rupees(used.reduce((total, row) => total + row.amount, 0)), receipts: used, outstanding: Number(after.outstanding_amount), status: after.status };
}

// One payment received with the bills it paid (for its page and its PDF), for a customer the person may see.
export async function getSalesPayment(client, context, receiptId) {
  requireView(context);
  const receipt = (await client.query(
    `SELECT receipt.*, receipt.receipt_date::text AS receipt_day, receipt.cheque_date::text AS cheque_day, btrim(receipt.currency_code) AS currency, party.display_name AS customer_name, party.legal_name AS customer_legal_name,
            party.gstin AS customer_gstin, party.customer_number, bank.account_name AS bank_account_name, bank.bank_name AS bank_name
       FROM tenant.accounting_customer_receipts receipt
       JOIN tenant.business_parties party ON party.organization_id = receipt.organization_id AND party.id = receipt.party_id
       LEFT JOIN tenant.accounting_bank_accounts bank ON bank.organization_id = receipt.organization_id AND bank.id = receipt.bank_account_id
      WHERE receipt.organization_id = $1 AND receipt.id = $2`, [context.organizationId, UUID.test(String(receiptId ?? "")) ? receiptId : null])).rows[0];
  if (!receipt) throw new InvoiceError(404, "Payment not found.", "SALES_PAYMENT_NOT_FOUND");
  await loadCustomerRow(client, context, receipt.party_id);
  const allocations = (await client.query(
    `SELECT allocation.customer_invoice_id AS invoice_id, invoice.invoice_number, invoice.invoice_date::text AS invoice_date, invoice.grand_total, allocation.receipt_amount,
            allocation.withholding_amount, allocation.withholding_section, allocation.allocated_at
       FROM tenant.accounting_customer_receipt_allocations allocation
       JOIN tenant.accounting_customer_invoices invoice ON invoice.id = allocation.customer_invoice_id
      WHERE allocation.organization_id = $1 AND allocation.receipt_id = $2 ORDER BY allocation.allocated_at, invoice.invoice_number`, [context.organizationId, receipt.id])).rows;
  return {
    payment: {
      id: receipt.id, number: receipt.receipt_number, date: receipt.receipt_day, amount: Number(receipt.amount), unapplied: Number(receipt.unapplied_amount), currencyCode: receipt.currency,
      method: receipt.payment_method, methodLabel: PAYMENT_METHODS[receipt.payment_method] ?? receipt.payment_method, reference: receipt.external_reference,
      chequeNumber: receipt.cheque_number, chequeDate: receipt.cheque_day ?? null,
      draweeBank: receipt.drawee_bank, bankAccount: receipt.bank_account_name || receipt.bank_name || null, status: receipt.status, notes: receipt.notes,
      reversedAt: receipt.reversed_at, reversalReason: receipt.reversal_reason,
      customer: { id: receipt.party_id, name: receipt.customer_name, legalName: receipt.customer_legal_name, gstin: receipt.customer_gstin, customerNumber: receipt.customer_number },
    },
    allocations: allocations.map((row) => ({ invoiceId: row.invoice_id, invoiceNumber: row.invoice_number, invoiceDate: row.invoice_date, invoiceTotal: Number(row.grand_total),
      amount: Number(row.receipt_amount), tds: Number(row.withholding_amount ?? 0), tdsSection: row.withholding_section })),
  };
}
