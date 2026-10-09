// Goods receipts, read side: what an order still has to receive, a receipt in
// full (lines, dispositions, stock movements, bill matching, returns,
// discrepancies with their evidence, history), the receipts list, and the
// Inventory reconciliation — what each posted line should have put into stock
// against what Inventory actually holds for it. Costs are shown only to those
// who may see payables; warehouse staff see quantities.
import { LEDGER_TYPE_LABELS } from "../../stock/ledger-posting.js";
import { add, decimal, formatDecimal, mul, sub } from "../../../core/decimal.js";
import { allowedItemUnits } from "../../products/uom.js";
import { loadPurchaseOrder, poCan, poScopeSql, requirePoAccess } from "./access.js";
import { PO_PERMISSIONS, dayOf, isUuid, text } from "./constants.js";
import { DISCREPANCY_LABELS, DISCREPANCY_TYPES, loadReceipt, orderLinesById, statusOf } from "./receipts.js";
import { loadLineProgress } from "./progress.js";
import { getEligibleRejectableQuantity } from "./rejections.js";
import { getGoodsReceiptRejections } from "./rejection-records.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const seesCost = (context) => poCan(context, PO_PERMISSIONS.viewPayables) || poCan(context, PO_PERMISSIONS.bill);

export const RECEIPT_VIEWS = Object.freeze(["all", "draft", "posted", "cancelled_reversed", "mine", "with_rejections", "discrepancies_open", "discrepancies_resolved", "not_billed", "partially_billed"]);

// getPurchaseOrderRemainingReceivableQty (getPurchaseOrderReceiptProgress): what each line may still receive, with what other draft receipts hold (a warning, not a reservation).
export async function getPurchaseOrderRemainingReceivableQty(client, context, orderId, { exceptReceiptId = null } = {}) {
  const order = await loadPurchaseOrder(client, context, orderId);
  const lines = await orderLinesById(client, context.organizationId, order.id);
  const progress = new Map((await loadLineProgress(client, context.organizationId, order.id)).map((line) => [line.lineId, line]));
  const drafts = (await client.query(
    `SELECT receipt_line.purchase_order_line_id, receipt.receipt_number, receipt.id, receipt_line.accepted_quantity + receipt_line.held_quantity AS quantity
       FROM tenant.goods_receipt_lines receipt_line JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
      WHERE receipt_line.organization_id = $1 AND receipt.purchase_order_id = $2 AND receipt.status = 'draft' AND ($3::uuid IS NULL OR receipt.id <> $3)`,
    [context.organizationId, order.id, exceptReceiptId])).rows;
  const party = (await client.query(`SELECT display_name FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.party_id])).rows[0];
  return {
    order: {
      id: order.id, purchaseOrderNumber: order.purchase_order_number, status: order.status, supplierId: order.supplier_id, supplierName: order.supplier_snapshot?.supplierName ?? party?.display_name,
      supplierNumber: order.supplier_snapshot?.supplierNumber ?? null, company: order.buyer_registration_snapshot, shipFrom: order.ship_from_snapshot, defaultWarehouseId: order.default_warehouse_id,
      expectedDeliveryDate: dayOf(order.expected_delivery_date),
    },
    // Each product line's purchase units: the order's unit or any other one of the item's, converted exactly to the order's unit on receipt.
    lines: await Promise.all([...lines.values()].map(async (line) => {
      const state = progress.get(line.id);
      const units = line.product_id ? (await allowedItemUnits(client, context.organizationId, line.product_id, "purchase"))
        .map((unit) => ({ uomId: unit.uomId, code: unit.code, factor: unit.factor, decimals: unit.decimals, isBase: unit.isBase })) : [];
      const otherDrafts = drafts.filter((draft) => draft.purchase_order_line_id === line.id);
      return {
        purchaseOrderLineId: line.id, lineNumber: line.line_number, productId: line.product_id, product: line.product_snapshot, description: line.description, productType: line.product_type,
        trackingType: line.tracking_type ?? "none", requiresExpiryDate: Boolean(line.requires_expiry_date), uom: line.uom_snapshot, uomDecimals: Number(line.decimal_places ?? 6),
        warehouseId: line.receiving_warehouse_id, receiptRequired: state.receiptRequired, ordered: dec(state.ordered), received: dec(state.received), cancelled: dec(state.cancelled),
        remaining: dec(state.remainingToReceive), returned: dec(state.returned), onOtherDrafts: dec(otherDrafts.reduce((total, draft) => add(total, draft.quantity), 0n)),
        otherDrafts: otherDrafts.map((draft) => ({ id: draft.id, number: draft.receipt_number, quantity: dec(draft.quantity) })),
        uomId: line.purchase_uom_id, conversionFactor: dec(line.conversion_factor), baseUom: line.base_uom_code ?? null, remainingBase: dec(mul(state.remainingToReceive, line.conversion_factor ?? "1")), units,
      };
    })),
  };
}
export const getPurchaseOrderReceiptProgress = getPurchaseOrderRemainingReceivableQty;

// reconcileGoodsReceiptInventory: per line, the base quantity a posted (and not reversed) receipt should have put into stock, against Inventory's movements for it.
export async function reconcileGoodsReceiptInventory(client, context, receiptId) {
  const receipt = await loadReceipt(client, context, receiptId);
  const { rows } = await client.query(
    `SELECT line.id, line.line_number, line.description, line.product_type, line.base_quantity,
            COALESCE((SELECT sum(movement.quantity) FROM tenant.stock_movements movement WHERE movement.organization_id = line.organization_id
               AND movement.reference_type IN ('goods_receipt_line', 'goods_receipt_reversal') AND movement.reference_id = line.id), 0) AS in_stock
       FROM tenant.goods_receipt_lines line WHERE line.organization_id = $1 AND line.goods_receipt_id = $2 ORDER BY line.line_number`, [context.organizationId, receipt.id]);
  const live = receipt.status === "posted" && !receipt.reversed_at;
  const lines = rows.map((row) => {
    const expected = live && row.product_type === "stock" ? decimal(row.base_quantity) : 0n;
    const actual = decimal(row.in_stock);
    return { lineId: row.id, lineNumber: row.line_number, description: row.description, expectedBaseQuantity: dec(expected), postedBaseQuantity: dec(actual),
      difference: dec(sub(actual, expected)), matched: actual === expected };
  });
  return { receiptId: receipt.id, status: statusOf(receipt), matched: lines.every((line) => line.matched), lines };
}

export async function getGoodsReceipt(client, context, receiptId) {
  const receipt = await loadReceipt(client, context, receiptId);
  const organizationId = context.organizationId;
  const showCost = seesCost(context);
  const row = (await client.query(
    `SELECT receipt.*, po.purchase_order_number, po.status AS order_status, po.currency_code, party.display_name AS supplier_name, warehouse.name AS warehouse_name,
            poster.full_name AS posted_by_name, creator.full_name AS created_by_name, reverser.full_name AS reversed_by_name, receiver.full_name AS received_by_name,
            journal.entry_number AS accrual_entry_number, reversal.entry_number AS accrual_reversal_entry_number
       FROM tenant.goods_receipts receipt JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
       JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = receipt.organization_id AND warehouse.id = receipt.warehouse_id
       LEFT JOIN public.users poster ON poster.id = receipt.posted_by LEFT JOIN public.users creator ON creator.id = receipt.created_by LEFT JOIN public.users reverser ON reverser.id = receipt.reversed_by
       LEFT JOIN public.users receiver ON receiver.id = receipt.received_by_user_id
       LEFT JOIN tenant.accounting_journal_entries journal ON journal.organization_id = receipt.organization_id AND journal.id = receipt.accrual_journal_entry_id
       LEFT JOIN tenant.accounting_journal_entries reversal ON reversal.organization_id = receipt.organization_id AND reversal.id = receipt.accrual_reversal_journal_entry_id
      WHERE receipt.organization_id = $1 AND receipt.id = $2`, [organizationId, receipt.id])).rows[0];
  const lines = (await client.query(
    `SELECT line.*, entered_uom.code AS entered_uom_code, warehouse.name AS warehouse_name, location.code AS location_code, hold.code AS hold_location_code, order_line.line_number AS order_line_number, order_line.ordered_quantity,
            order_line.unit_price, order_line.taxable_amount AS order_taxable_amount,
            (SELECT COALESCE(sum(return_line.quantity) FILTER (WHERE return_line.disposition_id IS NULL AND NOT return_line.from_hold), 0) FROM tenant.purchase_return_lines return_line WHERE return_line.organization_id = line.organization_id AND return_line.goods_receipt_line_id = line.id AND EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted')) AS returned_from_stock,
            (SELECT COALESCE(sum(return_line.quantity), 0) FROM tenant.purchase_return_lines return_line WHERE return_line.organization_id = line.organization_id AND return_line.goods_receipt_line_id = line.id AND EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted')) AS returned
       FROM tenant.goods_receipt_lines line
       JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.purchase_order_line_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = line.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = line.organization_id AND location.id = line.warehouse_location_id
       LEFT JOIN tenant.warehouse_locations hold ON hold.organization_id = line.organization_id AND hold.id = line.hold_location_id
       LEFT JOIN tenant.units_of_measure entered_uom ON entered_uom.organization_id = line.organization_id AND entered_uom.id = line.entered_uom_id
      WHERE line.organization_id = $1 AND line.goods_receipt_id = $2 ORDER BY line.line_number`, [organizationId, receipt.id])).rows;
  const dispositions = (await client.query(
    `SELECT disposition.*, inspection.inspection_number, inspection.status AS inspection_status FROM tenant.goods_receipt_dispositions disposition
       LEFT JOIN tenant.quality_inspections inspection ON inspection.organization_id = disposition.organization_id AND inspection.id = disposition.quality_inspection_id
      WHERE disposition.organization_id = $1 AND disposition.goods_receipt_id = $2 ORDER BY disposition.created_at`, [organizationId, receipt.id])).rows;
  const movementIds = lines.flatMap((line) => line.stock_movement_ids ?? []);
  const movements = (await client.query(
    `SELECT movement.id, movement.movement_number, movement.movement_type, movement.ledger_type, movement.item_id, movement.quantity, movement.unit_cost, movement.occurred_at, movement.created_at,
            movement.reason, movement.reference_type, warehouse.name AS warehouse_name, location.code AS location_code
       FROM tenant.stock_movements movement
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
      WHERE movement.organization_id = $1 AND (movement.id = ANY($2::uuid[])
             OR (movement.reference_type IN ('goods_receipt_line', 'goods_receipt_reversal', 'receiving_rejection') AND movement.reference_id = ANY($3::uuid[])))
      ORDER BY movement.ledger_sequence`, [organizationId, movementIds, lines.map((line) => line.id)])).rows;
  const allocations = (await client.query(
    `SELECT allocation.goods_receipt_line_id, allocation.quantity, bill.id AS bill_id, bill.bill_number, COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice_number, bill.status
       FROM tenant.supplier_bill_receipt_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
      WHERE allocation.organization_id = $1 AND allocation.goods_receipt_line_id = ANY($2::uuid[]) AND bill.status <> 'cancelled' ORDER BY bill.created_at`, [organizationId, lines.map((line) => line.id)])).rows;
  const billing = (await client.query(`SELECT goods_receipt_line_id, billable_quantity, allocated_quantity FROM tenant.goods_receipt_line_billing WHERE organization_id = $1 AND goods_receipt_id = $2`,
    [organizationId, receipt.id])).rows;
  const returns = (await client.query(
    `SELECT DISTINCT purchase_return.id, purchase_return.return_number, purchase_return.return_date, purchase_return.reason, purchase_return.replacement_purchase_order_id, purchase_return.created_at,
            purchase_return.document_status, po.purchase_order_number AS replacement_number
       FROM tenant.purchase_returns purchase_return LEFT JOIN tenant.purchase_orders po ON po.organization_id = purchase_return.organization_id AND po.id = purchase_return.replacement_purchase_order_id
       JOIN tenant.purchase_return_lines return_line ON return_line.organization_id = purchase_return.organization_id AND return_line.purchase_return_id = purchase_return.id
       JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = return_line.organization_id AND receipt_line.id = return_line.goods_receipt_line_id
      WHERE purchase_return.organization_id = $1 AND receipt_line.goods_receipt_id = $2 AND purchase_return.document_status <> 'cancelled' ORDER BY purchase_return.created_at`, [organizationId, receipt.id])).rows;
  const discrepancies = (await client.query(
    `SELECT discrepancy.*, users.full_name FROM tenant.goods_receipt_discrepancies discrepancy LEFT JOIN public.users users ON users.id = discrepancy.recorded_by
      WHERE discrepancy.organization_id = $1 AND discrepancy.goods_receipt_id = $2 ORDER BY discrepancy.recorded_at`, [organizationId, receipt.id])).rows;
  const evidenceIds = [...new Set(discrepancies.flatMap((entry) => entry.evidence_file_ids ?? []))];
  const files = evidenceIds.length
    ? (await client.query(`SELECT id, file_name FROM public.attachments WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [organizationId, evidenceIds])).rows : [];
  const events = (await client.query(
    `SELECT event.id, event.event_type, event.summary, event.occurred_at, users.full_name FROM tenant.goods_receipt_events event LEFT JOIN public.users users ON users.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.goods_receipt_id = $2 ORDER BY event.occurred_at DESC, event.id DESC`, [organizationId, receipt.id])).rows;
  const status = statusOf(row);
  const lineNumberOf = (lineId) => lines.find((line) => line.id === lineId)?.line_number ?? null;
  return {
    receipt: {
      id: row.id, receiptNumber: row.receipt_number, status, purchaseOrderId: row.purchase_order_id, purchaseOrderNumber: row.purchase_order_number, orderStatus: row.order_status,
      supplierId: row.supplier_id, supplierName: row.supplier_name, company: row.buying_registration_snapshot, warehouseId: row.warehouse_id, warehouseName: row.warehouse_name,
      receiptDate: dayOf(row.receipt_date), physicalReceivedAt: row.physical_received_at, supplierChallanNumber: row.supplier_delivery_note, supplierChallanDate: dayOf(row.supplier_challan_date),
      vehicleNumber: row.vehicle_number, carrierName: row.carrier_name, trackingReference: row.tracking_reference, receivedByUserId: row.received_by_user_id, receivedByName: row.received_by_name,
      shipFrom: row.ship_from_snapshot, notes: row.notes, createdAt: row.created_at, createdByName: row.created_by_name, updatedAt: row.updated_at, postedAt: row.posted_at,
      postedByName: row.posted_by_name, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, reversedAt: row.reversed_at, reversedByName: row.reversed_by_name,
      reversalReason: row.reversal_reason, currencyCode: row.currency_code?.trim() ?? null,
      accrual: showCost && row.accrual_journal_entry_id ? { journalEntryId: row.accrual_journal_entry_id, entryNumber: row.accrual_entry_number, amount: dec(row.accrual_amount),
        reversalJournalEntryId: row.accrual_reversal_journal_entry_id, reversalEntryNumber: row.accrual_reversal_entry_number } : null,
    },
    lines: lines.map((line) => {
      const bill = billing.find((entry) => entry.goods_receipt_line_id === line.id);
      return {
        id: line.id, lineNumber: line.line_number, purchaseOrderLineId: line.purchase_order_line_id, orderLineNumber: line.order_line_number, productId: line.product_id,
        product: line.product_snapshot, productType: line.product_type, description: line.description, uom: line.uom_snapshot, orderedQuantity: dec(line.ordered_quantity),
        receivedQuantity: dec(add(line.accepted_quantity, line.held_quantity)), acceptedQuantity: dec(line.accepted_quantity), inspectionQuantity: dec(sub(line.held_quantity, line.damaged_quantity)),
        damagedQuantity: dec(line.damaged_quantity), heldQuantity: dec(line.held_quantity), refusedQuantity: dec(line.rejected_quantity), refusalReason: line.rejection_reason, refusalReasonCode: line.refusal_reason_code,
        presentedQuantity: dec(line.presented_quantity),
        baseQuantity: dec(line.base_quantity), conversionFactor: dec(line.conversion_factor), warehouseId: line.warehouse_id, warehouseName: line.warehouse_name,
        // Entered in another unit than the order's: what was typed (the quantities above are in the order's unit).
        entered: line.entered_uom_id ? { uomId: line.entered_uom_id, uom: line.entered_uom_code ?? null, quantity: dec(line.entered_quantity), conversionFactor: dec(line.entered_conversion_factor) } : null,
        warehouseLocationId: line.warehouse_location_id, locationCode: line.location_code, holdLocationCode: line.hold_location_code, batchNumber: line.batch_number,
        expiryDate: dayOf(line.expiry_date), manufacturedDate: dayOf(line.manufactured_date), trackingType: line.tracking_snapshot?.trackingType ?? "none",
        requiresExpiryDate: Boolean(line.tracking_snapshot?.requiresExpiryDate), serialNumbers: line.serial_numbers, discrepancyNotes: line.discrepancy_notes,
        unitCost: showCost ? dec(line.unit_price) : null,
        returned: dec(line.returned), returnedFromStock: dec(line.returned_from_stock), netRetained: dec(sub(add(line.accepted_quantity, line.held_quantity), line.returned)),
        billable: bill ? dec(bill.billable_quantity) : null, billed: bill ? dec(bill.allocated_quantity) : null,
        dispositions: dispositions.filter((entry) => entry.goods_receipt_line_id === line.id).map((entry) => ({
          id: entry.id, disposition: entry.disposition, quantity: dec(entry.quantity), released: dec(entry.released_quantity), returned: dec(entry.returned_quantity),
          open: dec(sub(sub(entry.quantity, entry.released_quantity), entry.returned_quantity)),
          inspection: entry.quality_inspection_id ? { id: entry.quality_inspection_id, number: entry.inspection_number, status: entry.inspection_status } : null })),
      };
    }),
    // From the Stock Ledger: what each movement means (Purchase Receipt, Disposition In/Out, Reversal…), effective on the receipt date, posted when it was.
    movements: movements.map((movement) => ({ id: movement.id, number: movement.movement_number, type: LEDGER_TYPE_LABELS[movement.ledger_type] ?? movement.movement_type, itemId: movement.item_id,
      quantity: dec(movement.quantity), unitCost: showCost ? dec(movement.unit_cost) : null, at: movement.occurred_at, postedAt: movement.created_at, warehouseName: movement.warehouse_name,
      locationCode: movement.location_code, reason: movement.reason })),
    billMatching: allocations.map((entry) => ({ lineNumber: lineNumberOf(entry.goods_receipt_line_id), quantity: dec(entry.quantity), billId: entry.bill_id, billNumber: entry.bill_number,
      supplierInvoiceNumber: entry.supplier_invoice_number, status: entry.status })),
    returns: returns.map((entry) => ({ id: entry.id, number: entry.return_number, date: dayOf(entry.return_date), reason: entry.reason, replacementPurchaseOrderId: entry.replacement_purchase_order_id,
      replacementNumber: entry.replacement_number })),
    discrepancies: discrepancies.map((entry) => ({ id: entry.id, lineNumber: lineNumberOf(entry.goods_receipt_line_id), type: entry.discrepancy_type,
      label: DISCREPANCY_LABELS[entry.discrepancy_type] ?? entry.discrepancy_type, quantity: dec(entry.quantity), notes: entry.notes, at: entry.recorded_at, by: entry.full_name,
      evidence: (entry.evidence_file_ids ?? []).map((id) => ({ id, fileName: files.find((file) => file.id === id)?.file_name ?? "File" })) })),
    history: events.map((event) => ({ id: event.id, type: event.event_type, summary: event.summary, at: event.occurred_at, actor: event.full_name })),
    reconciliation: status === "draft" || status === "cancelled" ? null : await reconcileGoodsReceiptInventory(client, context, receipt.id),
    rejections: poCan(context, PO_PERMISSIONS.rejectionsView) || poCan(context, PO_PERMISSIONS.rejectionsViewAll) ? await getGoodsReceiptRejections(client, context, receipt.id) : [],
    rejectable: status === "posted" ? await Promise.all(lines.filter((line) => line.product_type !== "service").map((line) => getEligibleRejectableQuantity(client, context, line.id).catch(() => null)))
      .then((entries) => entries.filter(Boolean)) : [],
    discrepancyTypes: DISCREPANCY_TYPES,
    showCost,
    actions: {
      edit: status === "draft" && poCan(context, PO_PERMISSIONS.receive), post: status === "draft" && poCan(context, PO_PERMISSIONS.post),
      preview: status === "draft", cancel: status === "draft" && poCan(context, PO_PERMISSIONS.receive), reverse: status === "posted" && poCan(context, PO_PERMISSIONS.reverse),
      returnGoods: status === "posted" && poCan(context, PO_PERMISSIONS.returns), release: status === "posted" && poCan(context, PO_PERMISSIONS.release),
      recordDiscrepancy: status !== "cancelled" && poCan(context, PO_PERMISSIONS.receive), attach: poCan(context, PO_PERMISSIONS.receive), print: true,
      recordRejection: status === "posted" && poCan(context, PO_PERMISSIONS.rejectionsRecord), createBill: status === "posted" && poCan(context, PO_PERMISSIONS.bill), recordQualityRejection: status === "posted" && poCan(context, PO_PERMISSIONS.rejectionsQuality),
    },
  };
}

// filters: view (all | draft | posted | cancelled_reversed | mine), status (draft | posted | cancelled | reversed), supplierId, purchaseOrderId, warehouseId, productId,
// receivedById, dateFrom, dateTo, search. "mine": received by me (or, still a draft, created by me).
export async function listGoodsReceipts(client, context, filters = {}) {
  requirePoAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = poScopeSql(context, values, "po");
  const view = RECEIPT_VIEWS.includes(filters.view) ? filters.view : "all";
  if (view === "draft") where += " AND receipt.status = 'draft'";
  else if (view === "posted") where += " AND receipt.status = 'posted' AND receipt.reversed_at IS NULL";
  else if (view === "cancelled_reversed") where += " AND (receipt.status = 'cancelled' OR receipt.reversed_at IS NOT NULL)";
  else if (view === "with_rejections")
    where += " AND EXISTS (SELECT 1 FROM tenant.receiving_rejections rejection WHERE rejection.organization_id = receipt.organization_id AND rejection.goods_receipt_id = receipt.id AND rejection.status <> 'cancelled')";
  else if (view === "discrepancies_open" || view === "discrepancies_resolved")
    where += ` AND EXISTS (SELECT 1 FROM tenant.receiving_rejections rejection WHERE rejection.organization_id = receipt.organization_id AND rejection.goods_receipt_id = receipt.id
      AND rejection.status = '${view === "discrepancies_open" ? "open" : "resolved"}')${view === "discrepancies_open" ? " OR EXISTS (SELECT 1 FROM tenant.goods_receipt_discrepancies discrepancy WHERE discrepancy.organization_id = receipt.organization_id AND discrepancy.goods_receipt_id = receipt.id)" : ""}`;
  // Billing of the receipt's goods by posted bills: none yet, or some but not all.
  else if (view === "not_billed" || view === "partially_billed")
    where += ` AND receipt.status = 'posted' AND receipt.reversed_at IS NULL AND EXISTS (SELECT 1 FROM tenant.goods_receipt_line_billing billing WHERE billing.organization_id = receipt.organization_id
      AND billing.goods_receipt_id = receipt.id GROUP BY billing.goods_receipt_id HAVING ${view === "not_billed" ? "sum(billing.allocated_quantity) = 0 AND sum(billing.billable_quantity) > 0" : "sum(billing.allocated_quantity) > 0 AND sum(billing.billable_quantity) > sum(billing.allocated_quantity)"})`;
  else if (view === "mine") {
    const me = bind(context.userId ?? null);
    where += ` AND (receipt.received_by_user_id = ${me} OR (receipt.received_by_user_id IS NULL AND receipt.created_by = ${me}))`;
  }
  if (filters.status === "reversed") where += " AND receipt.status = 'posted' AND receipt.reversed_at IS NOT NULL";
  else if (filters.status === "posted") where += " AND receipt.status = 'posted' AND receipt.reversed_at IS NULL";
  else if (["draft", "cancelled"].includes(filters.status)) where += ` AND receipt.status = ${bind(filters.status)}`;
  if (isUuid(filters.purchaseOrderId)) where += ` AND receipt.purchase_order_id = ${bind(filters.purchaseOrderId)}`;
  if (isUuid(filters.supplierId)) where += ` AND receipt.supplier_id = ${bind(filters.supplierId)}`;
  if (isUuid(filters.warehouseId)) where += ` AND receipt.warehouse_id = ${bind(filters.warehouseId)}`;
  if (isUuid(filters.receivedById)) where += ` AND receipt.received_by_user_id = ${bind(filters.receivedById)}`;
  if (isUuid(filters.productId))
    where += ` AND EXISTS (SELECT 1 FROM tenant.goods_receipt_lines line WHERE line.organization_id = receipt.organization_id AND line.goods_receipt_id = receipt.id AND line.product_id = ${bind(filters.productId)})`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom ?? ""))) where += ` AND receipt.receipt_date >= ${bind(filters.dateFrom)}::date`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo ?? ""))) where += ` AND receipt.receipt_date <= ${bind(filters.dateTo)}::date`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search}%`);
    where += ` AND (receipt.receipt_number ILIKE ${term} OR po.purchase_order_number ILIKE ${term} OR party.display_name ILIKE ${term} OR receipt.supplier_delivery_note ILIKE ${term}
      OR receipt.vehicle_number ILIKE ${term} OR receipt.tracking_reference ILIKE ${term})`;
  }
  const { rows } = await client.query(
    `SELECT receipt.id, receipt.receipt_number, receipt.status, receipt.reversed_at, receipt.receipt_date, receipt.physical_received_at, receipt.supplier_delivery_note,
            receipt.received_by_user_id, po.id AS purchase_order_id, po.purchase_order_number, party.display_name AS supplier_name, warehouse.name AS warehouse_name,
            receiver.full_name AS received_by,
            (SELECT count(*) FROM tenant.goods_receipt_lines line WHERE line.organization_id = receipt.organization_id AND line.goods_receipt_id = receipt.id)::int AS line_count,
            (SELECT count(*) FROM tenant.receiving_rejections rejection WHERE rejection.organization_id = receipt.organization_id AND rejection.goods_receipt_id = receipt.id
              AND rejection.status = 'open')::int AS open_rejections
       FROM tenant.goods_receipts receipt JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
       JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = receipt.organization_id AND warehouse.id = receipt.warehouse_id
       LEFT JOIN public.users receiver ON receiver.id = receipt.received_by_user_id
      WHERE receipt.organization_id = $1${where} ORDER BY receipt.receipt_date DESC, receipt.created_at DESC LIMIT 300`, values);
  return rows.map((row) => ({
    id: row.id, receiptNumber: row.receipt_number, status: statusOf(row), receiptDate: dayOf(row.receipt_date), physicalReceivedAt: row.physical_received_at,
    supplierChallanNumber: row.supplier_delivery_note, purchaseOrderId: row.purchase_order_id, purchaseOrderNumber: row.purchase_order_number, supplierName: row.supplier_name,
    warehouseName: row.warehouse_name, lineCount: row.line_count, receivedById: row.received_by_user_id, receivedBy: row.received_by, openRejections: row.open_rejections,
  }));
}

// getGoodsReceiptsForPurchaseOrder: every receipt of an order.
export async function getGoodsReceiptsForPurchaseOrder(client, context, orderId) {
  const order = await loadPurchaseOrder(client, context, orderId);
  return listGoodsReceipts(client, context, { purchaseOrderId: order.id });
}
