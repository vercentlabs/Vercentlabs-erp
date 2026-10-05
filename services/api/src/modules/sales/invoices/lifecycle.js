// A sales invoice's life: Draft → Posted, or a draft Cancelled; a posted
// invoice posted in error, with nothing applied to it, Reversed. Corrections
// after posting are credit notes, never edits.
//
// Posting is one transaction under the order's lock: the invoice is checked
// again (the customer, the order, every line's quantity against what posted
// invoices have left to invoice now, so of two drafts for the same last units
// only the first posted goes through; the tax against the central tax engine
// on the invoice date; the company registration and place of supply; the
// accounting period; the totals). Its values are then worked out again over
// what is posted now, so the posted invoices of a line add up to it exactly,
// and Finance makes it the customer's receivable and enters it in the books
// (receivable, revenue, output tax). Posting twice posts once.
import { getOpenPeriod } from "../../accounting/core.js";
import { cancelCustomerInvoiceDraft, postCustomerInvoice, reverseCustomerInvoice } from "../../accounting/receivables.js";
import { submitSubledgerDocument } from "../../accounting/subledger-approvals.js";
import { STATUS, dayOf, text } from "../orders/constants.js";
import { lockOrder } from "../orders/versions.js";
import { loadInvoice, requireInvoicePermission } from "./access.js";
import { EPSILON, invoiceableLines, orderSource, taxDifferences } from "./build.js";
import { FINANCE_POSTED, INVOICE_PERMISSIONS, INVOICE_STATUS, InvoiceError } from "./constants.js";
import { deliveryInvoiceableLines, financeContext, invoiceLines, recordInvoiceEvent, rewriteDraft } from "./records.js";

function financeError(error, fallback) {
  if (error?.name !== "AccountingError") return error;
  return new InvoiceError(error.status ?? 409, `${fallback}: ${error.message}`, error.code ?? "SALES_INVOICE_FINANCE_REFUSED");
}

// Everything that stops the invoice being posted now, and the tax differences found.
async function postingProblems(client, context, invoice, order) {
  const problems = [];
  const problem = (code, message) => problems.push({ code, message });
  // A sales block stops new quotations and orders, not the invoicing of an order already agreed.
  const party = (await client.query(`SELECT archived_at FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [context.organizationId, invoice.party_id])).rows[0];
  if (!party || party.archived_at) problem("SALES_CUSTOMER_ARCHIVED", "The customer is archived.");
  if (![STATUS.confirmed, STATUS.closed].includes(order.lifecycle_status)) problem("SALES_ORDER_NOT_CONFIRMED", "The order is no longer confirmed.");

  const lines = await invoiceLines(client, context.organizationId, invoice.id);
  if (!lines.length) problem("SALES_INVOICE_EMPTY", "The invoice has no lines.");
  // Quantities: against what is left to invoice now, other invoices posted since counted.
  const eligible = new Map((await invoiceableLines(client, context.organizationId, { ...order, current_version_id: invoice.sales_order_version_id ?? order.current_version_id },
    invoice.quantity_basis, { exceptInvoiceId: invoice.id })).map((line) => [line.lineId, line]));
  const warnings = [];
  const deliveryIds = [...new Set(lines.map((line) => line.delivery_id).filter(Boolean))];
  const deliveryAvailable = new Map();
  for (const id of deliveryIds) for (const line of await deliveryInvoiceableLines(client, context.organizationId, id, invoice.id)) deliveryAvailable.set(line.id, line.available);
  for (const line of lines) {
    const state = eligible.get(line.source_sales_order_line_id);
    const quantity = Number(line.quantity);
    if (!state) { problem("SALES_INVOICE_ORDER_CHANGED", `${line.item_name_snapshot} is no longer on the order.`); continue; }
    if (state.onDrafts > EPSILON && quantity + state.onDrafts > state.eligible + EPSILON)
      warnings.push({ code: "SALES_INVOICE_DRAFT_CONFLICT",
        message: `${line.item_name_snapshot}: ${state.draftInvoices.map((draft) => `${draft.invoiceNumber} (${draft.quantity})`).join(", ")} also bill this line; only ${state.eligible} is left, so not all of these drafts can be posted.` });
    if (quantity > state.eligible + EPSILON)
      problem("SALES_ORDER_INVOICE_EXCEEDS_REMAINING", `${line.item_name_snapshot}: only ${state.eligible} ${line.uom_snapshot ?? ""} can be invoiced now; the invoice bills ${quantity}.`.replace("  ", " "));
    if (line.source_sales_delivery_line_id && quantity > (deliveryAvailable.get(line.source_sales_delivery_line_id) ?? 0) + EPSILON)
      problem("SALES_ORDER_INVOICE_EXCEEDS_REMAINING", `${line.item_name_snapshot}: more than delivery ${line.delivery_number} has left to invoice.`);
  }
  // Totals: the lines add up to the invoice.
  const lineTotal = lines.reduce((total, line) => total + Number(line.line_total), 0);
  if (Number(invoice.grand_total) <= 0) problem("SALES_INVOICE_TOTAL_INVALID", "The invoice total must be more than zero.");
  else if (Math.abs(lineTotal + Number(invoice.charge_total ?? 0) + Number(invoice.rounding_adjustment ?? 0) - Number(invoice.grand_total)) > 0.005)
    problem("SALES_INVOICE_TOTAL_INVALID", "The invoice lines do not add up to its total.");
  // Tax: what the central engine says applies on the invoice date.
  const source = await orderSource(client, context.organizationId, invoice.sales_order_version_id ?? order.current_version_id);
  const differences = await taxDifferences(client, context, invoice, lines, source.lines);
  for (const difference of differences)
    problem("SALES_INVOICE_TAX_CHANGED", `${difference.item}: the invoice carries ${difference.invoiced}; on ${dayOf(invoice.invoice_date)} it is ${difference.expected}. Recalculate the tax on the draft.`);
  const taxed = lines.some((line) => line.taxes.some((tax) => Number(tax.tax_amount) > 0));
  if (taxed && !invoice.seller_snapshot?.gstin && !invoice.seller_snapshot?.name) problem("SALES_SELLER_REGISTRATION_MISSING", "The company tax registration is missing.");
  if (lines.some((line) => line.taxes.some((tax) => ["cgst", "sgst", "igst"].includes(tax.tax_type))) && !invoice.place_of_supply)
    problem("SALES_PLACE_OF_SUPPLY_MISSING", "The place of supply is missing.");
  // Dates and period.
  if (dayOf(invoice.due_date) < dayOf(invoice.invoice_date)) problem("SALES_INVOICE_DUE_DATE_INVALID", "The due date is before the invoice date.");
  try {
    await getOpenPeriod(client, context, dayOf(invoice.accounting_date));
  } catch (error) {
    problem("SALES_INVOICE_PERIOD_CLOSED", `Posting date ${dayOf(invoice.accounting_date)}: ${error.message}`);
  }
  return { problems, warnings, taxDifferences: differences };
}

// Whether the invoice can be posted now, and why not.
export async function validateInvoiceForPosting(client, context, invoiceId) {
  const invoice = await loadInvoice(client, context, invoiceId);
  if (!["draft", "approved"].includes(invoice.status)) return { ready: false, problems: [{ code: "SALES_INVOICE_LOCKED", message: "The invoice is not a draft." }], warnings: [], taxDifferences: [] };
  const order = (await client.query(`SELECT * FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2`, [context.organizationId, invoice.sales_order_id])).rows[0];
  const result = await postingProblems(client, context, invoice, order);
  return { ready: result.problems.length === 0, ...result };
}

// Posts the invoice. input: { expectedVersion? }. Returns { invoiceId, invoiceNumber, status, replayed, awaitingApproval? }.
export async function postSalesInvoice(client, context, invoiceId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.post, "You do not have permission to post invoices.");
  // The order is locked first, as everything that changes what is invoiced does, then the invoice.
  const seen = await loadInvoice(client, context, invoiceId);
  const order = await lockOrder(client, context, seen.sales_order_id);
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  if (FINANCE_POSTED.includes(invoice.status)) return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, status: INVOICE_STATUS.posted, replayed: true };
  if (invoice.status === "pending_approval")
    return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, status: INVOICE_STATUS.draft, awaitingApproval: true, replayed: true };
  if (!["draft", "approved"].includes(invoice.status)) throw new InvoiceError(409, `A ${invoice.status} invoice cannot be posted.`, "SALES_INVOICE_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(invoice.version))
    throw new InvoiceError(409, "Someone else changed this invoice. Reload it and try again.", "SALES_INVOICE_VERSION_CONFLICT");
  const { problems } = await postingProblems(client, context, invoice, order);
  if (problems.length)
    throw new InvoiceError(409, `The invoice cannot be posted: ${problems.map((entry) => entry.message).join(" ")}`, problems[0].code, { problems });
  // The shares of each order line over what is posted now: the posted invoices add up to the order exactly.
  if (invoice.status === "draft")
    await rewriteDraft(client, context, invoice, order, { invoiceDate: dayOf(invoice.invoice_date), postingDate: dayOf(invoice.accounting_date), dueDate: dayOf(invoice.due_date) });
  const finance = financeContext(context);
  try {
    if (invoice.status === "draft") {
      // Finance's approval policy still applies: above its threshold the invoice waits for a Finance approver.
      const submitted = await submitSubledgerDocument(client, finance, "customer_invoice", invoice.id);
      if (submitted.status === "pending_approval") {
        await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.submitted_for_approval", INVOICE_STATUS.draft, INVOICE_STATUS.draft, {});
        return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, status: INVOICE_STATUS.draft, awaitingApproval: true, replayed: false };
      }
    }
    await postCustomerInvoice(client, finance, invoice.id, { internal: true, fromSales: true });
  } catch (error) {
    throw financeError(error, "The invoice could not be posted");
  }
  const posted = (await client.query(`SELECT journal_entry_id, grand_total FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2`, [context.organizationId, invoice.id])).rows[0];
  const after = await invoiceableLines(client, context.organizationId, { ...order, current_version_id: invoice.sales_order_version_id ?? order.current_version_id }, invoice.quantity_basis);
  const remaining = after.filter((line) => line.remainingToInvoice > EPSILON).map((line) => ({ item: line.itemName, quantity: line.remainingToInvoice, unit: line.unit }));
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.posted", INVOICE_STATUS.draft, INVOICE_STATUS.posted,
    { invoiceNumber: invoice.invoice_number, total: posted.grand_total, journalEntryId: posted.journal_entry_id, remaining });
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'sales_order', $2, 'sales_order.invoice_posted', $3, $3, $4::jsonb, $5, clock_timestamp())`,
    [context.organizationId, order.id, order.lifecycle_status, JSON.stringify({ invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, total: posted.grand_total, remaining }), context.userId ?? null]);
  return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, status: INVOICE_STATUS.posted, replayed: false };
}

// Cancels a draft. The number is kept, cancelled; nothing reached the books. input: { reason? }
export async function cancelDraftInvoice(client, context, invoiceId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.edit, "You do not have permission to cancel invoices.");
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  if (invoice.status === "cancelled") return { invoiceId: invoice.id, status: INVOICE_STATUS.cancelled, changed: false };
  let result;
  try {
    result = await cancelCustomerInvoiceDraft(client, financeContext(context), invoice.id, { reason: input.reason }, { internal: true });
  } catch (error) {
    throw financeError(error, "The invoice could not be cancelled");
  }
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.cancelled", INVOICE_STATUS.draft, INVOICE_STATUS.cancelled, { reason: text(input.reason, 1000) ?? undefined });
  return { invoiceId: invoice.id, status: INVOICE_STATUS.cancelled, changed: result.changed };
}

// Reverses a posted invoice that nothing has been applied to: the receivable, revenue and output
// tax are taken back by a reversing entry; the invoice is kept, Reversed. input: { reason }
export async function reverseSalesInvoice(client, context, invoiceId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.reverse, "You do not have permission to reverse invoices.");
  const reason = text(input.reason, 1000);
  if (!reason) throw new InvoiceError(400, "Give the reason for reversing the invoice.", "SALES_INVOICE_REASON_REQUIRED", { field: "reason" });
  const seen = await loadInvoice(client, context, invoiceId);
  await lockOrder(client, context, seen.sales_order_id);
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  if (invoice.status === "reversed") return { invoiceId: invoice.id, status: INVOICE_STATUS.reversed, changed: false };
  let result;
  try {
    result = await reverseCustomerInvoice(client, financeContext(context), invoice.id, { reason }, { internal: true });
  } catch (error) {
    throw financeError(error, "The invoice could not be reversed");
  }
  await client.query(
    `UPDATE tenant.sales_invoices SET reversed_at = now(), reversed_by = $3, reversal_reason = $4, reversal_journal_entry_id = $5, updated_at = now()
      WHERE organization_id = $1 AND customer_invoice_id = $2`, [context.organizationId, invoice.id, context.userId ?? null, reason, result.reversalEntryId ?? null]);
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.reversed", INVOICE_STATUS.posted, INVOICE_STATUS.reversed, { reason });
  return { invoiceId: invoice.id, status: INVOICE_STATUS.reversed, changed: true };
}
