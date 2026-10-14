// Finished-Goods Receipt — the reads: one receipt (with its lines, lots, serial units, posting, correction and history), the list, the
// accepted, unreceived output of an order (the receipt queue), an order's receipt history, the posting check against Inventory and Finance,
// the exceptions queue and the reports. Values only with the cost permission. Nothing here moves stock or posts.
import {
  D, FGR, FGR_STATUS_LABEL, isoDay, STATUS_LABEL, UNPOSTED, ZERO, add, approvalState, canSeeCost, fgrError, has, loadFinishedItem, loadReceipt, loadReceiptLines, loadReceiptOrder, money, needFgr,
  q, receiptSettings, receivableSources, requireReceivable, sub, uuid,
} from "./fgr-core.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const dayOf = isoDay;
const ACTION_LABEL = Object.freeze({ CREATED: "Draft created", EDITED: "Draft edited", APPROVAL_REQUESTED: "Approval requested", APPROVED: "Receipt into another warehouse approved",
  REJECTED: "Receipt into another warehouse rejected", POSTED: "Posted to Inventory", CANCELLED: "Cancelled", CORRECTION_REQUESTED: "Correction requested",
  CORRECTION_REJECTED: "Correction rejected", REVERSED: "Reversed", DEMAND_ALLOCATED: "Handed to sales demand", DEMAND_ALLOCATION_FAILED: "Sales allocation failed",
  PRINTED: "Printed", REPRINTED: "Reprinted", RECOVERY_REQUIRED: "Marked for recovery", RECOVERED: "Recovered: Inventory and Finance agree" });

// ------------------------------------------------------------------ one receipt
export async function getFinishedGoodsReceipt(client, c, id) {
  needFgr(c, FGR.view);
  const receipt = await loadReceipt(client, c, id);
  const order = await loadReceiptOrder(client, c, receipt.manufacturing_order_id);
  const item = await loadFinishedItem(client, c, order);
  const rows = await loadReceiptLines(client, c, receipt.id);
  const costView = canSeeCost(c);
  const unposted = UNPOSTED.has(receipt.status);
  const sources = unposted ? await receivableSources(client, c, order) : [];
  const lookups = async (sql, ids) => (ids.length ? new Map((await client.query(sql, [c.organizationId, ids])).rows.map((row) => [row.id, row])) : new Map());
  const warehouses = await lookups(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [receipt.source_warehouse_id, receipt.destination_warehouse_id]);
  const locations = await lookups(`SELECT id, code, name, disposition FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [receipt.source_location_id, receipt.destination_location_id].filter(Boolean));
  const lots = await lookups(`SELECT id, batch_number, manufactured_on, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, rows.map((row) => row.lot_id).filter(Boolean));
  const serials = rows.length ? (await client.query(`SELECT * FROM tenant.manufacturing_finished_goods_serials WHERE organization_id = $1 AND receipt_line_id = ANY($2::uuid[]) ORDER BY serial_number`,
    [c.organizationId, rows.map((row) => row.id)])).rows : [];
  const postings = (await client.query(`SELECT * FROM tenant.manufacturing_finished_goods_receipt_postings WHERE organization_id = $1 AND receipt_id = $2 ORDER BY created_at`, [c.organizationId, receipt.id])).rows;
  const corrections = (await client.query(`SELECT * FROM tenant.manufacturing_finished_goods_receipt_corrections WHERE organization_id = $1 AND receipt_id = $2 ORDER BY requested_at`, [c.organizationId, receipt.id])).rows;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_finished_goods_receipt_events WHERE organization_id = $1 AND receipt_id = $2 ORDER BY occurred_at`, [c.organizationId, receipt.id])).rows;
  const people = await names(client, [receipt.created_by, receipt.posted_by, receipt.approval_requested_by, receipt.approved_by, receipt.cancelled_by, ...events.map((row) => row.actor_user_id),
    ...corrections.flatMap((row) => [row.requested_by, row.decided_by])]);
  const revision = order.bom_revision_id ? (await client.query(`SELECT revision_number FROM tenant.manufacturing_bom_revisions WHERE id = $1`, [order.bom_revision_id])).rows[0] : null;
  const settings = await receiptSettings(client, c);
  let receivableOrder = true;
  try { requireReceivable(order, settings); } catch { receivableOrder = false; }
  const approval = approvalState(receipt, order);
  const receiptPosting = postings.find((row) => row.kind === "RECEIPT") ?? null;
  const open = corrections.find((row) => row.status === "REQUESTED") ?? null;
  const allocationFailed = events.some((row) => row.action === "DEMAND_ALLOCATION_FAILED") && !events.some((row) => row.action === "DEMAND_ALLOCATED");
  const place = (warehouseId, locationId) => ({ warehouse: warehouses.get(warehouseId) ?? null, location: locationId ? locations.get(locationId) ?? null : null });
  const total = rows.reduce((sum, row) => add(sum, D(row.base_quantity)), ZERO);
  return {
    id: receipt.id, number: receipt.receipt_number, status: receipt.status, statusLabel: FGR_STATUS_LABEL[receipt.status], rowVersion: receipt.row_version, receiptDate: dayOf(receipt.receipt_date),
    notes: receipt.notes, createdBy: people.get(receipt.created_by) ?? null, createdAt: receipt.created_at, postedBy: people.get(receipt.posted_by) ?? null, postedAt: receipt.posted_at,
    cancelledBy: people.get(receipt.cancelled_by) ?? null, cancelledAt: receipt.cancelled_at, cancelReason: receipt.cancel_reason, correctionStatus: receipt.correction_status,
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status], version: order.version, revisionNumber: revision?.revision_number ?? null,
      snapshotId: order.bom_snapshot_id, finishedGoodsWarehouseId: order.finished_goods_warehouse_id,
      accepted: q(D(order.accepted_quantity)), received: q(D(order.received_quantity)), receivable: q(sub(D(order.accepted_quantity), D(order.received_quantity))) },
    item: { id: item.id, code: item.code, name: item.name, uomId: item.uom_id, uom: item.uom_code, trackingType: item.tracking_type },
    source: place(receipt.source_warehouse_id, receipt.source_location_id), destination: place(receipt.destination_warehouse_id, receipt.destination_location_id),
    approval: { ...approval, reason: receipt.approval_reason, requestedBy: people.get(receipt.approval_requested_by) ?? null, requestedAt: receipt.approval_requested_at,
      decidedBy: people.get(receipt.approved_by) ?? null, decidedAt: receipt.approved_at, note: receipt.approval_note },
    lines: rows.map((row) => {
      const source = sources.find((entry) => entry.row.id === row.production_entry_id);
      const lot = row.lot_id ? lots.get(row.lot_id) : null;
      return {
        id: row.id, lineNumber: row.line_number, productionEntryId: row.production_entry_id, entryNumber: row.entry_number, producedAt: row.produced_at,
        productionBatchId: row.production_batch_id, productionBatch: row.batch_reference, qualityDecisionId: row.quality_decision_id,
        quantity: q(D(row.quantity)), uomId: row.uom_id, uom: row.uom_code, baseQuantity: q(D(row.base_quantity)), factor: q(D(row.conversion_factor), 9),
        accepted: source ? q(source.figures.accepted) : null, received: source ? q(source.figures.received) : null, receivable: source ? q(source.receivable) : null,
        lotNumber: row.lot_number, manufacturedOn: dayOf(row.manufactured_on), expiresOn: dayOf(row.expires_on), serialNumbers: row.serial_numbers ?? [],
        lot: lot ? { id: lot.id, number: lot.batch_number, manufacturedOn: dayOf(lot.manufactured_on), expiresOn: dayOf(lot.expires_on) } : null,
        serials: serials.filter((serial) => serial.receipt_line_id === row.id).map((serial) => ({ number: serial.serial_number, serialId: serial.serial_id, stockMovementId: serial.stock_movement_id })),
        stockMovementIds: row.stock_movement_ids ?? [], unitCost: costView && row.unit_cost !== null ? q(D(row.unit_cost)) : null, totalCost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null,
      };
    }),
    totals: { lines: rows.length, quantity: q(total), uom: item.uom_code, unitCost: costView && receipt.unit_cost !== null ? q(D(receipt.unit_cost)) : null,
      cost: costView && receipt.total_cost !== null ? money(D(receipt.total_cost)) : null, costBasis: costView ? receipt.cost_basis : null },
    posting: receiptPosting ? { key: receiptPosting.command_key, documentVersion: receiptPosting.document_version, inventoryStatus: receiptPosting.inventory_status,
      stockMovementIds: receiptPosting.stock_movement_ids, financeStatus: receiptPosting.finance_status, journalEntryId: costView ? receiptPosting.journal_entry_id : null, at: receiptPosting.created_at,
      goodsReceiptId: receipt.goods_receipt_id } : null,
    salesAllocation: allocationFailed ? "FAILED" : events.some((row) => row.action === "DEMAND_ALLOCATED") ? "DONE" : "NONE",
    corrections: corrections.map((row) => ({ id: row.id, number: row.correction_number, status: row.status, quantity: q(D(row.quantity)), reason: row.reason, evidence: row.evidence,
      requestedBy: people.get(row.requested_by) ?? null, requestedAt: row.requested_at, decidedBy: people.get(row.decided_by) ?? null, decidedAt: row.decided_at, note: row.decision_note,
      cost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null, stockMovementIds: row.stock_movement_ids })),
    print: { count: receipt.print_count, lastPrintedAt: receipt.last_printed_at, watermark: receipt.status === "POSTED" ? (receipt.correction_status === "REVERSED" ? "REVERSED" : null) : receipt.status === "CANCELLED" ? "CANCELLED" : "DRAFT" },
    history: events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, fromStatus: row.from_status, toStatus: row.to_status, summary: row.summary,
      actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at })),
    can: {
      edit: unposted && has(c, FGR.editDraft) && receivableOrder, cancel: unposted && has(c, FGR.cancelDraft),
      requestApproval: unposted && receipt.status !== "PENDING_APPROVAL" && has(c, FGR.editDraft) && approval.required && !approval.valid,
      decideApproval: receipt.status === "PENDING_APPROVAL" && has(c, FGR.approveCorrection) && (receipt.approval_requested_by !== c.userId || settings.varianceSelfApproval),
      post: unposted && receipt.status !== "PENDING_APPROVAL" && has(c, FGR.post) && has(c, "stock.receive") && receivableOrder,
      requestCorrection: receipt.status === "POSTED" && ["NONE", "REJECTED"].includes(receipt.correction_status) && has(c, FGR.requestCorrection),
      decideCorrection: Boolean(open) && has(c, FGR.approveCorrection) && has(c, "stock.issue") && (open.requested_by !== c.userId || settings.varianceSelfApproval),
      print: has(c, FGR.export), viewCost: costView, recover: ["POSTED", "RECOVERY_REQUIRED"].includes(receipt.status) && has(c, FGR.approveCorrection),
    },
  };
}

// ------------------------------------------------------------------ list
// filters: { status, orderId, warehouseId, itemId, receivedBy, from, to, search, correction }
export async function listFinishedGoodsReceipts(client, c, filters = {}) {
  needFgr(c, FGR.view);
  const values = [c.organizationId];
  const where = ["receipt.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status) where.push(`receipt.status = ${bind(String(filters.status).toUpperCase())}`);
  if (filters.correction) where.push(`receipt.correction_status = ${bind(String(filters.correction).toUpperCase())}`);
  if (filters.orderId) where.push(`receipt.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.warehouseId) where.push(`receipt.destination_warehouse_id = ${bind(uuid(filters.warehouseId, "Warehouse"))}`);
  if (filters.itemId) where.push(`receipt.finished_item_id = ${bind(uuid(filters.itemId, "Item"))}`);
  if (filters.receivedBy) where.push(`receipt.posted_by = ${bind(uuid(filters.receivedBy, "User"))}`);
  if (filters.from) where.push(`COALESCE(receipt.posted_at, receipt.created_at) >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`COALESCE(receipt.posted_at, receipt.created_at) < (${bind(String(filters.to))}::date + 1)`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(receipt.receipt_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.manufacturing_finished_goods_receipt_lines line WHERE line.receipt_id = receipt.id AND (lower(COALESCE(line.lot_number, '')) LIKE ${term}
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(line.serial_numbers, '{}'::text[])) serial WHERE lower(serial) LIKE ${term}))))`);
  }
  const rows = (await client.query(
    `SELECT receipt.*, mo.mo_number, mo.status AS order_status, item.code AS item_code, item.name AS item_name, uom.code AS uom, warehouse.code AS warehouse_code, location.code AS location_code,
            (SELECT COALESCE(sum(line.base_quantity), 0) FROM tenant.manufacturing_finished_goods_receipt_lines line WHERE line.receipt_id = receipt.id) AS quantity,
            (SELECT string_agg(entry.entry_number, ', ' ORDER BY line.line_number) FROM tenant.manufacturing_finished_goods_receipt_lines line
               JOIN tenant.manufacturing_production_entries entry ON entry.id = line.production_entry_id WHERE line.receipt_id = receipt.id) AS entries,
            (SELECT string_agg(DISTINCT line.lot_number, ', ') FROM tenant.manufacturing_finished_goods_receipt_lines line WHERE line.receipt_id = receipt.id AND line.lot_number IS NOT NULL) AS lots
       FROM tenant.manufacturing_finished_goods_receipts receipt JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id
       JOIN tenant.items item ON item.id = receipt.finished_item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id JOIN tenant.warehouses warehouse ON warehouse.id = receipt.destination_warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.id = receipt.destination_location_id
      WHERE ${where.join(" AND ")} ORDER BY COALESCE(receipt.posted_at, receipt.created_at) DESC LIMIT 500`, values)).rows;
  const people = await names(client, rows.flatMap((row) => [row.created_by, row.posted_by]));
  const costView = canSeeCost(c);
  return rows.map((row) => ({
    id: row.id, number: row.receipt_number, status: row.status, statusLabel: FGR_STATUS_LABEL[row.status], correctionStatus: row.correction_status, orderId: row.manufacturing_order_id,
    orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.order_status], item: `${row.item_code} · ${row.item_name}`, quantity: q(D(row.quantity)), uom: row.uom,
    warehouse: row.warehouse_code, location: row.location_code, entries: row.entries, lots: row.lots, receiptDate: dayOf(row.receipt_date), createdBy: people.get(row.created_by) ?? null,
    receivedBy: people.get(row.posted_by) ?? null, createdAt: row.created_at, postedAt: row.posted_at, totalCost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null,
    approvalStatus: row.approval_status, printed: row.print_count,
  }));
}
export const getMoFinishedGoodsReceiptHistory = (client, c, orderId) => listFinishedGoodsReceipts(client, c, { orderId });

// ------------------------------------------------------------------ what an order may receive
// Per reported entry: produced, accepted, rejected, awaiting inspection, net received, receivable now, its batch and quality evidence; and the
// order's totals, the destination it receives into by default, the bins there, the cost a unit would carry, and what is drafted already.
export async function getReceivableManufacturingOutput(client, c, orderId) {
  needFgr(c, FGR.view);
  const order = await loadReceiptOrder(client, c, orderId);
  const item = await loadFinishedItem(client, c, order);
  const settings = await receiptSettings(client, c);
  let eligible = true;
  let reason = null;
  try { requireReceivable(order, settings); } catch (error) { eligible = false; reason = error.message; }
  const sources = await receivableSources(client, c, order);
  const drafted = (await client.query(`SELECT line.production_entry_id, sum(line.base_quantity) AS quantity, string_agg(DISTINCT receipt.receipt_number, ', ') AS receipts
      FROM tenant.manufacturing_finished_goods_receipt_lines line JOIN tenant.manufacturing_finished_goods_receipts receipt ON receipt.id = line.receipt_id
     WHERE line.organization_id = $1 AND receipt.manufacturing_order_id = $2 AND receipt.status IN ('DRAFT', 'PENDING_APPROVAL') GROUP BY 1`, [c.organizationId, order.id])).rows;
  const warehouses = (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND COALESCE(warehouse_type, 'stores') <> 'transit' ORDER BY code`,
    [c.organizationId])).rows;
  const bins = (await client.query(`SELECT id, warehouse_id, code, name, disposition, is_default_receiving FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND allow_stock ORDER BY code`,
    [c.organizationId])).rows;
  const accepted = D(order.accepted_quantity);
  const received = D(order.received_quantity);
  return {
    orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], orderVersion: order.version, eligible, reason,
    item: { id: item.id, code: item.code, name: item.name, uomId: item.uom_id, uom: item.uom_code, trackingType: item.tracking_type },
    totals: { planned: q(D(order.planned_base_quantity)), reported: q(D(order.reported_quantity)), accepted: q(accepted), rejected: q(D(order.rejected_quantity)),
      pending: q(D(order.pending_inspection_quantity)), received: q(received), receivable: q(sub(accepted, received)) },
    defaultWarehouseId: order.finished_goods_warehouse_id, sourceWarehouseId: order.manufacturing_warehouse_id,
    warehouses: warehouses.map((row) => ({ id: row.id, code: row.code, name: row.name, isOrderDefault: row.id === order.finished_goods_warehouse_id })),
    bins: bins.map((row) => ({ id: row.id, warehouseId: row.warehouse_id, code: row.code, name: row.name, disposition: row.disposition, defaultReceiving: row.is_default_receiving })),
    entries: sources.map((source) => {
      const draft = drafted.find((row) => row.production_entry_id === source.row.id);
      return { id: source.row.id, number: source.row.entry_number, status: source.row.status, producedAt: source.row.produced_at, batchId: source.row.production_batch_id,
        batch: source.row.batch_reference, qualityDecisionId: source.row.quality_decision_id, reported: q(source.figures.reported), accepted: q(source.figures.accepted),
        rejected: q(source.figures.rejected), pending: q(source.figures.pending), received: q(source.figures.received), receivable: q(source.receivable), inspection: source.figures.inspection,
        receipt: source.figures.receipt, drafted: draft ? { quantity: q(D(draft.quantity)), receipts: draft.receipts } : null };
    }),
  };
}

// ------------------------------------------------------------------ posting check, exceptions
// Does Inventory hold every movement the receipt recorded (and its quantity), Finance its journal, and the order its receipt record?
export async function checkFinishedGoodsReceiptPosting(client, c, id) {
  needFgr(c, FGR.view);
  const receipt = await loadReceipt(client, c, id);
  const problems = [];
  const posting = (await client.query(`SELECT * FROM tenant.manufacturing_finished_goods_receipt_postings WHERE organization_id = $1 AND receipt_id = $2 AND kind = 'RECEIPT'`, [c.organizationId, receipt.id])).rows[0];
  if (["POSTED", "RECOVERY_REQUIRED"].includes(receipt.status) && !posting) problems.push("No posting record exists for this posted receipt.");
  let inventory = { status: posting ? "CONFIRMED" : UNPOSTED.has(receipt.status) ? "NOT_POSTED" : "UNKNOWN", movements: 0, quantity: "0" };
  let finance = { status: posting?.finance_status ?? "NOT_POSTED", journalEntryId: posting?.journal_entry_id ?? null, amount: null };
  if (posting) {
    const movements = (await client.query(`SELECT id, quantity FROM tenant.stock_movements WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, posting.stock_movement_ids])).rows;
    const record = receipt.goods_receipt_id ? (await client.query(`SELECT quantity FROM tenant.manufacturing_goods_receipts WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.goods_receipt_id])).rows[0] : null;
    const lines = (await client.query(`SELECT COALESCE(sum(base_quantity), 0) AS quantity FROM tenant.manufacturing_finished_goods_receipt_lines WHERE organization_id = $1 AND receipt_id = $2`,
      [c.organizationId, receipt.id])).rows[0];
    const stockQuantity = movements.reduce((sum, row) => add(sum, D(String(Math.abs(Number(row.quantity))))), ZERO);
    if (movements.length !== posting.stock_movement_ids.length) problems.push(`Inventory holds ${movements.length} of the ${posting.stock_movement_ids.length} movements recorded.`);
    if (!record) problems.push("The order has no receipt record for this posting.");
    else if (D(record.quantity) !== D(lines.quantity)) problems.push(`The order recorded ${q(D(record.quantity))}; the receipt's lines add up to ${q(D(lines.quantity))}.`);
    if (D(lines.quantity) !== stockQuantity) problems.push(`The receipt received ${q(D(lines.quantity))}; Inventory moved ${q(stockQuantity)}.`);
    inventory = { status: problems.length ? "MISMATCH" : "CONFIRMED", movements: movements.length, quantity: q(stockQuantity) };
    if (posting.finance_status === "POSTED") {
      const journal = posting.journal_entry_id ? (await client.query(`SELECT status, (SELECT COALESCE(sum(line.base_debit_amount), 0) FROM tenant.accounting_journal_lines line WHERE line.journal_entry_id = entry.id) AS debit
          FROM tenant.accounting_journal_entries entry WHERE entry.organization_id = $1 AND entry.id = $2`, [c.organizationId, posting.journal_entry_id])).rows[0] : null;
      if (!journal) problems.push("Finance has no journal for this receipt.");
      else if (money(D(journal.debit)) !== money(D(posting.amount))) problems.push(`Finance holds ₹${money(D(journal.debit))}; the receipt posted ₹${money(D(posting.amount))}.`);
      finance = { status: journal ? (problems.length ? "MISMATCH" : "POSTED") : "MISSING", journalEntryId: posting.journal_entry_id, amount: journal ? money(D(journal.debit)) : null };
    }
  }
  return { receiptId: receipt.id, receiptNumber: receipt.receipt_number, status: receipt.status, consistent: problems.length === 0, problems, inventory, finance, checkedAt: new Date().toISOString() };
}

// What needs someone: receipts waiting for an approval or a correction decision, sales allocations that failed, postings marked for recovery
// or disagreeing with Inventory or Finance, and accepted output on active orders that nobody has received for a while.
export async function getFinishedGoodsReceiptExceptions(client, c) {
  needFgr(c, FGR.view);
  const out = [];
  const pending = (await client.query(`SELECT receipt.id, receipt.receipt_number, receipt.status, receipt.approval_requested_at, mo.mo_number, mo.id AS order_id FROM tenant.manufacturing_finished_goods_receipts receipt
      JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id WHERE receipt.organization_id = $1 AND receipt.status = 'PENDING_APPROVAL' ORDER BY receipt.approval_requested_at`, [c.organizationId])).rows;
  for (const row of pending) out.push({ kind: "APPROVAL_PENDING", receiptId: row.id, receiptNumber: row.receipt_number, orderId: row.order_id, orderNumber: row.mo_number, since: row.approval_requested_at,
    message: "A receipt into another warehouse waits for approval." });
  const corrections = (await client.query(`SELECT correction.*, receipt.receipt_number, mo.mo_number, mo.id AS order_id FROM tenant.manufacturing_finished_goods_receipt_corrections correction
      JOIN tenant.manufacturing_finished_goods_receipts receipt ON receipt.id = correction.receipt_id JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id
     WHERE correction.organization_id = $1 AND correction.status = 'REQUESTED' ORDER BY correction.requested_at`, [c.organizationId])).rows;
  for (const row of corrections) out.push({ kind: "CORRECTION_PENDING", receiptId: row.receipt_id, receiptNumber: row.receipt_number, orderId: row.order_id, orderNumber: row.mo_number, since: row.requested_at,
    message: `${row.correction_number}: ${row.reason}` });
  const failed = (await client.query(`SELECT DISTINCT ON (receipt.id) receipt.id, receipt.receipt_number, mo.mo_number, mo.id AS order_id, event.summary, event.occurred_at
      FROM tenant.manufacturing_finished_goods_receipt_events event JOIN tenant.manufacturing_finished_goods_receipts receipt ON receipt.id = event.receipt_id
      JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id
     WHERE event.organization_id = $1 AND event.action = 'DEMAND_ALLOCATION_FAILED'
       AND NOT EXISTS (SELECT 1 FROM tenant.manufacturing_finished_goods_receipt_events later WHERE later.receipt_id = receipt.id AND later.action = 'DEMAND_ALLOCATED')
     ORDER BY receipt.id, event.occurred_at DESC`, [c.organizationId])).rows;
  for (const row of failed) out.push({ kind: "SALES_ALLOCATION_FAILED", receiptId: row.id, receiptNumber: row.receipt_number, orderId: row.order_id, orderNumber: row.mo_number, since: row.occurred_at,
    message: `Received, but not handed to its sales demand: ${row.summary}` });
  const posted = (await client.query(`SELECT id FROM tenant.manufacturing_finished_goods_receipts WHERE organization_id = $1 AND status IN ('POSTED', 'RECOVERY_REQUIRED') ORDER BY posted_at DESC LIMIT 300`,
    [c.organizationId])).rows;
  for (const row of posted) {
    const check = await checkFinishedGoodsReceiptPosting(client, c, row.id);
    if (!check.consistent || check.status === "RECOVERY_REQUIRED") {
      const receipt = await loadReceipt(client, c, row.id);
      out.push({ kind: "POSTING_MISMATCH", receiptId: row.id, receiptNumber: check.receiptNumber, orderId: receipt.manufacturing_order_id, orderNumber: null, since: receipt.posted_at,
        message: check.problems.join(" ") || "Marked for recovery." });
    }
  }
  const waiting = (await client.query(`SELECT mo.id, mo.mo_number, mo.status, mo.accepted_quantity - mo.received_quantity AS open, uom.code AS uom,
        (SELECT max(decision.decided_at) FROM tenant.manufacturing_quality_decisions decision WHERE decision.manufacturing_order_id = mo.id) AS last_decision,
        (SELECT max(entry.posted_at) FROM tenant.manufacturing_production_entries entry WHERE entry.manufacturing_order_id = mo.id) AS last_entry
       FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
      WHERE mo.organization_id = $1 AND mo.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING') AND mo.accepted_quantity > mo.received_quantity ORDER BY mo.mo_number`, [c.organizationId])).rows;
  for (const row of waiting) {
    const since = [row.last_decision, row.last_entry].filter(Boolean).sort().pop() ?? null;
    out.push({ kind: "ACCEPTED_NOT_RECEIVED", receiptId: null, receiptNumber: null, orderId: row.id, orderNumber: row.mo_number, since,
      message: `${q(D(row.open))} ${row.uom} accepted and not yet received.` });
  }
  return out;
}

// ------------------------------------------------------------------ reports
// kind: by-mo | by-date | by-item | by-warehouse | accepted-unreceived | partial-summary | reversals | traceability. filters: { from, to, warehouseId, orderId, itemId, lot, serial }
export async function getFinishedGoodsReceiptReport(client, c, kind = "by-date", filters = {}) {
  needFgr(c, FGR.view);
  const costView = canSeeCost(c);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["receipt.organization_id = $1", "receipt.status IN ('POSTED', 'RECOVERY_REQUIRED')"];
  if (filters.from) where.push(`receipt.posted_at >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`receipt.posted_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.warehouseId) where.push(`receipt.destination_warehouse_id = ${bind(uuid(filters.warehouseId, "Warehouse"))}`);
  if (filters.orderId) where.push(`receipt.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.itemId) where.push(`receipt.finished_item_id = ${bind(uuid(filters.itemId, "Item"))}`);
  const posted = `FROM tenant.manufacturing_finished_goods_receipts receipt JOIN tenant.manufacturing_goods_receipts record ON record.id = receipt.goods_receipt_id
    JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id JOIN tenant.items item ON item.id = receipt.finished_item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
    JOIN tenant.warehouses warehouse ON warehouse.id = receipt.destination_warehouse_id WHERE ${where.join(" AND ")}`;
  // A reversed receipt counts nothing: its quantity and value went back.
  const net = (column) => `sum(CASE WHEN receipt.correction_status = 'REVERSED' THEN 0 ELSE ${column} END)`;
  const cost = (value) => (costView ? money(D(value ?? 0)) : null);
  if (kind === "by-mo") {
    return (await client.query(`SELECT mo.id, mo.mo_number, item.code, uom.code AS uom, count(*)::int AS receipts, ${net("record.quantity")} AS quantity, ${net("record.total_cost")} AS cost,
        max(receipt.posted_at) AS last_received, mo.accepted_quantity, mo.received_quantity ${posted} GROUP BY mo.id, mo.mo_number, item.code, uom.code, mo.accepted_quantity, mo.received_quantity
        ORDER BY max(receipt.posted_at) DESC`, values)).rows.map((row) => ({ orderId: row.id, orderNumber: row.mo_number, code: row.code, uom: row.uom, receipts: row.receipts, received: q(D(row.quantity)),
      accepted: q(D(row.accepted_quantity)), receivable: q(sub(D(row.accepted_quantity), D(row.received_quantity))), lastReceivedAt: row.last_received, cost: cost(row.cost) }));
  }
  if (kind === "by-date") {
    return (await client.query(`SELECT to_char(receipt.posted_at, 'YYYY-MM-DD') AS day, count(*)::int AS receipts, count(DISTINCT mo.id)::int AS orders, count(DISTINCT item.id)::int AS items,
        ${net("record.quantity")} AS quantity, ${net("record.total_cost")} AS cost ${posted} GROUP BY 1 ORDER BY 1 DESC`, values)).rows
      .map((row) => ({ day: row.day, receipts: row.receipts, orders: row.orders, items: row.items, quantity: q(D(row.quantity)), cost: cost(row.cost) }));
  }
  if (kind === "by-item") {
    return (await client.query(`SELECT item.id, item.code, item.name, uom.code AS uom, count(*)::int AS receipts, count(DISTINCT mo.id)::int AS orders, ${net("record.quantity")} AS quantity,
        ${net("record.total_cost")} AS cost ${posted} GROUP BY item.id, item.code, item.name, uom.code ORDER BY item.code`, values)).rows
      .map((row) => ({ itemId: row.id, code: row.code, name: row.name, uom: row.uom, receipts: row.receipts, orders: row.orders, quantity: q(D(row.quantity)), cost: cost(row.cost) }));
  }
  if (kind === "by-warehouse") {
    return (await client.query(`SELECT warehouse.code AS warehouse, count(*)::int AS receipts, count(DISTINCT item.id)::int AS items, ${net("record.quantity")} AS quantity, ${net("record.total_cost")} AS cost ${posted}
        GROUP BY 1 ORDER BY 1`, values)).rows.map((row) => ({ warehouse: row.warehouse, receipts: row.receipts, items: row.items, quantity: q(D(row.quantity)), cost: cost(row.cost) }));
  }
  if (kind === "accepted-unreceived") {
    const orderWhere = ["mo.organization_id = $1", "mo.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING')", "mo.accepted_quantity > mo.received_quantity"];
    const orderValues = [c.organizationId];
    if (filters.itemId) { orderValues.push(uuid(filters.itemId, "Item")); orderWhere.push(`mo.finished_item_id = $${orderValues.length}`); }
    return (await client.query(`SELECT mo.id, mo.mo_number, mo.status, item.code, uom.code AS uom, mo.accepted_quantity, mo.received_quantity, warehouse.code AS warehouse
        FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
        JOIN tenant.warehouses warehouse ON warehouse.id = mo.finished_goods_warehouse_id WHERE ${orderWhere.join(" AND ")} ORDER BY mo.mo_number`, orderValues)).rows
      .map((row) => ({ orderId: row.id, orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.status], code: row.code, uom: row.uom, accepted: q(D(row.accepted_quantity)),
        received: q(D(row.received_quantity)), receivable: q(sub(D(row.accepted_quantity), D(row.received_quantity))), warehouse: row.warehouse }));
  }
  if (kind === "partial-summary") {
    const orderValues = [c.organizationId];
    const orderWhere = ["mo.organization_id = $1", "mo.received_quantity > 0 OR mo.accepted_quantity > 0"];
    if (filters.orderId) { orderValues.push(uuid(filters.orderId, "Manufacturing order")); orderWhere.push(`mo.id = $${orderValues.length}`); }
    return (await client.query(`SELECT mo.id, mo.mo_number, mo.status, item.code, uom.code AS uom, mo.planned_base_quantity, mo.reported_quantity, mo.accepted_quantity, mo.rejected_quantity,
        mo.pending_inspection_quantity, mo.received_quantity,
        (SELECT count(*)::int FROM tenant.manufacturing_finished_goods_receipts receipt WHERE receipt.manufacturing_order_id = mo.id AND receipt.status = 'POSTED' AND receipt.correction_status <> 'REVERSED') AS receipts
        FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
        WHERE ${orderWhere.map((part) => `(${part})`).join(" AND ")} ORDER BY mo.mo_number DESC LIMIT 1000`, orderValues)).rows
      .map((row) => ({ orderId: row.id, orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.status], code: row.code, uom: row.uom, planned: q(D(row.planned_base_quantity)),
        reported: q(D(row.reported_quantity)), accepted: q(D(row.accepted_quantity)), rejected: q(D(row.rejected_quantity)), pending: q(D(row.pending_inspection_quantity)),
        received: q(D(row.received_quantity)), receivable: q(sub(D(row.accepted_quantity), D(row.received_quantity))), receipts: row.receipts }));
  }
  if (kind === "reversals") {
    const rows = (await client.query(`SELECT correction.*, receipt.receipt_number, receipt.id AS receipt_id, mo.mo_number, mo.id AS order_id, item.code FROM tenant.manufacturing_finished_goods_receipt_corrections correction
        JOIN tenant.manufacturing_finished_goods_receipts receipt ON receipt.id = correction.receipt_id JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id
        JOIN tenant.items item ON item.id = receipt.finished_item_id WHERE correction.organization_id = $1 ORDER BY correction.requested_at DESC LIMIT 1000`, [c.organizationId])).rows;
    const people = await names(client, rows.flatMap((row) => [row.requested_by, row.decided_by]));
    return rows.map((row) => ({ number: row.correction_number, receiptId: row.receipt_id, receiptNumber: row.receipt_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code,
      quantity: q(D(row.quantity)), status: row.status, reason: row.reason, requestedBy: people.get(row.requested_by) ?? null, requestedAt: row.requested_at,
      decidedBy: people.get(row.decided_by) ?? null, decidedAt: row.decided_at, note: row.decision_note, cost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null }));
  }
  if (kind === "traceability") {
    // A finished-goods lot or serial unit → its receipt → the order → the production entry and batch → the raw-material lots issued to that order.
    const extra = [];
    if (filters.lot) extra.push(`lower(line.lot_number) = lower(${bind(String(filters.lot))})`);
    if (filters.serial) extra.push(`EXISTS (SELECT 1 FROM unnest(COALESCE(line.serial_numbers, '{}'::text[])) serial WHERE lower(serial) = lower(${bind(String(filters.serial))}))`);
    const rows = (await client.query(`SELECT receipt.id AS receipt_id, receipt.receipt_number, receipt.posted_at, receipt.correction_status, mo.id AS order_id, mo.mo_number, item.code, uom.code AS uom,
        entry.entry_number, batch.batch_reference, line.lot_number, line.serial_numbers, line.base_quantity, warehouse.code AS warehouse
        FROM tenant.manufacturing_finished_goods_receipt_lines line JOIN tenant.manufacturing_finished_goods_receipts receipt ON receipt.id = line.receipt_id
        JOIN tenant.manufacturing_goods_receipts record ON record.id = receipt.goods_receipt_id JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id
        JOIN tenant.items item ON item.id = receipt.finished_item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id JOIN tenant.warehouses warehouse ON warehouse.id = receipt.destination_warehouse_id
        JOIN tenant.manufacturing_production_entries entry ON entry.id = line.production_entry_id LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = line.production_batch_id
       WHERE ${[...where, ...extra].join(" AND ")} ORDER BY receipt.posted_at DESC LIMIT 1000`, values)).rows;
    const orderIds = [...new Set(rows.map((row) => row.order_id))];
    const materials = orderIds.length ? (await client.query(`SELECT issue.manufacturing_order_id, item.code, batch.batch_number, serial.serial_number, sum(part.quantity) AS quantity
        FROM tenant.manufacturing_material_issue_allocations part JOIN tenant.manufacturing_material_issue_lines line ON line.id = part.issue_line_id
        JOIN tenant.manufacturing_material_issues issue ON issue.id = line.material_issue_id JOIN tenant.items item ON item.id = line.item_id
        LEFT JOIN tenant.stock_batches batch ON batch.id = part.batch_id LEFT JOIN tenant.stock_serials serial ON serial.id = part.serial_id
       WHERE part.organization_id = $1 AND issue.manufacturing_order_id = ANY($2::uuid[]) AND (part.batch_id IS NOT NULL OR part.serial_id IS NOT NULL)
       GROUP BY 1, 2, 3, 4 ORDER BY 2, 3`, [c.organizationId, orderIds])).rows : [];
    return rows.map((row) => ({ receiptId: row.receipt_id, receiptNumber: row.receipt_number, at: row.posted_at, reversed: row.correction_status === "REVERSED", orderId: row.order_id,
      orderNumber: row.mo_number, code: row.code, uom: row.uom, entryNumber: row.entry_number, productionBatch: row.batch_reference, lot: row.lot_number, serials: row.serial_numbers ?? [],
      quantity: q(D(row.base_quantity)), warehouse: row.warehouse,
      materials: materials.filter((part) => part.manufacturing_order_id === row.order_id).map((part) => ({ code: part.code, lot: part.batch_number, serial: part.serial_number, quantity: q(D(part.quantity)) })) }));
  }
  throw fgrError(400, "MFG_FGR_STATE_INVALID", "Unknown report.");
}

export { FGR };
