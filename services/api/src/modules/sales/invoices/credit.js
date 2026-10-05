// A credit note against a posted invoice: for goods returned or a reduction
// agreed after posting. The invoice is never edited; the credit note names
// it and the invoice lines it credits, at the invoice's own prices, discounts
// and tax, in proportion to the quantity. It is created as a draft for
// Finance, who posts it and applies it to the customer's balance. A refund
// (money back) is separate.
import { getCurrencyPrecision } from "../../accounting/core.js";
import { createCustomerInvoice } from "../../accounting/receivables.js";
import { add, asDatabaseDecimal, decimal, div, mul, roundMoney, sub } from "../../../core/decimal.js";
import { requireUuid, text } from "../orders/constants.js";
import { loadInvoice, requireInvoicePermission } from "./access.js";
import { EPSILON } from "./build.js";
import { FINANCE_POSTED, INVOICE_PERMISSIONS, InvoiceError } from "./constants.js";
import { financeContext, invoiceLines, recordInvoiceEvent } from "./records.js";

// Each invoice line with what is not credited yet.
export async function creditableLines(client, organizationId, invoice) {
  const lines = await invoiceLines(client, organizationId, invoice.id);
  const credited = new Map((await client.query(
    `SELECT line.source_sales_order_line_id AS line_id, sum(line.quantity) AS quantity FROM tenant.accounting_customer_invoice_lines line
       JOIN tenant.accounting_customer_invoices credit ON credit.id = line.customer_invoice_id
      WHERE line.organization_id = $1 AND credit.source_invoice_id = $2 AND credit.invoice_type = 'credit_note' AND credit.status NOT IN ('cancelled', 'reversed')
      GROUP BY line.source_sales_order_line_id`, [organizationId, invoice.id])).rows.map((row) => [row.line_id, Number(row.quantity)]));
  return lines.map((line) => ({ ...line, credited: credited.get(line.source_sales_order_line_id) ?? 0, creditable: Math.max(0, Number(line.quantity) - (credited.get(line.source_sales_order_line_id) ?? 0)) }));
}

// input: { idempotencyKey, reason, lines: [{ invoiceLineId, quantity }] }
export async function createCreditNoteFromInvoice(client, context, invoiceId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.creditNote, "You do not have permission to create credit notes.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new InvoiceError(400, "A request key is required to create a credit note.", "SALES_INVOICE_VALIDATION");
  const reason = text(input.reason, 1000);
  if (!reason) throw new InvoiceError(400, "Give the reason for the credit note.", "SALES_INVOICE_REASON_REQUIRED", { field: "reason" });
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  const previous = (await client.query(
    `SELECT metadata->>'creditNoteId' AS id, metadata->>'creditNoteNumber' AS number FROM tenant.sales_document_events
      WHERE organization_id = $1 AND entity_type = 'invoice_request' AND entity_id = $2 AND event_type = 'sales_invoice.credit_note_created' AND metadata->>'idempotencyKey' = $3`,
    [context.organizationId, invoice.id, key])).rows[0];
  if (previous) return { creditNoteId: previous.id, creditNoteNumber: previous.number, replayed: true };
  if (!FINANCE_POSTED.includes(invoice.status)) throw new InvoiceError(409, "Only a posted invoice is credited.", "SALES_INVOICE_NOT_POSTED");
  const lines = await creditableLines(client, context.organizationId, invoice);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const chosen = (Array.isArray(input.lines) ? input.lines : []).map((entry) => ({ line: byId.get(requireUuid(entry.invoiceLineId, "Invoice line")), quantity: Number(entry.quantity) }))
    .filter((entry) => entry.quantity !== 0);
  if (!chosen.length) throw new InvoiceError(400, "Choose what to credit.", "SALES_INVOICE_VALIDATION");
  for (const { line, quantity } of chosen) {
    if (!line) throw new InvoiceError(404, "That line is not on this invoice.", "SALES_INVOICE_LINE_NOT_FOUND");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new InvoiceError(400, `${line.item_name_snapshot}: enter the quantity to credit.`, "SALES_INVOICE_VALIDATION");
    if (quantity > line.creditable + EPSILON)
      throw new InvoiceError(409, `${line.item_name_snapshot}: only ${line.creditable} can be credited.`, "SALES_INVOICE_CREDIT_EXCEEDS_INVOICED");
  }
  const precision = await getCurrencyPrecision(client, context, invoice.currency_code);
  // The invoice line's own values, in proportion to the quantity, by running totals.
  const creditLines = chosen.map(({ line, quantity }) => {
    const invoiced = decimal(line.quantity);
    const before = decimal(line.credited);
    const qty = decimal(quantity);
    const portion = (amount) => {
      const upTo = (credited) => roundMoney(div(mul(decimal(amount ?? 0), credited), invoiced), precision);
      return sub(upTo(add(before, qty)), upTo(before));
    };
    const gross = roundMoney(mul(qty, decimal(line.unit_price)), precision);
    const net = portion(line.net_amount);
    const taxes = line.taxes.map((tax) => ({ taxType: tax.tax_type, label: tax.label, rate: tax.rate, taxableAmount: asDatabaseDecimal(portion(tax.taxable_amount)), taxAmount: asDatabaseDecimal(portion(tax.tax_amount)) }));
    return {
      sourceSalesOrderLineId: line.source_sales_order_line_id, sourceSalesDeliveryLineId: line.source_sales_delivery_line_id, itemId: line.item_id, description: line.description,
      hsnSacCode: line.hsn_sac_code, quantity: asDatabaseDecimal(qty), uomId: line.uom_id, unitPrice: line.unit_price,
      discountAmount: asDatabaseDecimal(gross > net ? sub(gross, net) : decimal(0)), taxAmount: asDatabaseDecimal(taxes.reduce((total, tax) => add(total, decimal(tax.taxAmount)), decimal(0))),
      taxDetails: taxes,
    };
  });
  let created;
  try {
    created = await createCustomerInvoice(client, financeContext(context), {
      ledgerId: invoice.ledger_id, partyId: invoice.party_id, invoiceType: "credit_note", sourceInvoiceId: invoice.id, billingAddressId: invoice.billing_address_id,
      currencyCode: invoice.currency_code, exchangeRate: invoice.exchange_rate, customerSnapshot: invoice.customer_snapshot, billingAddressSnapshot: invoice.billing_address_snapshot,
      paymentTermSnapshot: invoice.payment_term_snapshot, placeOfSupply: invoice.place_of_supply, supplyType: invoice.supply_type,
      notes: `Credit note against ${invoice.invoice_number}: ${reason}`, lines: creditLines,
    }, { internal: true, sourceSalesOrderId: invoice.sales_order_id, returnLineIds: true });
  } catch (error) {
    if (error?.name !== "AccountingError") throw error;
    throw new InvoiceError(error.status ?? 409, `The credit note could not be created: ${error.message}`, error.code ?? "SALES_INVOICE_FINANCE_REFUSED");
  }
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.credit_note_created", "posted", "posted", {
    idempotencyKey: key, creditNoteId: created.id, creditNoteNumber: created.invoiceNumber, reason,
    lines: chosen.map(({ line, quantity }) => ({ item: line.item_name_snapshot, quantity, unit: line.uom_snapshot })),
  });
  return { creditNoteId: created.id, creditNoteNumber: created.invoiceNumber, replayed: false };
}
