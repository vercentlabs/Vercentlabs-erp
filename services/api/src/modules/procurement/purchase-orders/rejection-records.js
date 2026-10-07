// Receiving rejections, read side: one case with everything it links to (the
// order, the receipt, Quality's inspection, the documents that resolved it,
// and — for those who may see them — the supplier bills on its line), the
// lists and Needs Attention views, and the summaries the purchase order, the
// goods receipt and the supplier show.
import { decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { poCan } from "./access.js";
import { PO_PERMISSIONS, isUuid, requireUuid, text } from "./constants.js";
import {
  EXPECTED_RESOLUTIONS, REJECTION_REASONS, RESOLUTION_TYPES, SOURCE_LABELS, STAGE_LABELS, blockedQuantityOf, loadRejection, reasonLabel, rejectionScopeSql, requireRejectionAccess,
} from "./rejection-core.js";
import { resolutionOptionsFor } from "./rejections.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));

// The Needs Attention views: filters over cases and the documents around them, not statuses of their own.
export const REJECTION_VIEWS = Object.freeze([
  { key: "open", label: "Open Receiving Rejections" },
  { key: "awaiting_replacement", label: "Awaiting Supplier Replacement" },
  { key: "awaiting_quality", label: "Awaiting Quality Decision" },
  { key: "awaiting_return", label: "Awaiting Purchase Return" },
  { key: "awaiting_financial", label: "Awaiting Financial Correction" },
  { key: "resolved", label: "Resolved Rejections" },
  { key: "cancelled", label: "Cancelled" },
  { key: "before_custody", label: "Before-Custody Refusals" },
  { key: "shortages_wrong", label: "Shortages / Wrong Deliveries" },
  { key: "after_custody", label: "Post-Custody Rejections" },
  { key: "all", label: "All Rejections" },
]);
// A line billed for more than it may now be billed: Finance corrects it with a debit note.
const BILL_MISMATCH_SQL = `EXISTS (SELECT 1 FROM tenant.purchase_order_line_status status WHERE status.organization_id = rejection.organization_id
  AND status.purchase_order_line_id = rejection.purchase_order_line_id AND status.posted_billed_quantity > status.billable_quantity)`;
const VIEW_SQL = {
  open: " AND rejection.status = 'open'",
  awaiting_replacement: " AND rejection.status = 'open' AND rejection.rejection_stage = 'before_custody' AND rejection.expected_resolution = 'replacement_expected'",
  awaiting_quality: ` AND rejection.status = 'open' AND rejection.rejection_stage = 'after_custody' AND (rejection.expected_resolution = 'quality_review'
    OR EXISTS (SELECT 1 FROM tenant.quality_inspections inspection WHERE inspection.organization_id = rejection.organization_id AND inspection.id = rejection.quality_inspection_id
      AND inspection.status IN ('draft', 'in_progress')))`,
  awaiting_return: " AND rejection.status = 'open' AND rejection.rejection_stage = 'after_custody' AND COALESCE(rejection.expected_resolution, 'purchase_return') = 'purchase_return'",
  awaiting_financial: ` AND rejection.status <> 'cancelled' AND rejection.rejection_stage = 'after_custody' AND ${BILL_MISMATCH_SQL}`,
  before_custody: " AND rejection.status = 'open' AND rejection.rejection_stage = 'before_custody'",
  shortages_wrong: " AND rejection.status <> 'cancelled' AND rejection.rejection_reason IN ('incorrect_quantity', 'wrong_product', 'wrong_specification')",
  after_custody: " AND rejection.status = 'open' AND rejection.rejection_stage = 'after_custody'",
  resolved: " AND rejection.status = 'resolved'",
  cancelled: " AND rejection.status = 'cancelled'",
  all: "",
};

const LIST_SELECT = `
  SELECT rejection.*, po.purchase_order_number, receipt.receipt_number, party.display_name AS supplier_name, warehouse.name AS warehouse_name, reporter.full_name AS reported_by_name,
         ${BILL_MISMATCH_SQL} AS bill_mismatch
    FROM tenant.receiving_rejections rejection
    JOIN tenant.purchase_orders po ON po.organization_id = rejection.organization_id AND po.id = rejection.purchase_order_id
    JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
    LEFT JOIN tenant.goods_receipts receipt ON receipt.organization_id = rejection.organization_id AND receipt.id = rejection.goods_receipt_id
    LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = rejection.organization_id AND warehouse.id = rejection.warehouse_id
    LEFT JOIN public.users reporter ON reporter.id = rejection.reported_by_user_id`;

const toRow = (row) => ({
  id: row.id, rejectionNumber: row.rejection_number, status: row.status, stage: row.rejection_stage, stageLabel: STAGE_LABELS[row.rejection_stage], source: row.stock_source,
  sourceLabel: SOURCE_LABELS[row.stock_source], reason: row.rejection_reason, reasonLabel: reasonLabel(row.rejection_reason), purchaseOrderId: row.purchase_order_id,
  purchaseOrderNumber: row.purchase_order_number, purchaseOrderLineId: row.purchase_order_line_id, goodsReceiptId: row.goods_receipt_id, receiptNumber: row.receipt_number,
  supplierId: row.supplier_id, supplierName: row.supplier_name, warehouseName: row.warehouse_name, description: row.description_snapshot, product: row.product_snapshot,
  uom: row.uom_snapshot, quantity: dec(row.rejected_quantity), resolved: dec(row.resolved_quantity), open: dec(sub(row.rejected_quantity, row.resolved_quantity)),
  held: row.rejection_stage === "after_custody" && row.status === "open" ? dec(blockedQuantityOf(row)) : "0.000000", expectedResolution: row.expected_resolution,
  observedAt: row.observed_at, reportedBy: row.reported_by_name, billMismatch: Boolean(row.bill_mismatch),
});

// filters: view, stage, reason, purchaseOrderId, goodsReceiptId, supplierId, warehouseId, productId, dateFrom, dateTo, search.
export async function listRejections(client, context, filters = {}) {
  requireRejectionAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = rejectionScopeSql(context, values);
  where += VIEW_SQL[filters.view] ?? VIEW_SQL.all;
  if (["before_custody", "after_custody"].includes(filters.stage)) where += ` AND rejection.rejection_stage = ${bind(filters.stage)}`;
  if (REJECTION_REASONS.some((entry) => entry.code === filters.reason)) where += ` AND rejection.rejection_reason = ${bind(filters.reason)}`;
  for (const [key, column] of [["purchaseOrderId", "purchase_order_id"], ["goodsReceiptId", "goods_receipt_id"], ["supplierId", "supplier_id"], ["warehouseId", "warehouse_id"],
    ["productId", "product_id"], ["qualityInspectionId", "quality_inspection_id"]])
    if (isUuid(filters[key])) where += ` AND rejection.${column} = ${bind(filters[key])}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom ?? ""))) where += ` AND rejection.observed_at >= ${bind(filters.dateFrom)}::date`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo ?? ""))) where += ` AND rejection.observed_at < ${bind(filters.dateTo)}::date + 1`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search}%`);
    where += ` AND (rejection.rejection_number ILIKE ${term} OR po.purchase_order_number ILIKE ${term} OR receipt.receipt_number ILIKE ${term} OR party.display_name ILIKE ${term}
      OR rejection.description_snapshot ILIKE ${term} OR rejection.batch_number ILIKE ${term})`;
  }
  const { rows } = await client.query(`${LIST_SELECT} WHERE rejection.organization_id = $1${where} ORDER BY rejection.observed_at DESC, rejection.rejection_number DESC LIMIT 300`, values);
  return rows.map(toRow);
}

// getPurchaseOrderRejections / getGoodsReceiptRejections / getOpenSupplierRejections
export const getPurchaseOrderRejections = (client, context, orderId) => listRejections(client, context, { purchaseOrderId: orderId, view: "all" });
export const getGoodsReceiptRejections = (client, context, receiptId) => listRejections(client, context, { goodsReceiptId: receiptId, view: "all" });
export const getOpenSupplierRejections = (client, context, supplierId) => listRejections(client, context, { supplierId, view: "open" });

// getRejectionSummary: per order line, what was refused at the dock and rejected after receipt, and the open and resolved cases.
export async function getRejectionSummary(client, context, orderId) {
  requireRejectionAccess(context);
  const rows = (await client.query(
    `SELECT purchase_order_line_id,
            COALESCE(sum(rejected_quantity) FILTER (WHERE rejection_stage = 'before_custody' AND status <> 'cancelled'), 0) AS refused,
            COALESCE(sum(rejected_quantity) FILTER (WHERE rejection_stage = 'after_custody' AND status <> 'cancelled'), 0) AS rejected,
            count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'resolved')::int AS resolved
       FROM tenant.receiving_rejections WHERE organization_id = $1 AND purchase_order_id = $2 GROUP BY purchase_order_line_id`, [context.organizationId, orderId])).rows;
  return {
    open: rows.reduce((total, row) => total + row.open, 0), resolved: rows.reduce((total, row) => total + row.resolved, 0),
    lines: rows.map((row) => ({ purchaseOrderLineId: row.purchase_order_line_id, refusedAtDock: dec(row.refused), rejectedAfterReceipt: dec(row.rejected), open: row.open, resolved: row.resolved })),
  };
}

const DOCUMENT_LABELS = { purchase_return: "Purchase return", goods_receipt_line: "Goods receipt", purchase_order_line_cancellation: "Cancellation", stock_movement: "Stock movement" };

export async function getRejection(client, context, rejectionId) {
  const rejection = await loadRejection(client, context, rejectionId);
  const organizationId = context.organizationId;
  const row = (await client.query(`${LIST_SELECT} WHERE rejection.organization_id = $1 AND rejection.id = $2`, [organizationId, rejection.id])).rows[0];
  const context2 = (await client.query(
    `SELECT location.code AS location_code, source.code AS source_location_code, inspection.inspection_number, inspection.status AS inspection_status,
            inspection.accepted_quantity AS inspection_accepted, inspection.rejected_quantity AS inspection_rejected, order_line.line_number AS order_line_number,
            order_line.ordered_quantity, receipt_line.line_number AS receipt_line_number, receipt_line.accepted_quantity, receipt_line.held_quantity, creator.full_name AS created_by_name,
            resolver.full_name AS resolved_by_name, canceller.full_name AS cancelled_by_name
       FROM tenant.receiving_rejections rejection
       JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = rejection.organization_id AND order_line.id = rejection.purchase_order_line_id
       LEFT JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = rejection.organization_id AND receipt_line.id = rejection.goods_receipt_line_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = rejection.organization_id AND location.id = rejection.location_id
       LEFT JOIN tenant.warehouse_locations source ON source.organization_id = rejection.organization_id AND source.id = rejection.source_location_id
       LEFT JOIN tenant.quality_inspections inspection ON inspection.organization_id = rejection.organization_id AND inspection.id = rejection.quality_inspection_id
       LEFT JOIN public.users creator ON creator.id = rejection.created_by LEFT JOIN public.users resolver ON resolver.id = rejection.resolved_by
       LEFT JOIN public.users canceller ON canceller.id = rejection.cancelled_by
      WHERE rejection.organization_id = $1 AND rejection.id = $2`, [organizationId, rejection.id])).rows[0];
  const resolutions = (await client.query(
    `SELECT resolution.*, users.full_name, purchase_return.return_number, receipt.receipt_number, movement.movement_number
       FROM tenant.receiving_rejection_resolutions resolution
       LEFT JOIN public.users users ON users.id = resolution.resolved_by
       LEFT JOIN tenant.purchase_returns purchase_return ON resolution.related_document_type = 'purchase_return' AND purchase_return.organization_id = resolution.organization_id
         AND purchase_return.id = resolution.related_document_id
       LEFT JOIN tenant.goods_receipt_lines receipt_line ON resolution.related_document_type = 'goods_receipt_line' AND receipt_line.organization_id = resolution.organization_id
         AND receipt_line.id = resolution.related_document_id
       LEFT JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
       LEFT JOIN tenant.stock_movements movement ON resolution.related_document_type = 'stock_movement' AND movement.organization_id = resolution.organization_id
         AND movement.id = resolution.related_document_id
      WHERE resolution.organization_id = $1 AND resolution.receiving_rejection_id = $2 ORDER BY resolution.resolved_at`, [organizationId, rejection.id])).rows;
  const events = (await client.query(
    `SELECT event.id, event.event_type, event.summary, event.occurred_at, users.full_name FROM tenant.receiving_rejection_events event
       LEFT JOIN public.users users ON users.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.receiving_rejection_id = $2 ORDER BY event.occurred_at DESC, event.id DESC`, [organizationId, rejection.id])).rows;
  const files = (await client.query(
    `SELECT id, file_name, entity_type, created_at FROM public.attachments
      WHERE organization_id = $1 AND archived_at IS NULL AND ((entity_type = 'procurement.receiving_rejection' AND entity_id = $2::text) OR id = ANY($3::uuid[]))
      ORDER BY created_at`, [organizationId, rejection.id, rejection.evidence_file_ids])).rows;
  const movements = (await client.query(
    `SELECT movement.id, movement.movement_number, movement.movement_type, movement.quantity, movement.occurred_at, warehouse.name AS warehouse_name, location.code AS location_code
       FROM tenant.stock_movements movement
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
      WHERE movement.organization_id = $1 AND movement.id = ANY($2::uuid[]) ORDER BY movement.occurred_at, movement.movement_number`,
    [organizationId, [...rejection.stock_movement_ids, ...resolutions.flatMap((entry) => entry.stock_movement_ids)]])).rows;
  const seesMoney = poCan(context, PO_PERMISSIONS.rejectionsFinancial);
  let financial = null;
  if (seesMoney) {
    const status = (await client.query(`SELECT billed_quantity, posted_billed_quantity, billable_quantity, billing_basis FROM tenant.purchase_order_line_status WHERE organization_id = $1 AND purchase_order_line_id = $2`,
      [organizationId, rejection.purchase_order_line_id])).rows[0];
    const bills = (await client.query(
      `SELECT bill.id, bill.bill_number, COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice_number, bill.status, bill.bill_type, bill_line.quantity
         FROM tenant.accounting_vendor_bill_lines bill_line JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = bill_line.organization_id AND bill.id = bill_line.vendor_bill_id
        WHERE bill_line.organization_id = $1 AND bill_line.purchase_order_line_id = $2 AND bill.status NOT IN ('cancelled', 'reversed') ORDER BY bill.created_at`,
      [organizationId, rejection.purchase_order_line_id])).rows;
    const excess = status ? sub(status.posted_billed_quantity, status.billable_quantity) : 0n;
    financial = {
      billingBasis: status?.billing_basis ?? null, billed: dec(status?.billed_quantity ?? 0), postedBilled: dec(status?.posted_billed_quantity ?? 0), billable: dec(status?.billable_quantity ?? 0),
      mismatch: excess > 0n ? dec(excess) : null,
      bills: bills.map((bill) => ({ id: bill.id, number: bill.bill_number, supplierInvoiceNumber: bill.supplier_invoice_number, status: bill.status, type: bill.bill_type, quantity: dec(bill.quantity) })),
      note: excess > 0n ? `The supplier has been billed for ${dec(excess)} more than may now be billed on this line. Finance corrects it with a vendor credit; the bill itself is never changed.` : null,
    };
  }
  const options = await resolutionOptionsFor(client, context, rejection);
  const open = rejection.status === "open";
  return {
    rejection: {
      ...toRow(row), presentedQuantity: dec(rejection.presented_quantity), baseQuantity: dec(rejection.base_quantity), conversionFactor: dec(rejection.conversion_factor),
      reasonTags: rejection.reason_tags.map((tag) => ({ code: tag, label: reasonLabel(tag) })), explanation: rejection.description,
      deliveredProductDescription: rejection.delivered_product_description, batchNumber: rejection.batch_number, expiryDate: rejection.expiry_date, serialNumbers: rejection.serial_numbers,
      locationCode: context2.location_code, sourceLocationCode: context2.source_location_code, orderLineNumber: context2.order_line_number, orderedQuantity: dec(context2.ordered_quantity),
      receiptLineNumber: context2.receipt_line_number, receiptLineId: rejection.goods_receipt_line_id,
      receiptReceivedQuantity: context2.receipt_line_number ? dec(decimal(context2.accepted_quantity) + decimal(context2.held_quantity)) : null,
      inspection: rejection.quality_inspection_id ? { id: rejection.quality_inspection_id, number: context2.inspection_number, status: context2.inspection_status,
        accepted: dec(context2.inspection_accepted), rejected: dec(context2.inspection_rejected) } : null,
      returned: dec(rejection.returned_quantity), released: dec(rejection.released_quantity), disposed: dec(rejection.disposed_quantity),
      expectedResolutionLabel: EXPECTED_RESOLUTIONS.find((entry) => entry.code === rejection.expected_resolution)?.label ?? null,
      resolutionType: rejection.resolution_type, resolutionNotes: rejection.resolution_notes, resolvedAt: rejection.resolved_at, resolvedByName: context2.resolved_by_name,
      cancelledAt: rejection.cancelled_at, cancelledByName: context2.cancelled_by_name, cancelReason: rejection.cancel_reason, createdAt: rejection.created_at,
      createdByName: context2.created_by_name, updatedAt: rejection.updated_at, reportedByUserId: rejection.reported_by_user_id,
    },
    resolutions: resolutions.map((entry) => ({
      id: entry.id, type: entry.resolution_type, label: RESOLUTION_TYPES.find((type) => type.code === entry.resolution_type)?.label ?? entry.resolution_type, quantity: dec(entry.quantity_resolved),
      notes: entry.resolution_notes, at: entry.resolved_at, by: entry.full_name, documentType: entry.related_document_type, documentLabel: DOCUMENT_LABELS[entry.related_document_type] ?? null,
      documentId: entry.related_document_id, documentNumber: entry.return_number ?? entry.receipt_number ?? entry.movement_number ?? null,
    })),
    movements: movements.map((movement) => ({ id: movement.id, number: movement.movement_number, type: movement.movement_type, quantity: dec(movement.quantity), at: movement.occurred_at,
      warehouseName: movement.warehouse_name, locationCode: movement.location_code })),
    files: files.map((file) => ({ id: file.id, fileName: file.file_name, fromReceipt: file.entity_type === "procurement.goods_receipt", uploadedAt: file.created_at })),
    history: events.map((event) => ({ id: event.id, type: event.event_type, summary: event.summary, at: event.occurred_at, actor: event.full_name })),
    financial,
    resolution: options,
    reasons: REJECTION_REASONS, expectedResolutions: EXPECTED_RESOLUTIONS,
    actions: {
      edit: open && poCan(context, PO_PERMISSIONS.rejectionsEdit), cancel: open && decimal(rejection.resolved_quantity) === 0n && poCan(context, PO_PERMISSIONS.rejectionsCancel),
      resolve: open && options.options.some((option) => option.enabled), attach: open && (poCan(context, PO_PERMISSIONS.rejectionsRecord) || poCan(context, PO_PERMISSIONS.rejectionsQuality)),
    },
  };
}

// getInspectionRejections: for a Quality inspection, whether it inspects goods held on a goods receipt, whether its decision allows recording a
// rejection now, and the cases already recorded from it.
export async function getInspectionRejections(client, context, inspectionId) {
  requireRejectionAccess(context);
  const row = (await client.query(
    `SELECT inspection.status, inspection.rejected_quantity, disposition.id AS disposition_id FROM tenant.quality_inspections inspection
       LEFT JOIN tenant.goods_receipt_dispositions disposition ON disposition.organization_id = inspection.organization_id AND disposition.quality_inspection_id = inspection.id
      WHERE inspection.organization_id = $1 AND inspection.id = $2`, [context.organizationId, requireUuid(inspectionId, "Inspection")])).rows[0];
  if (!row?.disposition_id) return { linked: false, decided: false, canRecord: false, rows: [] };
  const rows = await listRejections(client, context, { view: "all", qualityInspectionId: inspectionId });
  const decided = ["failed", "conditionally_accepted"].includes(row.status) && decimal(row.rejected_quantity) > 0n;
  return { linked: true, decided, canRecord: decided && !rows.some((entry) => entry.status !== "cancelled") && poCan(context, PO_PERMISSIONS.rejectionsQuality), rows };
}
