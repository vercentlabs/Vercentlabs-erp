// Invoices of a sales order. An order can be invoiced in several parts
// (SO-001 → INV-001 for 4, INV-002 for 6). Sales says what to bill; Finance
// owns the invoice: it is created as a draft customer invoice with the
// order's agreed prices, the discounts and tax in proportion to the quantity
// billed, and is posted by Finance. The order itself never posts tax.
//
// What can be billed depends on the invoicing policy in Sales settings:
//   ordered    any quantity ordered and not yet invoiced or cancelled
//   fulfilled  goods only once delivered; services as ordered
// An invoice can never bill more than that, counting draft invoices too, and
// a retried request with the same key returns the invoice already made.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { createInvoiceFromSalesRequest } from "../../accounting/receivables.js";
import { applySalesAdvancesToInvoiceRequest } from "../after-sales.js";
import { assertOrderVisible, requireOrderAccess, requireOrderPermission } from "./access.js";
import { ORDER_PERMISSIONS, OrderError, STATUS, requireUuid, text } from "./constants.js";
import { loadOrderLineProgress, refreshSalesOrderProgress } from "./progress.js";
import { lockOrder, recordOrderEvent } from "./versions.js";

const EPSILON = 1e-6;

async function invoicingBasis(client, context, requested) {
  const setting = (await client.query(`SELECT invoice_quantity_basis FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0]?.invoice_quantity_basis;
  const basis = requested || setting || "ordered";
  if (!["ordered", "fulfilled"].includes(basis)) throw new OrderError(400, "Choose whether ordered or delivered quantities are invoiced.", "SALES_ORDER_VALIDATION");
  return basis;
}
// What can be invoiced on a line now.
const eligible = (line, basis) => (basis === "fulfilled" && line.deliverable ? Math.max(0, Math.min(line.delivered, line.ordered - line.cancelled) - line.invoiced) : line.remainingToInvoice);

// What a new invoice of the order would bill.
export async function getInvoiceProposal(client, context, orderId, input = {}) {
  requireOrderAccess(context);
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const basis = await invoicingBasis(client, context, input.quantityBasis);
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  return {
    orderId: order.id, quantityBasis: basis, canInvoice: order.lifecycle_status === STATUS.confirmed,
    lines: lines.filter((line) => line.remainingToInvoice > EPSILON).map((line) => ({
      salesOrderLineId: line.lineId, itemName: line.itemName, unit: line.unit, ordered: line.ordered, delivered: line.delivered, invoiced: line.invoiced, cancelled: line.cancelled,
      eligible: eligible(line, basis), isService: !line.deliverable,
    })),
  };
}

// input: { idempotencyKey, lines?: [{ salesOrderLineId, quantity }], quantityBasis? }
// Without `lines`, everything that can be invoiced now is billed.
export async function createInvoiceFromSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.invoice, "You do not have permission to create invoices from sales orders.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new OrderError(400, "A request key is required to create an invoice.", "SALES_ORDER_VALIDATION");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const existing = (await client.query(
    `SELECT request.id, request.sales_order_id, invoice.id AS invoice_id, invoice.invoice_number
       FROM tenant.sales_invoice_requests request
       LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = request.organization_id AND invoice.source_sales_invoice_request_id = request.id
      WHERE request.organization_id = $1 AND request.idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.sales_order_id !== order.id) throw new OrderError(409, "That request key was used for another order.", "SALES_ORDER_VALIDATION");
    return { invoiceId: existing.invoice_id, invoiceNumber: existing.invoice_number, replayed: true };
  }
  if (order.lifecycle_status !== STATUS.confirmed) throw new OrderError(409, "Only a confirmed order can be invoiced.", "SALES_ORDER_NOT_CONFIRMED");
  const basis = await invoicingBasis(client, context, input.quantityBasis);
  // The counters Finance reads must include every valid invoice, drafts too.
  const { lines: progress } = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  const byId = new Map(progress.map((line) => [line.lineId, line]));
  const chosen = Array.isArray(input.lines) && input.lines.length
    ? input.lines.map((entry) => ({ line: byId.get(requireUuid(entry.salesOrderLineId, "Order line")), quantity: Number(entry.quantity) })).filter((entry) => !(entry.quantity === 0))
    : progress.filter((line) => eligible(line, basis) > EPSILON).map((line) => ({ line, quantity: eligible(line, basis) }));
  if (!chosen.length)
    throw new OrderError(409, basis === "fulfilled" ? "Nothing delivered is left to invoice. Deliver the goods first." : "Nothing is left to invoice on this order.", "SALES_ORDER_NOTHING_TO_INVOICE");
  const seen = new Set();
  for (const { line, quantity } of chosen) {
    if (!line) throw new OrderError(404, "An order line was not found on this order.", "SALES_ORDER_LINE_NOT_FOUND");
    if (seen.has(line.lineId)) throw new OrderError(400, `${line.itemName} is on the invoice twice.`, "SALES_ORDER_VALIDATION");
    seen.add(line.lineId);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new OrderError(400, `${line.itemName}: enter the quantity to invoice.`, "SALES_ORDER_VALIDATION");
    const available = eligible(line, basis);
    if (quantity > available + EPSILON)
      throw new OrderError(409, `${line.itemName}: only ${available} ${line.unit ?? ""} can be invoiced now.`.replace("  ", " "), "SALES_ORDER_INVOICE_EXCEEDS_REMAINING");
  }
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "sales_invoice_request" });
  const payload = {
    salesOrderId: order.id, salesOrderNumber: order.sales_order_number, salesOrderVersionId: order.current_version_id, partyId: order.party_id, quantityBasis: basis,
    lines: chosen.map(({ line, quantity }) => ({ salesOrderLineId: line.lineId, itemId: line.itemId, quantity: line.ordered, remainingQuantity: String(quantity), lineTotal: line.lineTotal })),
  };
  const request = (await client.query(
    `INSERT INTO tenant.sales_invoice_requests (organization_id, request_number, sales_order_id, sales_order_version_id, quantity_basis, idempotency_key, payload, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING id`,
    [context.organizationId, number, order.id, order.current_version_id, basis, key, JSON.stringify(payload), context.userId ?? null])).rows[0];
  // Deposits already received are deducted from what this invoice bills.
  const billedValue = chosen.reduce((total, { line, quantity }) => total + (line.lineTotal * quantity) / (line.ordered || 1), 0);
  const advances = await applySalesAdvancesToInvoiceRequest(client, context, order.id, request.id, billedValue);
  // Finance creates the draft invoice; the Sales permission checked above authorises asking for it.
  let invoice;
  try {
    invoice = await createInvoiceFromSalesRequest(client, { organizationId: context.organizationId, userId: context.userId ?? null, permissions: ["accounting.view", "accounting.receivables.manage"], roleSlugs: [] }, request.id);
  } catch (error) {
    if (error?.name !== "AccountingError") throw error;
    throw new OrderError(error.status ?? 409, `The invoice could not be created: ${error.message}`, error.code ?? "SALES_ORDER_INVOICE_FAILED");
  }
  // Finance reports a failed import instead of throwing; nothing is kept when that happens.
  if (invoice?.accountingImportFailed) throw new OrderError(409, `The invoice could not be created: ${invoice.message}`, "SALES_ORDER_INVOICE_FAILED");
  const header = invoice.invoice ?? invoice;
  await recordOrderEvent(client, context, order.id, "sales_order.invoice_created", STATUS.confirmed, STATUS.confirmed, {
    invoiceId: header.id, invoiceNumber: header.invoice_number, total: header.grand_total, quantityBasis: basis, advancesApplied: advances.applied.length,
    lines: chosen.map(({ line, quantity }) => ({ item: line.itemName, quantity, unit: line.unit })),
  });
  const refreshed = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { invoiceId: header.id, invoiceNumber: header.invoice_number, total: header.grand_total, replayed: false, orderStatus: refreshed.lifecycleStatus, billingStatus: refreshed.billingStatus };
}
