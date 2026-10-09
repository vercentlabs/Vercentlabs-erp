// Reading purchase returns: the detail (items, stock movements, supplier resolution, financial adjustments, related documents, history), the
// list with its views and filters, what a receipt or order may still return (the create form), and the order, receipt and supplier summaries.
import { decimal, div, formatDecimal, sub } from "../../../core/decimal.js";
import { loadPurchaseOrder } from "../purchase-orders/access.js";
import {
  DOCUMENT_STATUS_LABELS, EXPECTED_RESOLUTIONS, FINANCIAL_STATUS_LABELS, PurchaseReturnError, REASON_LABELS, REPLACEMENT_STATUS_LABELS, RESOLUTION_STATUS_LABELS, RESOLUTION_TYPES,
  RETURN_PERMISSIONS, RETURN_REASONS, RETURN_VIEWS, dayOf, isUuid, requireUuid, text,
} from "./constants.js";
import { getReturnBillingAllocations, returnStatuses } from "./resolution.js";
import { can, loadReturn, orderReader, receiptLinesFor, requireReturnAccess, returnableOf } from "./returns.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));

// getEligibleGoodsReceiptLines: per receipt line of an order (or one receipt) what may still be returned — entitlement, usable stock, held and
// rejected goods by their holds and cases — with other drafts as a warning. For the create form.
export async function getEligibleGoodsReceiptLines(client, context, { purchaseOrderId = null, goodsReceiptId = null, excludeReturnId = null } = {}) {
  requireReturnAccess(context);
  const organizationId = context.organizationId;
  let orderId = purchaseOrderId ? requireUuid(purchaseOrderId, "Purchase order") : null;
  if (goodsReceiptId) {
    const receipt = (await client.query(`SELECT purchase_order_id FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`, [organizationId, requireUuid(goodsReceiptId, "Goods receipt")])).rows[0];
    if (!receipt) throw new PurchaseReturnError(404, "Goods receipt not found.", "GOODS_RECEIPT_NOT_FOUND");
    orderId = receipt.purchase_order_id;
  }
  const order = await loadPurchaseOrder(client, orderReader(context), orderId);
  const lines = (await receiptLinesFor(client, organizationId, `receipt.purchase_order_id = $2 AND receipt.status = 'posted' AND receipt.reversed_at IS NULL AND line.product_type <> 'service'${goodsReceiptId ? " AND receipt.id = $3" : ""}`,
    goodsReceiptId ? [order.id, goodsReceiptId] : [order.id]));
  const ids = lines.map((line) => line.id);
  const holds = (await client.query(`SELECT * FROM tenant.goods_receipt_dispositions WHERE organization_id = $1 AND goods_receipt_line_id = ANY($2::uuid[])`, [organizationId, ids])).rows;
  const rejections = (await client.query(`SELECT * FROM tenant.receiving_rejections WHERE organization_id = $1 AND goods_receipt_line_id = ANY($2::uuid[]) AND rejection_stage = 'after_custody' AND status = 'open'`,
    [organizationId, ids])).rows;
  const drafts = (await client.query(
    `SELECT return_line.goods_receipt_line_id, sum(return_line.quantity) AS quantity, array_agg(DISTINCT purchase_return.return_number) AS numbers FROM tenant.purchase_return_lines return_line
       JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = return_line.organization_id AND purchase_return.id = return_line.purchase_return_id
      WHERE return_line.organization_id = $1 AND return_line.goods_receipt_line_id = ANY($2::uuid[]) AND purchase_return.document_status = 'draft' AND purchase_return.id IS DISTINCT FROM $3::uuid
      GROUP BY return_line.goods_receipt_line_id`, [organizationId, ids, excludeReturnId])).rows;
  return {
    order: { id: order.id, purchaseOrderNumber: order.purchase_order_number, supplierId: order.supplier_id, currencyCode: order.currency_code.trim() },
    lines: lines.map((line) => {
      const returnable = returnableOf(line);
      const draft = drafts.find((entry) => entry.goods_receipt_line_id === line.id);
      return {
        goodsReceiptLineId: line.id, goodsReceiptId: line.goods_receipt_id, receiptNumber: line.receipt_number, receiptDate: dayOf(line.receipt_date), lineNumber: line.line_number,
        orderLineNumber: line.order_line_number, purchaseOrderLineId: line.purchase_order_line_id, productId: line.product_id, description: line.description, productType: line.product_type,
        uom: line.uom_snapshot?.code ?? null, trackingType: line.tracking_type, batchId: line.batch_id, batchNumber: line.batch_number ?? null, warehouseId: line.warehouse_id,
        warehouseName: line.warehouse_name, locationId: line.warehouse_location_id, locationCode: line.location_code,
        received: dec(returnable.received), returned: dec(returnable.returned), entitlement: dec(returnable.entitlement), usable: dec(returnable.usable),
        unitValue: dec(decimal(line.order_ordered ?? 0) > 0n ? div(line.order_taxable ?? 0, line.order_ordered) : 0n),
        draftQuantity: draft ? dec(draft.quantity) : "0", draftReturns: draft?.numbers ?? [],
        holds: holds.filter((hold) => hold.goods_receipt_line_id === line.id).map((hold) => ({ id: hold.id, disposition: hold.disposition, locationId: hold.location_id,
          open: dec(sub(sub(sub(sub(hold.quantity, hold.released_quantity), hold.returned_quantity), hold.disposed_quantity), hold.blocked_quantity)) }))
          .filter((hold) => decimal(hold.open) > 0n),
        rejections: rejections.filter((rejection) => rejection.goods_receipt_line_id === line.id).map((rejection) => ({ id: rejection.id, rejectionNumber: rejection.rejection_number,
          open: dec(sub(sub(rejection.rejected_quantity, rejection.released_quantity), rejection.returned_quantity)), reason: rejection.rejection_reason })),
      };
    }),
  };
}

const statusView = (statuses) => ({
  financialStatus: statuses.financial, financialLabel: FINANCIAL_STATUS_LABELS[statuses.financial], resolutionStatus: statuses.resolution,
  resolutionLabel: RESOLUTION_STATUS_LABELS[statuses.resolution], replacementStatus: statuses.replacement, replacementLabel: REPLACEMENT_STATUS_LABELS[statuses.replacement],
});

// getPurchaseReturn: the return with everything its tabs show.
export async function getPurchaseReturn(client, context, returnId) {
  const row = await loadReturn(client, context, returnId);
  const organizationId = context.organizationId;
  const order = await loadPurchaseOrder(client, orderReader(context), row.purchase_order_id);
  const people = async (id) => (id ? (await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [id])).rows[0]?.full_name ?? null : null);
  const lines = (await client.query(
    `SELECT return_line.*, receipt_line.line_number AS receipt_line_number, receipt_line.goods_receipt_id, receipt.receipt_number, receipt_line.accepted_quantity, receipt_line.held_quantity,
            receipt_line.batch_number, receipt_line.expiry_date, order_line.line_number AS order_line_number, location.code AS location_code, rejection.rejection_number,
            (SELECT COALESCE(sum(other.quantity), 0) FROM tenant.purchase_return_lines other JOIN tenant.purchase_returns other_return ON other_return.organization_id = other.organization_id
               AND other_return.id = other.purchase_return_id WHERE other.organization_id = return_line.organization_id AND other.goods_receipt_line_id = return_line.goods_receipt_line_id
               AND other_return.document_status = 'posted' AND other_return.id <> return_line.purchase_return_id) AS returned_elsewhere
       FROM tenant.purchase_return_lines return_line
       JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = return_line.organization_id AND receipt_line.id = return_line.goods_receipt_line_id
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
       JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = return_line.organization_id AND order_line.id = return_line.purchase_order_line_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = return_line.organization_id AND location.id = return_line.warehouse_location_id
       LEFT JOIN tenant.receiving_rejections rejection ON rejection.organization_id = return_line.organization_id AND rejection.id = return_line.receiving_rejection_id
      WHERE return_line.organization_id = $1 AND return_line.purchase_return_id = $2 ORDER BY return_line.line_number`, [organizationId, row.id])).rows;
  const warehouse = row.warehouse_id ? (await client.query(`SELECT name, code FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [organizationId, row.warehouse_id])).rows[0] : null;
  const statuses = await returnStatuses(client, context, row);
  const movements = await getPurchaseReturnInventoryMovements(client, context, row.id, { checked: true });
  const resolutions = (await client.query(
    `SELECT resolution.*, users.full_name FROM tenant.purchase_return_resolutions resolution LEFT JOIN public.users users ON users.id = resolution.recorded_by
      WHERE resolution.organization_id = $1 AND resolution.purchase_return_id = $2 ORDER BY resolution.recorded_at`, [organizationId, row.id])).rows;
  const bills = (await client.query(
    `SELECT DISTINCT bill.id, bill.bill_number, COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS invoice, bill.status, bill.grand_total, bill.outstanding_amount
       FROM tenant.accounting_vendor_bills bill JOIN tenant.accounting_vendor_bill_lines line ON line.organization_id = bill.organization_id AND line.vendor_bill_id = bill.id
      WHERE bill.organization_id = $1 AND bill.bill_type = 'bill' AND line.purchase_order_line_id = ANY($2::uuid[]) AND bill.status NOT IN ('cancelled')`,
    [organizationId, [...new Set(lines.map((line) => line.purchase_order_line_id))]])).rows;
  const vendorCredits = (await client.query(
    `SELECT DISTINCT note.id, note.bill_number, note.status, note.grand_total FROM tenant.accounting_vendor_bills note
       LEFT JOIN tenant.purchase_return_financial_allocations allocation ON allocation.organization_id = note.organization_id AND allocation.debit_note_id = note.id
      WHERE note.organization_id = $1 AND note.bill_type = 'credit_note' AND (note.source_purchase_return_id = $2 OR allocation.purchase_return_id = $2)`, [organizationId, row.id])).rows;
  const history = (await client.query(
    `SELECT event.*, users.full_name FROM tenant.purchase_return_events event LEFT JOIN public.users users ON users.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.purchase_return_id = $2 ORDER BY event.occurred_at, event.id`, [organizationId, row.id])).rows;
  const draft = row.document_status === "draft";
  const posted = row.document_status === "posted";
  const receipts = [...new Map(lines.map((line) => [line.goods_receipt_id, { id: line.goods_receipt_id, number: line.receipt_number, href: `/procurement/goods-receipts/${line.goods_receipt_id}` }])).values()];
  return {
    purchaseReturn: {
      id: row.id, returnNumber: row.return_number, status: row.document_status, statusLabel: DOCUMENT_STATUS_LABELS[row.document_status], returnDate: dayOf(row.return_date),
      reason: row.reason, purchaseOrderId: order.id, purchaseOrderNumber: order.purchase_order_number, supplierId: row.supplier_id, supplierName: row.supplier_snapshot?.supplierName ?? null,
      supplier: row.supplier_snapshot, returnTo: row.return_to_address_snapshot, warehouseId: row.warehouse_id, warehouseName: warehouse?.name ?? null,
      expectedResolution: row.expected_resolution, expectedResolutionLabel: EXPECTED_RESOLUTIONS[row.expected_resolution] ?? null, supplierRmaReference: row.supplier_rma_reference,
      carrierReference: row.carrier_reference, trackingReference: row.tracking_reference, dispatchReference: row.dispatch_reference, internalNotes: row.internal_notes,
      supplierAcknowledgedAt: dayOf(row.supplier_acknowledged_at), supplierAcknowledgementReference: row.supplier_acknowledgement_reference, dispatchedAt: row.dispatched_at,
      createdAt: row.created_at, createdByName: await people(row.created_by), postedAt: row.posted_at, postedByName: await people(row.posted_by), cancelledAt: row.cancelled_at,
      cancelReason: row.cancel_reason, reversedAt: row.reversed_at, reversedByName: await people(row.reversed_by), reversalReason: row.reversal_reason, version: Number(row.version),
      replacementPurchaseOrderId: row.replacement_purchase_order_id, replacementNoCharge: row.replacement_no_charge, accrualJournalEntryId: row.accrual_journal_entry_id,
      ...statusView(statuses),
    },
    lines: lines.map((line) => ({
      id: line.id, lineNumber: line.line_number, goodsReceiptLineId: line.goods_receipt_line_id, goodsReceiptId: line.goods_receipt_id, receiptNumber: line.receipt_number,
      receiptLineNumber: line.receipt_line_number, orderLineNumber: line.order_line_number, productId: line.product_id, product: line.product_snapshot, description: line.description,
      uom: line.uom_snapshot, quantity: dec(line.quantity), baseQuantity: dec(line.base_quantity), received: dec(decimal(line.accepted_quantity) + decimal(line.held_quantity)),
      returnedElsewhere: dec(line.returned_elsewhere), reason: line.return_reason, reasonLabel: REASON_LABELS[line.return_reason] ?? line.return_reason, reasonNotes: line.reason_notes,
      stockDisposition: line.stock_disposition, locationCode: line.location_code, batchNumber: line.batch_number, expiryDate: dayOf(line.expiry_date), serialNumbers: line.serial_numbers,
      rejectionId: line.receiving_rejection_id, rejectionNumber: line.rejection_number, dispositionId: line.disposition_id, expectedCredit: dec(line.expected_credit_amount),
      billingAllocation: line.billing_allocation, notes: line.notes,
    })),
    movements,
    resolution: {
      expected: row.expected_resolution, ...statusView(statuses), figures: statuses.figures, replacementOrder: statuses.replacementOrder,
      entries: resolutions.map((entry) => ({ id: entry.id, type: entry.resolution_type, typeLabel: RESOLUTION_TYPES[entry.resolution_type], quantity: dec(entry.resolved_quantity),
        amount: dec(entry.amount), reference: entry.reference, notes: entry.notes, relatedDocumentType: entry.related_document_type, relatedDocumentId: entry.related_document_id,
        recordedAt: entry.recorded_at, recordedBy: entry.full_name })),
    },
    financial: {
      status: statuses.financial, label: FINANCIAL_STATUS_LABELS[statuses.financial], figures: statuses.figures, allocations: await getReturnBillingAllocations(client, context, row.id),
      bills: bills.map((bill) => ({ id: bill.id, billNumber: bill.bill_number, supplierInvoiceNumber: bill.invoice, status: bill.status, total: dec(bill.grand_total),
        outstanding: dec(bill.outstanding_amount), href: `/procurement/supplier-bills/${bill.id}` })),
      vendorCredits: vendorCredits.map((note) => ({ id: note.id, number: note.bill_number, status: note.status, total: dec(note.grand_total), href: `/procurement/debit-notes-credits/vendor-credits/${note.id}` })),
    },
    related: {
      purchaseOrder: { id: order.id, number: order.purchase_order_number, href: `/procurement/purchase-orders/${order.id}` }, receipts,
      rejections: lines.filter((line) => line.receiving_rejection_id).map((line) => ({ id: line.receiving_rejection_id, number: line.rejection_number, href: `/procurement/receiving-issues/${line.receiving_rejection_id}` })),
      replacement: statuses.replacementOrder ? { id: statuses.replacementOrder.purchaseOrderId, number: statuses.replacementOrder.purchaseOrderNumber, href: `/procurement/purchase-orders/${statuses.replacementOrder.purchaseOrderId}` } : null,
    },
    history: history.map((entry) => ({ id: entry.id, type: entry.event_type, summary: entry.summary, at: entry.occurred_at, actor: entry.full_name })),
    actions: {
      edit: draft && can(context, RETURN_PERMISSIONS.manage), cancel: draft && can(context, RETURN_PERMISSIONS.manage), validate: draft, post: draft && can(context, RETURN_PERMISSIONS.post),
      reverse: posted && can(context, RETURN_PERMISSIONS.reverse), acknowledge: (draft || posted) && can(context, RETURN_PERMISSIONS.resolve),
      createCredit: posted && (can(context, RETURN_PERMISSIONS.payables) || can(context, "procurement.credits.manage")) && decimal(statuses.figures.uncreditedQuantity) > 0n,
      refund: posted && can(context, RETURN_PERMISSIONS.resolve), resolve: posted && can(context, RETURN_PERMISSIONS.resolve),
      replacement: posted && !row.replacement_purchase_order_id && can(context, RETURN_PERMISSIONS.resolve), print: true,
    },
  };
}

// getPurchaseReturnInventoryMovements: Inventory's movements for the return (out at posting; back in at a reversal).
export async function getPurchaseReturnInventoryMovements(client, context, returnId, { checked = false } = {}) {
  if (!checked) await loadReturn(client, context, returnId);
  const { rows } = await client.query(
    `SELECT movement.id, movement.movement_number, movement.movement_type, movement.quantity, movement.reference_type, movement.reason, movement.occurred_at, movement.created_at,
            item.code AS item_code, item.name AS item_name, warehouse.name AS warehouse_name, location.code AS location_code
       FROM tenant.stock_movements movement
       LEFT JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
      WHERE movement.organization_id = $1 AND movement.reference_id = $2 AND movement.reference_type IN ('purchase_return', 'purchase_return_reversal') ORDER BY movement.ledger_sequence`,
    [context.organizationId, returnId]);
  return rows.map((row) => ({ id: row.id, number: row.movement_number, type: row.movement_type, direction: row.reference_type === "purchase_return" ? "out" : "in",
    quantity: dec(row.quantity), item: row.item_name, itemCode: row.item_code, warehouseName: row.warehouse_name, locationCode: row.location_code, reason: row.reason,
    at: row.occurred_at ?? row.created_at }));
}

const VIEW_SQL = {
  all: "", draft: " AND purchase_return.document_status = 'draft'", posted: " AND purchase_return.document_status = 'posted'",
  cancelled_reversed: " AND purchase_return.document_status IN ('cancelled', 'reversed')",
};

// listPurchaseReturns. filters: view, supplierId, purchaseOrderId, goodsReceiptId, warehouseId, dateFrom, dateTo, reason, status, financialStatus, resolutionStatus,
// replacementStatus, createdBy, search (return, supplier, PO, GRN, product).
export async function listPurchaseReturns(client, context, filters = {}) {
  requireReturnAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = VIEW_SQL[filters.view] ?? "";
  if (["draft", "posted", "cancelled", "reversed"].includes(filters.status)) where += ` AND purchase_return.document_status = ${bind(filters.status)}`;
  if (isUuid(filters.supplierId)) where += ` AND purchase_return.supplier_id = ${bind(filters.supplierId)}`;
  if (isUuid(filters.purchaseOrderId)) where += ` AND purchase_return.purchase_order_id = ${bind(filters.purchaseOrderId)}`;
  if (isUuid(filters.warehouseId)) where += ` AND purchase_return.warehouse_id = ${bind(filters.warehouseId)}`;
  if (isUuid(filters.createdBy)) where += ` AND purchase_return.created_by = ${bind(filters.createdBy)}`;
  if (isUuid(filters.goodsReceiptId))
    where += ` AND EXISTS (SELECT 1 FROM tenant.purchase_return_lines rl JOIN tenant.goods_receipt_lines gl ON gl.organization_id = rl.organization_id AND gl.id = rl.goods_receipt_line_id
      WHERE rl.organization_id = purchase_return.organization_id AND rl.purchase_return_id = purchase_return.id AND gl.goods_receipt_id = ${bind(filters.goodsReceiptId)})`;
  if (REASON_LABELS[filters.reason])
    where += ` AND EXISTS (SELECT 1 FROM tenant.purchase_return_lines rl WHERE rl.organization_id = purchase_return.organization_id AND rl.purchase_return_id = purchase_return.id AND rl.return_reason = ${bind(filters.reason)})`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom ?? ""))) where += ` AND purchase_return.return_date >= ${bind(filters.dateFrom)}::date`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo ?? ""))) where += ` AND purchase_return.return_date <= ${bind(filters.dateTo)}::date`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search}%`);
    where += ` AND (purchase_return.return_number ILIKE ${term} OR po.purchase_order_number ILIKE ${term} OR party.display_name ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.purchase_return_lines rl JOIN tenant.goods_receipt_lines gl ON gl.organization_id = rl.organization_id AND gl.id = rl.goods_receipt_line_id
                  JOIN tenant.goods_receipts gr ON gr.organization_id = gl.organization_id AND gr.id = gl.goods_receipt_id
                 WHERE rl.organization_id = purchase_return.organization_id AND rl.purchase_return_id = purchase_return.id AND (gr.receipt_number ILIKE ${term} OR rl.description ILIKE ${term})))`;
  }
  const { rows } = await client.query(
    `SELECT purchase_return.*, po.purchase_order_number, party.display_name AS supplier_name, warehouse.name AS warehouse_name, users.full_name AS created_by_name,
            (SELECT array_agg(DISTINCT gr.receipt_number) FROM tenant.purchase_return_lines rl JOIN tenant.goods_receipt_lines gl ON gl.organization_id = rl.organization_id AND gl.id = rl.goods_receipt_line_id
               JOIN tenant.goods_receipts gr ON gr.organization_id = gl.organization_id AND gr.id = gl.goods_receipt_id WHERE rl.organization_id = purchase_return.organization_id
               AND rl.purchase_return_id = purchase_return.id) AS receipts,
            (SELECT count(*) FROM tenant.purchase_return_lines rl WHERE rl.organization_id = purchase_return.organization_id AND rl.purchase_return_id = purchase_return.id)::int AS items,
            (SELECT COALESCE(sum(rl.quantity), 0) FROM tenant.purchase_return_lines rl WHERE rl.organization_id = purchase_return.organization_id AND rl.purchase_return_id = purchase_return.id) AS quantity
       FROM tenant.purchase_returns purchase_return
       JOIN tenant.purchase_orders po ON po.organization_id = purchase_return.organization_id AND po.id = purchase_return.purchase_order_id
       JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = purchase_return.organization_id AND warehouse.id = purchase_return.warehouse_id
       LEFT JOIN public.users users ON users.id = purchase_return.created_by
      WHERE purchase_return.organization_id = $1${where} ORDER BY purchase_return.return_date DESC, purchase_return.created_at DESC LIMIT 300`, values);
  const result = [];
  for (const row of rows) {
    const statuses = await returnStatuses(client, context, row);
    const entry = {
      id: row.id, returnNumber: row.return_number, returnDate: dayOf(row.return_date), status: row.document_status, statusLabel: DOCUMENT_STATUS_LABELS[row.document_status],
      supplierId: row.supplier_id, supplierName: row.supplier_name, purchaseOrderId: row.purchase_order_id, purchaseOrderNumber: row.purchase_order_number, receipts: row.receipts ?? [],
      warehouseName: row.warehouse_name, items: row.items, quantity: dec(row.quantity), reason: row.reason, expectedResolution: row.expected_resolution,
      expectedResolutionLabel: EXPECTED_RESOLUTIONS[row.expected_resolution] ?? null, createdByName: row.created_by_name, ...statusView(statuses),
    };
    if (filters.financialStatus && entry.financialStatus !== filters.financialStatus) continue;
    if (filters.resolutionStatus && entry.resolutionStatus !== filters.resolutionStatus) continue;
    if (filters.replacementStatus && entry.replacementStatus !== filters.replacementStatus) continue;
    if (filters.view === "awaiting_resolution" && !(entry.status === "posted" && ["pending", "partially_resolved"].includes(entry.resolutionStatus))) continue;
    if (filters.view === "awaiting_financial" && !(entry.status === "posted" && ["pending", "partially_reconciled"].includes(entry.financialStatus))) continue;
    if (filters.view === "awaiting_replacement" && !(entry.status === "posted" && ["awaiting", "partially_received"].includes(entry.replacementStatus))) continue;
    result.push(entry);
  }
  return result;
}

// getPurchaseOrderReturnSummary / getGoodsReceiptReturnSummary / getSupplierPurchaseReturns: received, returned (posted) and net retained —
// not current stock, which sales and consumption also change — and the returns themselves.
export async function getPurchaseOrderReturnSummary(client, context, orderId) {
  const order = await loadPurchaseOrder(client, orderReader(context), requireUuid(orderId, "Purchase order"));
  const lines = (await client.query(`SELECT purchase_order_line_id, line_number, received_quantity, returned_quantity FROM tenant.purchase_order_line_status
     WHERE organization_id = $1 AND purchase_order_id = $2 AND receipt_required ORDER BY line_number`, [context.organizationId, order.id])).rows;
  return {
    lines: lines.map((line) => ({ purchaseOrderLineId: line.purchase_order_line_id, lineNumber: line.line_number, received: dec(line.received_quantity), returned: dec(line.returned_quantity),
      netRetained: dec(sub(line.received_quantity, line.returned_quantity)) })),
    returns: await listPurchaseReturns(client, context, { purchaseOrderId: order.id }),
  };
}
export async function getGoodsReceiptReturnSummary(client, context, receiptId) {
  const receipt = (await client.query(`SELECT id, purchase_order_id FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(receiptId, "Goods receipt")])).rows[0];
  if (!receipt) throw new PurchaseReturnError(404, "Goods receipt not found.", "GOODS_RECEIPT_NOT_FOUND");
  const eligible = await getEligibleGoodsReceiptLines(client, context, { goodsReceiptId: receipt.id });
  return { lines: eligible.lines.map((line) => ({ goodsReceiptLineId: line.goodsReceiptLineId, lineNumber: line.lineNumber, description: line.description, received: line.received,
    returned: line.returned, netRetained: dec(sub(line.received, line.returned)), returnable: line.entitlement })), returns: await listPurchaseReturns(client, context, { goodsReceiptId: receipt.id }) };
}
export async function getSupplierPurchaseReturns(client, context, supplierId) {
  const returns = await listPurchaseReturns(client, context, { supplierId: requireUuid(supplierId, "Supplier") });
  const posted = returns.filter((entry) => entry.status === "posted");
  return { returns, postedCount: posted.length, returnedQuantity: dec(posted.reduce((total, entry) => total + decimal(entry.quantity), 0n)),
    awaitingFinancial: posted.filter((entry) => ["pending", "partially_reconciled"].includes(entry.financialStatus)).length,
    awaitingResolution: posted.filter((entry) => ["pending", "partially_resolved"].includes(entry.resolutionStatus)).length };
}

export function getPurchaseReturnOptions(context) {
  requireReturnAccess(context);
  return { reasons: RETURN_REASONS, expectedResolutions: Object.entries(EXPECTED_RESOLUTIONS).map(([code, label]) => ({ code, label })), views: RETURN_VIEWS,
    capabilities: { manage: can(context, RETURN_PERMISSIONS.manage), post: can(context, RETURN_PERMISSIONS.post), reverse: can(context, RETURN_PERMISSIONS.reverse),
      commercial: can(context, RETURN_PERMISSIONS.commercial), resolve: can(context, RETURN_PERMISSIONS.resolve), createCredit: can(context, RETURN_PERMISSIONS.payables) || can(context, "procurement.credits.manage") } };
}
