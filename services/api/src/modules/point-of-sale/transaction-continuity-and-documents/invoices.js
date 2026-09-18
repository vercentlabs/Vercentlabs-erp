// F290 — Invoice generation. POS never builds its own invoice engine: a
// generated invoice is a real row in Accounting's own
// tenant.accounting_customer_invoices (the same authoritative document
// Sales' invoice-request pipeline targets), created/submitted/posted
// through Accounting's own public contract
// (services/api/src/modules/accounting/index.js), never by writing to
// that table directly.
//
// ON-DEMAND, NOT AUTOMATIC: a receipt (F289) is the default document for
// every completed sale. A formal tax invoice is generated on request (a
// customer needs one for their own books, common for B2B/registered
// customers) -- it is not created for every walk-in cash sale, and it
// requires a real customer (an invoice needs a named, accounting-known
// party; a walk-in sale with no customer attached cannot be invoiced --
// see POS_INVOICE_CUSTOMER_REQUIRED below). GL posting for revenue/tax
// recognition (F305, accounting-posting.js) is a SEPARATE concern that
// happens for every completed sale regardless of whether a formal invoice
// document is ever generated.
//
// APPROVAL: createCustomerInvoice/submitSubledgerDocument/postCustomerInvoice
// are all called with { internal: true }, skipping Accounting's own
// interactive submit-for-approval workflow entirely. That workflow exists
// for a credit document created BEFORE payment (a Sales invoice may sit
// unpaid for 30+ days) -- a POS invoice always trails an already-completed,
// already-fully-paid till transaction, so there is no commercial risk left
// for a human approval gate to catch; the real control is POS's own
// authorization (assertPosStoreAccess/pos.invoice.generate) that already
// ran before this function does anything.
import {
  createCustomerInvoice,
  submitSubledgerDocument,
  postCustomerInvoice,
  getCustomerInvoice,
} from "../../accounting/index.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, mul, decimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event as auditEvent } from "../shared/audit.js";
import { posAccountingContext } from "../shared/accounting-bridge.js";

function event(client, context, saleId, eventType, payload = {}) {
  return auditEvent(client, context, "pos_sale", saleId, eventType, payload);
}

async function lockSale(client, context, saleId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_sales WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, saleId],
  );
  if (!result.rows[0]) throw posError(404, "POS sale was not found.", "POS_SALE_NOT_FOUND");
  return result.rows[0];
}

// A safety net, not a formality: pos_sale_lines' discount/tax figures are
// already the authoritative per-line breakdown completePosCart/
// completePointOfSale computed and persisted, but this reconstructs the
// sale header total from them independently before handing anything to
// Accounting, so a future refactor that changes what a line's columns mean
// fails LOUD here instead of silently posting a mismatched invoice.
function assertLinesReconcileToSale(sale, lines) {
  let subtotal = decimal(0);
  let discountTotal = decimal(0);
  let taxTotal = decimal(0);
  for (const line of lines) {
    subtotal = add(subtotal, mul(decimal(line.quantity), decimal(line.unit_price)));
    discountTotal = add(discountTotal, decimal(line.discount_amount));
    taxTotal = add(taxTotal, decimal(line.tax_amount));
  }
  if (subtotal !== decimal(sale.subtotal)) {
    throw posError(500, "POS sale line totals do not reconcile with the sale subtotal for invoicing.", "POS_INVOICE_RECONCILIATION_MISMATCH");
  }
  if (discountTotal !== decimal(sale.discount_total)) {
    throw posError(500, "POS sale line discounts do not reconcile with the sale header for invoicing.", "POS_INVOICE_RECONCILIATION_MISMATCH");
  }
  if (taxTotal !== decimal(sale.tax_total)) {
    throw posError(500, "POS sale line tax does not reconcile with the sale header for invoicing.", "POS_INVOICE_RECONCILIATION_MISMATCH");
  }
}

export async function generatePosInvoice(client, context, saleId, input = {}) {
  requirePermission(context, "pos.invoice.generate");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.invoice.generate",
    key: input.idempotencyKey,
    payload: { saleId },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const sale = await lockSale(client, context, saleId);
  await assertPosStoreAccess(client, context, sale.store_id);
  if (!["completed", "partially_returned", "returned"].includes(sale.status)) {
    throw posError(409, "Only a completed POS sale can have an invoice generated.", "POS_INVOICE_SALE_NOT_COMPLETED");
  }
  if (!sale.customer_id) {
    throw posError(409, "This sale has no customer attached — attach a customer before generating a tax invoice.", "POS_INVOICE_CUSTOMER_REQUIRED");
  }

  const accountingContext = posAccountingContext(context);

  // Idempotent by natural key (one invoice per sale, ever), same
  // convention as F303's day-end report regeneration: a repeated request
  // for a sale that already has one just replays it.
  if (sale.accounting_invoice_id) {
    const existing = await getCustomerInvoice(client, accountingContext, sale.accounting_invoice_id);
    const response = { ...existing, replayed: true };
    await completeIdempotentOperation(client, context, idempotency, {
      response, aggregateType: "accounting_customer_invoice", aggregateId: existing.invoice.id,
    });
    return response;
  }

  const lineRows = await client.query(
    `SELECT * FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2 ORDER BY line_number`,
    [context.organizationId, sale.id],
  );
  if (!lineRows.rows.length) throw posError(409, "This sale has no lines to invoice.", "POS_INVOICE_NO_LINES");
  assertLinesReconcileToSale(sale, lineRows.rows);

  const invoiceLines = lineRows.rows.map((line) => ({
    itemId: line.item_id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unit_price,
    discountAmount: line.discount_amount,
    taxAmount: line.tax_amount,
  }));

  const documentDate = new Date(sale.completed_at || sale.sale_date).toISOString().slice(0, 10);
  const created = await createCustomerInvoice(client, accountingContext, {
    companyId: sale.company_id,
    partyId: sale.customer_id,
    invoiceDate: documentDate,
    accountingDate: documentDate,
    currencyCode: sale.currency_code,
    roundingAdjustment: sale.rounding_adjustment,
    lines: invoiceLines,
    notes: input.notes || null,
  }, { internal: true });

  await submitSubledgerDocument(client, accountingContext, "customer_invoice", created.invoice.id, null, { internal: true });
  const posted = await postCustomerInvoice(client, accountingContext, created.invoice.id, { internal: true });

  await client.query(
    `UPDATE tenant.pos_sales SET accounting_invoice_id=$3,invoice_generated_at=now(),invoice_generated_by=$4
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, sale.id, posted.invoice.id, context.userId],
  );
  await event(client, context, sale.id, "pos.invoice.generated", {
    invoiceId: posted.invoice.id,
    invoiceNumber: posted.invoice.invoice_number,
  });

  const response = { ...posted, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response, aggregateType: "accounting_customer_invoice", aggregateId: posted.invoice.id,
  });
  return response;
}

export async function getPosInvoiceForSale(client, context, saleId) {
  requirePermission(context, "pos.invoice.view");
  const sale = await client.query(
    `SELECT id,store_id,accounting_invoice_id FROM tenant.pos_sales WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, saleId],
  );
  const row = sale.rows[0];
  if (!row) throw posError(404, "POS sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, row.store_id);
  if (!row.accounting_invoice_id) throw posError(404, "No invoice has been generated for this sale.", "POS_INVOICE_NOT_FOUND");
  return getCustomerInvoice(client, posAccountingContext(context), row.accounting_invoice_id);
}

export async function listPosInvoices(client, context, options = {}) {
  requirePermission(context, "pos.invoice.view");
  const values = [context.organizationId, context.companyId];
  const clauses = ["sale.accounting_invoice_id IS NOT NULL"];
  if (options.storeId) {
    values.push(options.storeId);
    clauses.push(`sale.store_id=$${values.length}`);
  }
  if (options.customerId) {
    values.push(options.customerId);
    clauses.push(`sale.customer_id=$${values.length}`);
  }
  values.push(Math.min(Number(options.limit) || 100, 200), Number(options.offset) || 0);
  const result = await client.query(
    `SELECT sale.id AS sale_id,sale.receipt_number,sale.store_id,sale.customer_id,sale.customer_name,
            sale.sale_date,sale.grand_total,sale.currency_code,sale.invoice_generated_at,
            invoice.id AS invoice_id,invoice.invoice_number,invoice.status AS invoice_status,invoice.due_date
       FROM tenant.pos_sales sale
       JOIN tenant.accounting_customer_invoices invoice
         ON invoice.organization_id=sale.organization_id AND invoice.id=sale.accounting_invoice_id
      WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${clauses.join(" AND ")}
      ORDER BY sale.invoice_generated_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}
