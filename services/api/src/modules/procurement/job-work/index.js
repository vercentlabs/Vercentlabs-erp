// Job work (report Phase 3; GST s.143 and Form ITC-04). Material is sent to a job worker (a supplier) on a job-work challan, without tax;
// it comes back processed (inside the product the job worker returns, received on a goods receipt against the job worker's purchase order),
// unprocessed, or is lost or turned to waste there. Inputs must come back within one year and capital goods within three, or the sending is
// a supply. ITC-04 reports, for a period, what was sent and what came back.
//
// With the Stock app, sending moves the material by a direct stock transfer to the company's "At job workers" warehouse, so it stays ours
// and visible; unprocessed goods transfer back. Processed and waste quantities leave that warehouse on a goods issue (reason "Used in job
// work"), and the processed part's value is added to the finished goods' receipt (landed cost), so the product carries its material.
import { STOCK_TRANSFER_PERMISSIONS, GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";

import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { stockOn } from "../../../core/products/tracking.js";
import { completeInventoryTransfer, confirmInventoryTransfer, createInventoryTransfer } from "../../stock/transfers.js";
import { createGoodsIssue } from "../../stock/goods-issues.js";
import { restateReceiptCost } from "../../stock/landed-cost.js";
import { poCan } from "../purchase-orders/access.js";
import { PO_PERMISSIONS, PurchaseOrderError, fail, optionalUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { databaseToday } from "../purchase-orders/document.js";

export const JOB_WORK_GOODS = Object.freeze([{ code: "inputs", label: "Inputs (back within 1 year)", years: 1 }, { code: "capital_goods", label: "Capital goods (back within 3 years)", years: 3 }]);
export const JOB_WORK_RETURN_KINDS = Object.freeze(["processed", "unprocessed", "waste"]);
const STATUS_LABELS = { draft: "Draft", sent: "With the job worker", partly_returned: "Partly back", completed: "Back in full", cancelled: "Cancelled" };
const EPSILON = 1e-9;
const round = (value, places = 6) => Math.round(Number(value) * 10 ** places) / 10 ** places;
const day = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);
const addYears = (iso, years) => { const [y, m, d] = iso.split("-").map(Number); const at = new Date(Date.UTC(y + years, m - 1, d)); return at.toISOString().slice(0, 10); };
const stockAs = (context) => ({ ...context, apps: undefined, permissions: [...new Set([...(context.permissions ?? []), ...Object.values(STOCK_TRANSFER_PERMISSIONS),
  GOODS_ISSUE_PERMISSIONS.create, GOODS_ISSUE_PERMISSIONS.post, GOODS_ISSUE_PERMISSIONS.manageReasons, GOODS_ISSUE_PERMISSIONS.view, "stock.view", "stock.issue", "stock.receive"])] });

function requireJobWork(context, manage = false) {
  const allowed = manage ? poCan(context, PO_PERMISSIONS.create) || poCan(context, PO_PERMISSIONS.receive) : poCan(context, PO_PERMISSIONS.view) || poCan(context, PO_PERMISSIONS.receive);
  if (!allowed) throw new PurchaseOrderError(403, manage ? "You do not have permission to send goods for job work." : "You do not have permission to view job work.", "PERMISSION_DENIED");
}

// The company's "At job workers" warehouse (created the first time material is sent).
async function jobWorkWarehouse(client, context) {
  const known = (await client.query(`SELECT job_work_warehouse_id FROM tenant.procurement_settings WHERE organization_id = $1`, [context.organizationId])).rows[0]?.job_work_warehouse_id;
  if (known && (await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, known])).rowCount) return known;
  const codes = new Set((await client.query(`SELECT upper(code) AS code FROM tenant.warehouses WHERE organization_id = $1 AND upper(code) LIKE 'JOBWORK%'`, [context.organizationId])).rows.map((row) => row.code));
  let code = "JOBWORK";
  for (let index = 2; codes.has(code); index += 1) code = `JOBWORK-${index}`;
  const id = (await client.query(
    `INSERT INTO tenant.warehouses (organization_id, code, name, description, warehouse_type, receiving_enabled, shipping_enabled, transfer_enabled, returns_enabled, status, created_by, updated_by)
     VALUES ($1, $2, 'At job workers', 'Our material at job workers, sent on job-work challans. Maintained by Procurement.', 'virtual', false, false, true, false, 'active', $3, $3)
     RETURNING id`, [context.organizationId, code, context.userId ?? null])).rows[0].id;
  await client.query(`INSERT INTO tenant.procurement_settings (organization_id, job_work_warehouse_id) VALUES ($1, $2)
                      ON CONFLICT (organization_id) DO UPDATE SET job_work_warehouse_id = EXCLUDED.job_work_warehouse_id`, [context.organizationId, id]);
  return id;
}

// The goods issue reason for what the job worker used or lost.
async function jobWorkReason(client, context) {
  const existing = (await client.query(`SELECT id FROM tenant.goods_issue_reasons WHERE organization_id = $1 AND code = 'JOB_WORK'`, [context.organizationId])).rows[0];
  if (existing) return existing.id;
  return (await client.query(
    `INSERT INTO tenant.goods_issue_reasons (organization_id, code, name, description, allowed_dispositions, requires_recipient, requires_notes, created_by)
     VALUES ($1, 'JOB_WORK', 'Used in job work', 'Material a job worker used in the product or lost as waste.', ARRAY['available'], false, false, $2)
     ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [context.organizationId, context.userId ?? null])).rows[0].id;
}

function toOrder(row, lines = null, returns = null, today = null) {
  const open = lines ? lines.some((line) => Number(line.quantity) - Number(line.processed_quantity) - Number(line.returned_quantity) - Number(line.waste_quantity) > EPSILON) : null;
  return {
    id: row.id, number: row.number, status: row.status, statusLabel: STATUS_LABELS[row.status], supplierId: row.supplier_id, jobWorker: row.job_worker_snapshot ?? {},
    sentDate: day(row.sent_date), dueDate: day(row.due_date), goodsKind: row.goods_kind, natureOfJob: row.nature_of_job, warehouseId: row.warehouse_id, warehouseName: row.warehouse_name ?? null,
    purchaseOrderId: row.purchase_order_id, purchaseOrderNumber: row.purchase_order_number ?? null, vehicleNumber: row.vehicle_number, notes: row.notes, totalValue: Number(row.total_value),
    stockMoved: Boolean(row.transfer_id), overdue: Boolean(today && row.due_date && day(row.due_date) < today && ["sent", "partly_returned"].includes(row.status)),
    ...(lines ? { open, lines: lines.map((line) => ({ id: line.id, sequence: line.sequence, itemId: line.item_id, description: line.description, hsnSacCode: line.hsn_sac_code,
      unit: line.uqc, quantity: Number(line.quantity), unitValue: Number(line.unit_value), value: Number(line.value), processed: Number(line.processed_quantity),
      returned: Number(line.returned_quantity), waste: Number(line.waste_quantity),
      pending: round(Number(line.quantity) - Number(line.processed_quantity) - Number(line.returned_quantity) - Number(line.waste_quantity)) })) } : {}),
    ...(returns ? { returns: returns.map((entry) => ({ id: entry.id, lineId: entry.line_id, returnDate: day(entry.return_date), kind: entry.kind, quantity: Number(entry.quantity),
      challanNumber: entry.job_worker_challan_number, challanDate: day(entry.job_worker_challan_date), goodsReceiptId: entry.goods_receipt_id, goodsReceiptNumber: entry.goods_receipt_number ?? null,
      notes: entry.notes })) } : {}),
  };
}

const SELECT = `SELECT job.*, warehouse.name AS warehouse_name, purchase_order.purchase_order_number FROM tenant.job_work_orders job
  LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = job.organization_id AND warehouse.id = job.warehouse_id
  LEFT JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = job.organization_id AND purchase_order.id = job.purchase_order_id`;

// filters: { view: open | overdue | all, supplierId? }
export async function listJobWork(client, context, filters = {}) {
  requireJobWork(context);
  const values = [context.organizationId];
  const where = ["job.organization_id = $1"];
  if (filters.view === "open" || filters.view === "overdue") where.push("job.status IN ('draft', 'sent', 'partly_returned')");
  if (filters.view === "overdue") where.push("job.status <> 'draft' AND job.due_date < CURRENT_DATE");
  const supplierId = optionalUuid(filters.supplierId, "Job worker");
  if (supplierId) { values.push(supplierId); where.push(`job.supplier_id = $${values.length}`); }
  const today = await databaseToday(client, context.organizationId);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY job.created_at DESC LIMIT 300`, values)).rows;
  return { rows: rows.map((row) => toOrder(row, null, null, today)), goods: JOB_WORK_GOODS, canManage: poCan(context, PO_PERMISSIONS.create) || poCan(context, PO_PERMISSIONS.receive) };
}

async function load(client, context, id, { lock = false } = {}) {
  const row = (await client.query(`${SELECT} WHERE job.organization_id = $1 AND job.id = $2${lock ? " FOR UPDATE OF job" : ""}`, [context.organizationId, requireUuid(id, "Job work")])).rows[0];
  if (!row) throw new PurchaseOrderError(404, "That job work was not found.", "JOB_WORK_NOT_FOUND");
  return row;
}
const linesOf = async (client, context, id) => (await client.query(`SELECT * FROM tenant.job_work_order_lines WHERE organization_id = $1 AND job_work_order_id = $2 ORDER BY sequence`,
  [context.organizationId, id])).rows;

export async function getJobWork(client, context, id) {
  requireJobWork(context);
  const row = await load(client, context, id);
  const returns = (await client.query(
    `SELECT entry.*, receipt.receipt_number AS goods_receipt_number FROM tenant.job_work_returns entry
       LEFT JOIN tenant.goods_receipts receipt ON receipt.organization_id = entry.organization_id AND receipt.id = entry.goods_receipt_id
      WHERE entry.organization_id = $1 AND entry.job_work_order_id = $2 ORDER BY entry.return_date, entry.created_at`, [context.organizationId, row.id])).rows;
  const job = toOrder(row, await linesOf(client, context, row.id), returns, await databaseToday(client, context.organizationId));
  const manage = poCan(context, PO_PERMISSIONS.create) || poCan(context, PO_PERMISSIONS.receive);
  return { ...job, actions: { send: manage && row.status === "draft", recordReturn: manage && ["sent", "partly_returned"].includes(row.status), cancel: manage && row.status === "draft" } };
}

// input: { supplierId, warehouseId?, goodsKind, natureOfJob?, purchaseOrderId?, vehicleNumber?, notes?, lines: [{ itemId?, description?, hsnSacCode?, unit?, quantity, unitValue? }] }
export async function createJobWork(client, context, input = {}) {
  requireJobWork(context, true);
  const supplierId = requireUuid(input.supplierId, "Job worker");
  const supplier = (await client.query(
    `SELECT supplier.id, party.display_name, party.legal_name, upper(party.gstin) AS gstin, party.gst_state_code FROM tenant.procurement_suppliers supplier
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2 AND supplier.status = 'active'`, [context.organizationId, supplierId])).rows[0];
  if (!supplier) fail("Choose an active supplier as the job worker.", "supplierId", "JOB_WORK_SUPPLIER_INVALID", 409);
  const goodsKind = JOB_WORK_GOODS.some((entry) => entry.code === input.goodsKind) ? input.goodsKind : "inputs";
  const warehouseId = optionalUuid(input.warehouseId, "Warehouse");
  if (warehouseId && !(await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, warehouseId])).rowCount)
    fail("Choose an active warehouse.", "warehouseId");
  const purchaseOrderId = optionalUuid(input.purchaseOrderId, "Purchase order");
  if (purchaseOrderId && !(await client.query(`SELECT 1 FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2 AND supplier_id = $3 AND status <> 'cancelled'`,
    [context.organizationId, purchaseOrderId, supplierId])).rowCount) fail("Choose an order of this job worker.", "purchaseOrderId");
  const source = Array.isArray(input.lines) ? input.lines : [];
  if (!source.length) fail("Add the material being sent.", "lines");
  const lines = [];
  for (const [index, entry] of source.entries()) {
    const label = `Line ${index + 1}`;
    const quantity = Number(entry.quantity);
    if (!(quantity > 0)) fail(`${label}: enter the quantity.`, `lines.${index}.quantity`);
    const itemId = optionalUuid(entry.itemId, `${label} item`);
    const item = itemId ? (await client.query(
      `SELECT item.id, item.name, item.hsn_sac_code, item.standard_cost, item.purchase_price, item.tracking_type, uom.code AS uom_code FROM tenant.items item
         LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE item.organization_id = $1 AND item.id = $2`, [context.organizationId, itemId])).rows[0] : null;
    if (itemId && !item) fail(`${label}: choose an item.`, `lines.${index}.itemId`);
    const description = text(entry.description, 500) ?? item?.name;
    if (!description) fail(`${label}: describe the material.`, `lines.${index}.description`);
    const unitValue = entry.unitValue !== undefined && entry.unitValue !== null && entry.unitValue !== "" ? Number(entry.unitValue) : Number(item?.standard_cost ?? item?.purchase_price ?? 0);
    if (!Number.isFinite(unitValue) || unitValue < 0) fail(`${label}: enter the value.`, `lines.${index}.unitValue`);
    lines.push({ itemId: item?.id ?? null, tracking: item?.tracking_type ?? "none", description, hsn: text(entry.hsnSacCode, 8) ?? item?.hsn_sac_code ?? null,
      uqc: text(entry.unit, 10)?.toUpperCase() ?? item?.uom_code ?? "NOS", quantity: round(quantity), unitValue: round(unitValue), value: round(quantity * unitValue, 2) });
  }
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "job_work_challan" });
  const id = (await client.query(
    `INSERT INTO tenant.job_work_orders (organization_id, number, supplier_id, job_worker_snapshot, goods_kind, nature_of_job, warehouse_id, purchase_order_id, vehicle_number, notes, total_value,
       created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [context.organizationId, number, supplier.id, JSON.stringify({ name: supplier.display_name, legalName: supplier.legal_name, gstin: supplier.gstin, stateCode: supplier.gst_state_code }),
      goodsKind, text(input.natureOfJob, 200), warehouseId, purchaseOrderId, text(input.vehicleNumber, 20)?.toUpperCase().replace(/[\s-]/g, "") ?? null, text(input.notes, 2000),
      round(lines.reduce((sum, line) => sum + line.value, 0), 2), context.userId ?? null])).rows[0].id;
  for (const [index, line] of lines.entries())
    await client.query(
      `INSERT INTO tenant.job_work_order_lines (organization_id, job_work_order_id, sequence, item_id, description, hsn_sac_code, uqc, quantity, unit_value, value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [context.organizationId, id, index + 1, line.itemId, line.description, line.hsn, line.uqc, line.quantity, line.unitValue, line.value]);
  return getJobWork(client, context, id);
}

// Send: the challan is issued and, with the Stock app, the stocked material moves to "At job workers". input: { sentDate? }
export async function sendJobWork(client, context, id, input = {}) {
  requireJobWork(context, true);
  const row = await load(client, context, id, { lock: true });
  if (row.status !== "draft") fail("Only a draft is sent.", "status", "JOB_WORK_STATE_INVALID", 409);
  const today = await databaseToday(client, context.organizationId);
  const sentDate = readDate(input.sentDate, "Sent on") ?? today;
  if (sentDate > today) fail("The sent date cannot be in the future.", "sentDate");
  const lines = await linesOf(client, context, row.id);
  let transferId = null;
  const stocked = (await stockOn(client, context)) ? (await client.query(
    `SELECT line.id, line.item_id, line.quantity, item.tracking_type FROM tenant.job_work_order_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.job_work_order_id = $2 AND item.track_inventory`, [context.organizationId, row.id])).rows : [];
  if (stocked.length) {
    if (!row.warehouse_id) fail("Choose the warehouse the material leaves from.", "warehouseId", "JOB_WORK_WAREHOUSE_REQUIRED", 409);
    if (stocked.some((line) => line.tracking_type && line.tracking_type !== "none"))
      fail("Batch or serial items are moved to the job worker by a stock transfer, then entered here without an item.", "lines", "JOB_WORK_TRACKED_ITEM", 409);
    const as = stockAs(context);
    const destination = await jobWorkWarehouse(client, context);
    const transfer = await createInventoryTransfer(client, as, { sourceWarehouseId: row.warehouse_id, destinationWarehouseId: destination, transferMode: "direct", transferDate: sentDate,
      reference: row.number, notes: `Job work ${row.number} to ${row.job_worker_snapshot?.name ?? "the job worker"}`, idempotencyKey: `job-work:${row.id}:send`,
      lines: stocked.map((line) => ({ itemId: line.item_id, quantity: String(Number(line.quantity)) })) });
    transferId = transfer.transfer.id;
    await confirmInventoryTransfer(client, as, transferId);
    await completeInventoryTransfer(client, as, transferId);
  }
  const years = JOB_WORK_GOODS.find((entry) => entry.code === row.goods_kind)?.years ?? 1;
  await client.query(`UPDATE tenant.job_work_orders SET status = 'sent', sent_date = $3, due_date = $4, transfer_id = $5, sent_by = $6, sent_at = now(), updated_at = now()
                       WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, sentDate, addYears(sentDate, years), transferId, context.userId ?? null]);
  return getJobWork(client, context, row.id);
}

export async function cancelJobWork(client, context, id) {
  requireJobWork(context, true);
  const row = await load(client, context, id, { lock: true });
  if (row.status !== "draft") fail("Only a draft is cancelled; material already sent comes back as a return.", "status", "JOB_WORK_STATE_INVALID", 409);
  await client.query(`UPDATE tenant.job_work_orders SET status = 'cancelled', updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  return getJobWork(client, context, row.id);
}

// What came back. input: { returnDate?, challanNumber?, challanDate?, goodsReceiptId? (the finished goods' receipt, for processed material),
// notes?, lines: [{ lineId, processed?, unprocessed?, waste? }] }
export async function recordJobWorkReturn(client, context, id, input = {}) {
  requireJobWork(context, true);
  const row = await load(client, context, id, { lock: true });
  if (!["sent", "partly_returned"].includes(row.status)) fail("Record what came back on job work that was sent.", "status", "JOB_WORK_STATE_INVALID", 409);
  const today = await databaseToday(client, context.organizationId);
  const returnDate = readDate(input.returnDate, "Came back on") ?? today;
  if (returnDate > today || returnDate < day(row.sent_date)) fail("The return date is between the sent date and today.", "returnDate");
  const lines = new Map((await linesOf(client, context, row.id)).map((line) => [line.id, line]));
  const asked = (Array.isArray(input.lines) ? input.lines : []).map((entry) => ({ line: lines.get(entry.lineId), processed: Number(entry.processed ?? 0), unprocessed: Number(entry.unprocessed ?? 0),
    waste: Number(entry.waste ?? 0) })).filter((entry) => entry.line && (entry.processed > 0 || entry.unprocessed > 0 || entry.waste > 0));
  if (!asked.length) fail("Enter what came back, processed or not, or was lost.", "lines");
  for (const entry of asked) {
    if ([entry.processed, entry.unprocessed, entry.waste].some((value) => !Number.isFinite(value) || value < 0)) fail(`Line ${entry.line.sequence}: quantities cannot be negative.`, "lines");
    const pending = Number(entry.line.quantity) - Number(entry.line.processed_quantity) - Number(entry.line.returned_quantity) - Number(entry.line.waste_quantity);
    if (entry.processed + entry.unprocessed + entry.waste > pending + EPSILON)
      fail(`Line ${entry.line.sequence}: only ${round(pending)} is still with the job worker.`, "lines", "JOB_WORK_OVER_RETURN", 409);
  }
  let receipt = null;
  const goodsReceiptId = optionalUuid(input.goodsReceiptId, "Goods receipt");
  if (goodsReceiptId) {
    receipt = (await client.query(
      `SELECT receipt.id, receipt.receipt_number, receipt.status, (SELECT line.id FROM tenant.goods_receipt_lines line WHERE line.organization_id = receipt.organization_id
          AND line.goods_receipt_id = receipt.id AND line.product_type <> 'service' ORDER BY line.line_number LIMIT 1) AS line_id
         FROM tenant.goods_receipts receipt WHERE receipt.organization_id = $1 AND receipt.id = $2 AND receipt.supplier_id = $3`, [context.organizationId, goodsReceiptId, row.supplier_id])).rows[0];
    if (!receipt || receipt.status !== "posted") fail("Choose a final goods receipt from this job worker.", "goodsReceiptId", "JOB_WORK_RECEIPT_INVALID", 409);
  }
  const challan = text(input.challanNumber, 60);
  const challanDate = readDate(input.challanDate, "Job worker's challan date");
  // Stock: unprocessed back to the warehouse it left; processed and waste used up at the job worker.
  const moving = row.transfer_id ? await client.query(
    `SELECT line.id FROM tenant.job_work_order_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.job_work_order_id = $2 AND item.track_inventory`, [context.organizationId, row.id]).then((result) => new Set(result.rows.map((entry) => entry.id))) : new Set();
  const as = stockAs(context);
  const back = asked.filter((entry) => entry.unprocessed > 0 && moving.has(entry.line.id));
  const used = asked.filter((entry) => entry.processed + entry.waste > 0 && moving.has(entry.line.id));
  const stamp = `${row.id}:${Date.now()}`;
  if (back.length) {
    const atJobWorkers = await jobWorkWarehouse(client, context);
    const transfer = await createInventoryTransfer(client, as, { sourceWarehouseId: atJobWorkers, destinationWarehouseId: row.warehouse_id, transferMode: "direct", transferDate: returnDate,
      reference: row.number, notes: `Back from job work ${row.number}`, idempotencyKey: `job-work:${stamp}:back`,
      lines: back.map((entry) => ({ itemId: entry.line.item_id, quantity: String(entry.unprocessed) })) });
    await confirmInventoryTransfer(client, as, transfer.transfer.id);
    await completeInventoryTransfer(client, as, transfer.transfer.id);
  }
  let capitalised = 0;
  if (used.length) {
    const issue = await createGoodsIssue(client, as, { warehouseId: await jobWorkWarehouse(client, context), issueDate: returnDate, reasonId: await jobWorkReason(client, context),
      externalReference: row.number, notes: `Used or lost in job work ${row.number}`, idempotencyKey: `job-work:${stamp}:used`, post: true,
      lines: used.map((entry) => ({ itemId: entry.line.item_id, quantity: String(round(entry.processed + entry.waste)) })) });
    const posted = (await client.query(`SELECT journal_entry_id, issued_value FROM tenant.goods_issues WHERE organization_id = $1 AND id = $2`, [context.organizationId, issue.goodsIssue.id])).rows[0];
    // The finished goods carry the material (including normal waste): moved from the issue's expense onto the receipt's stock value.
    if (receipt?.line_id && posted?.journal_entry_id && Number(posted.issued_value) > 0) {
      const expense = (await client.query(`SELECT account_id FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND journal_entry_id = $2 AND base_debit_amount > 0 ORDER BY sequence LIMIT 1`,
        [context.organizationId, posted.journal_entry_id])).rows[0];
      if (expense) {
        await restateReceiptCost(client, as, receipt.line_id, { amount: String(posted.issued_value), creditAccountId: expense.account_id,
          description: `Material from job work ${row.number}`, reference: row.number });
        capitalised = Number(posted.issued_value);
      }
    }
  }
  for (const entry of asked) {
    for (const kind of JOB_WORK_RETURN_KINDS) {
      const quantity = entry[kind];
      if (!(quantity > 0)) continue;
      await client.query(
        `INSERT INTO tenant.job_work_returns (organization_id, job_work_order_id, line_id, return_date, kind, quantity, job_worker_challan_number, job_worker_challan_date, goods_receipt_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [context.organizationId, row.id, entry.line.id, returnDate, kind, quantity, challan, challanDate, kind === "processed" ? receipt?.id ?? null : null, text(input.notes, 1000), context.userId ?? null]);
    }
    await client.query(`UPDATE tenant.job_work_order_lines SET processed_quantity = processed_quantity + $3, returned_quantity = returned_quantity + $4, waste_quantity = waste_quantity + $5
                         WHERE organization_id = $1 AND id = $2`, [context.organizationId, entry.line.id, entry.processed, entry.unprocessed, entry.waste]);
  }
  const open = (await client.query(`SELECT 1 FROM tenant.job_work_order_lines WHERE organization_id = $1 AND job_work_order_id = $2
      AND quantity - processed_quantity - returned_quantity - waste_quantity > 0.000001`, [context.organizationId, row.id])).rowCount > 0;
  await client.query(`UPDATE tenant.job_work_orders SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, open ? "partly_returned" : "completed"]);
  return { ...(await getJobWork(client, context, row.id)), capitalised };
}

// Form ITC-04 for a period (from, to): table 4 (sent to job workers) and table 5A (back from them), as CSV in the portal's column order.
export async function exportItc04(client, context, { from, to } = {}) {
  requireJobWork(context);
  const start = readDate(from, "From");
  const end = readDate(to, "To");
  if (!start || !end || start > end) fail("Choose the period: from and to.", "from");
  const quote = (value) => { const raw = value === null || value === undefined ? "" : String(value); return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw; };
  const csv = (rows) => rows.map((row) => row.map(quote).join(",")).join("\n");
  const dmy = (value) => { const iso = day(value); return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : ""; };
  const sent = (await client.query(
    `SELECT job.number, job.sent_date, job.goods_kind, job.job_worker_snapshot, line.description, line.hsn_sac_code, line.uqc, line.quantity, line.value
       FROM tenant.job_work_orders job JOIN tenant.job_work_order_lines line ON line.organization_id = job.organization_id AND line.job_work_order_id = job.id
      WHERE job.organization_id = $1 AND job.status <> 'cancelled' AND job.status <> 'draft' AND job.sent_date BETWEEN $2 AND $3 ORDER BY job.sent_date, job.number, line.sequence`,
    [context.organizationId, start, end])).rows;
  const back = (await client.query(
    `SELECT job.number, job.sent_date, job.job_worker_snapshot, job.nature_of_job, line.description, line.uqc, entry.kind, entry.quantity, entry.return_date, entry.job_worker_challan_number,
            entry.job_worker_challan_date
       FROM tenant.job_work_returns entry JOIN tenant.job_work_orders job ON job.organization_id = entry.organization_id AND job.id = entry.job_work_order_id
       JOIN tenant.job_work_order_lines line ON line.organization_id = entry.organization_id AND line.id = entry.line_id
      WHERE entry.organization_id = $1 AND entry.return_date BETWEEN $2 AND $3 ORDER BY entry.return_date, job.number`, [context.organizationId, start, end])).rows;
  const table4 = [["GSTIN of job worker", "State", "Job worker's type", "Challan number", "Challan date", "Type of goods", "Description of goods", "HSN", "UQC", "Quantity", "Taxable value"],
    ...sent.map((row) => [row.job_worker_snapshot?.gstin ?? "", row.job_worker_snapshot?.stateCode ?? "", row.job_worker_snapshot?.gstin ? "Registered" : "Non-registered", row.number, dmy(row.sent_date),
      row.goods_kind === "capital_goods" ? "Capital goods" : "Inputs", row.description, row.hsn_sac_code ?? "", row.uqc ?? "", Number(row.quantity), Number(row.value).toFixed(2)])];
  const table5a = [["GSTIN of job worker", "State", "Original challan number", "Original challan date", "Job worker's challan number", "Job worker's challan date", "Nature of job work",
    "Description of goods", "UQC", "Quantity", "Losses UQC", "Losses quantity"],
    ...back.map((row) => [row.job_worker_snapshot?.gstin ?? "", row.job_worker_snapshot?.stateCode ?? "", row.number, dmy(row.sent_date), row.job_worker_challan_number ?? "",
      dmy(row.job_worker_challan_date ?? row.return_date), row.nature_of_job ?? "", row.description, row.kind === "waste" ? "" : row.uqc ?? "", row.kind === "waste" ? "" : Number(row.quantity),
      row.kind === "waste" ? row.uqc ?? "" : "", row.kind === "waste" ? Number(row.quantity) : ""])];
  return { fileName: `ITC-04_${start}_${end}.csv`, csv: `Table 4: goods sent to job workers\n${csv(table4)}\n\nTable 5A: goods received back from job workers\n${csv(table5a)}\n`,
    counts: { sent: sent.length, back: back.length } };
}
