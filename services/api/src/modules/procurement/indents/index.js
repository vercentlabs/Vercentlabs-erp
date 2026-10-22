// Purchase indents (Procurement plan Phase 2): a department or the store asks for items by a date; the head of department approves; the
// buyer turns approved lines into an RFQ or a purchase order. An indent is optional per company (Procurement Setup › Use purchase indents).
//
//   draft → submitted → approved → closed        rejected goes back to draft when edited; cancelled while nothing is ordered
//
// What a line has had ordered is read from the purchase order lines that name it (orders not cancelled) — never stored on the indent.
// Who sees what: anyone who may raise indents sees their own; buyers (orders), managers and approvers see all.
import { decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { normalizeQuantityToBase } from "../../products/uom.js";
import { poCan, requirePoPermission } from "../purchase-orders/access.js";
import { PO_PERMISSIONS, PurchaseOrderError, dayOf, fail, isUuid, optionalUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { procurementSettings } from "../purchase-orders/document.js";
import { databaseToday } from "../org-day.js";
import { pagedList } from "../paging.js";
import { createPurchaseOrder } from "../purchase-orders/records.js";
import { activeContractsByItem } from "../rate-contracts/index.js";

export const INDENT_PERMISSIONS = Object.freeze({
  create: "procurement.requisition.create", manage: "procurement.requisition.manage", approve: "procurement.requisition.approve",
});
export const INDENT_STATUS_LABELS = Object.freeze({
  draft: "Draft", submitted: "To approve", approved: "Approved", rejected: "Rejected", closed: "Closed", cancelled: "Cancelled",
});
export const INDENT_VIEWS = Object.freeze([
  { key: "to_approve", label: "To approve" }, { key: "to_order", label: "Approved, to order" }, { key: "mine", label: "My indents" }, { key: "draft", label: "Drafts" },
  { key: "all", label: "All" }, { key: "closed", label: "Closed" },
]);
const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const can = (context, ...keys) => keys.some((key) => poCan(context, key));
const seesAll = (context) => can(context, INDENT_PERMISSIONS.manage, INDENT_PERMISSIONS.approve, PO_PERMISSIONS.viewAll, PO_PERMISSIONS.create);

export function requireIndentAccess(context) {
  if (!can(context, INDENT_PERMISSIONS.create, INDENT_PERMISSIONS.manage, INDENT_PERMISSIONS.approve, PO_PERMISSIONS.view, PO_PERMISSIONS.viewAll))
    throw new PurchaseOrderError(403, "You do not have permission to view purchase indents.", "PERMISSION_DENIED");
}
async function requireIndentsOn(client, context) {
  if (!(await procurementSettings(client, context.organizationId)).useIndents)
    throw new PurchaseOrderError(409, "Purchase indents are turned off. Turn them on in Procurement Setup › Purchasing Rules.", "PURCHASE_INDENTS_OFF");
}

// What each line has had ordered (order lines naming it, orders not cancelled), in the indent line's unit when the order used it.
const ORDERED_SQL = `(SELECT COALESCE(sum(po_line.ordered_quantity), 0) FROM tenant.purchase_order_lines po_line
    JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id AND po.id = po_line.purchase_order_id
   WHERE po_line.organization_id = line.organization_id AND po_line.source_indent_line_id = line.id AND po.status <> 'cancelled')`;
// An indent with something still to order: an open line whose ordered quantity is short of what was asked.
const TO_ORDER_SQL = `EXISTS (SELECT 1 FROM tenant.purchase_indent_lines line WHERE line.organization_id = indent.organization_id AND line.indent_id = indent.id
    AND line.status = 'open' AND line.quantity > ${ORDERED_SQL})`;

// filters: view, search (number, purpose, item, requester), status, limit, offset.
export async function listPurchaseIndents(client, context, filters = {}) {
  requireIndentAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = "";
  if (!seesAll(context)) { const me = bind(context.userId ?? null); where += ` AND (indent.requested_by = ${me} OR indent.created_by = ${me})`; }
  const view = INDENT_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "all";
  if (view === "to_approve") where += " AND indent.status = 'submitted'";
  else if (view === "to_order") where += ` AND indent.status = 'approved' AND ${TO_ORDER_SQL}`;
  else if (view === "mine") { const me = bind(context.userId ?? null); where += ` AND (indent.requested_by = ${me} OR indent.created_by = ${me})`; }
  else if (view === "draft") where += " AND indent.status IN ('draft', 'rejected')";
  else if (view === "closed") where += " AND indent.status IN ('closed', 'cancelled')";
  if (Object.hasOwn(INDENT_STATUS_LABELS, filters.status ?? "")) where += ` AND indent.status = ${bind(filters.status)}`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (indent.indent_number ILIKE ${term} OR indent.purpose ILIKE ${term} OR requester.full_name ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.purchase_indent_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
                  WHERE line.organization_id = indent.organization_id AND line.indent_id = indent.id AND (item.name ILIKE ${term} OR item.code ILIKE ${term})))`;
  }
  return pagedList(client,
    `SELECT indent.id, indent.indent_number, indent.status, indent.source, indent.required_by, indent.purpose, indent.created_at, requester.full_name AS requested_by_name,
            warehouse.name AS warehouse_name,
            (SELECT count(*) FROM tenant.purchase_indent_lines line WHERE line.organization_id = indent.organization_id AND line.indent_id = indent.id)::int AS line_count,
            (SELECT string_agg(item.name, ', ' ORDER BY line.line_number) FROM tenant.purchase_indent_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
              WHERE line.organization_id = indent.organization_id AND line.indent_id = indent.id) AS items,
            indent.status = 'approved' AND ${TO_ORDER_SQL} AS to_order
       FROM tenant.purchase_indents indent
       LEFT JOIN public.users requester ON requester.id = indent.requested_by
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = indent.organization_id AND warehouse.id = indent.warehouse_id
      WHERE indent.organization_id = $1${where} ORDER BY (indent.status = 'submitted') DESC, indent.required_by NULLS LAST, indent.created_at DESC`, values, filters, (row) => ({
    id: row.id, number: row.indent_number, status: row.status, statusLabel: INDENT_STATUS_LABELS[row.status], source: row.source, requiredBy: dayOf(row.required_by),
    purpose: row.purpose, requestedBy: row.requested_by_name, warehouseName: row.warehouse_name, lineCount: row.line_count, items: row.items, toOrder: row.to_order,
    createdAt: row.created_at,
  }));
}

async function loadIndent(client, context, indentId, { lock = false } = {}) {
  requireIndentAccess(context);
  const row = (await client.query(`SELECT * FROM tenant.purchase_indents WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(indentId, "Indent")])).rows[0];
  if (!row || (!seesAll(context) && row.requested_by !== context.userId && row.created_by !== context.userId))
    throw new PurchaseOrderError(404, "Purchase indent not found.", "PURCHASE_INDENT_NOT_FOUND");
  return row;
}

async function indentLines(client, organizationId, indentId) {
  return (await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name, item.purchase_uom_id, item.uom_id AS base_uom_id, uom.code AS uom_code, warehouse.name AS warehouse_name,
            ${ORDERED_SQL} AS ordered_quantity
       FROM tenant.purchase_indent_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = line.warehouse_id
      WHERE line.organization_id = $1 AND line.indent_id = $2 ORDER BY line.line_number`, [organizationId, indentId])).rows;
}

export async function getPurchaseIndent(client, context, indentId) {
  const row = await loadIndent(client, context, indentId);
  const people = (await client.query(`SELECT id, full_name FROM public.users WHERE id = ANY($1::uuid[])`, [[row.requested_by, row.decided_by, row.created_by].filter(Boolean)])).rows;
  const name = (id) => people.find((person) => person.id === id)?.full_name ?? null;
  const lines = await indentLines(client, context.organizationId, row.id);
  const orders = (await client.query(
    `SELECT DISTINCT po.id, po.purchase_order_number, po.status, po.order_date FROM tenant.purchase_order_lines po_line
       JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id AND po.id = po_line.purchase_order_id
       JOIN tenant.purchase_indent_lines line ON line.organization_id = po_line.organization_id AND line.id = po_line.source_indent_line_id
      WHERE line.organization_id = $1 AND line.indent_id = $2 ORDER BY po.order_date`, [context.organizationId, row.id])).rows;
  const rfqs = (await client.query(
    `SELECT DISTINCT rfq.id, rfq.rfq_number, rfq.status FROM tenant.purchase_rfq_lines rfq_line JOIN tenant.purchase_rfqs rfq ON rfq.organization_id = rfq_line.organization_id AND rfq.id = rfq_line.rfq_id
       JOIN tenant.purchase_indent_lines line ON line.organization_id = rfq_line.organization_id AND line.id = rfq_line.indent_line_id
      WHERE line.organization_id = $1 AND line.indent_id = $2`, [context.organizationId, row.id])).rows;
  const remaining = (line) => (line.status === "open" ? sub(decimal(line.quantity), decimal(line.ordered_quantity)) : 0n);
  // Items on an active rate contract are bought from it — no RFQ needed (Procurement plan Phase 3).
  const contracts = await activeContractsByItem(client, context.organizationId, lines.map((line) => line.item_id), await databaseToday(client, context.organizationId));
  const somethingToOrder = lines.some((line) => remaining(line) > 0n);
  const nothingOrdered = lines.every((line) => decimal(line.ordered_quantity) === 0n);
  const own = row.requested_by === context.userId || row.created_by === context.userId;
  const owner = (context.roleSlugs ?? []).some((slug) => slug === "organization_owner" || slug === "system_administrator");
  const mayEdit = own || can(context, INDENT_PERMISSIONS.manage);
  return {
    indent: {
      id: row.id, number: row.indent_number, status: row.status, statusLabel: INDENT_STATUS_LABELS[row.status], source: row.source, requiredBy: dayOf(row.required_by),
      purpose: row.purpose, notes: row.notes, warehouseId: row.warehouse_id, departmentId: row.department_id, costCenterId: row.cost_center_id,
      requestedById: row.requested_by, requestedBy: name(row.requested_by), submittedAt: row.submitted_at, decidedAt: row.decided_at, decidedBy: name(row.decided_by),
      decisionNote: row.decision_note, createdAt: row.created_at,
    },
    lines: lines.map((line) => ({
      id: line.id, lineNumber: line.line_number, productId: line.item_id, productCode: line.item_code, productName: line.item_name, description: line.description,
      quantity: dec(line.quantity), uomId: line.uom_id, uomCode: line.uom_code, requiredBy: dayOf(line.required_by ?? row.required_by), warehouseId: line.warehouse_id ?? row.warehouse_id,
      warehouseName: line.warehouse_name, status: line.status, ordered: dec(line.ordered_quantity), remaining: dec(remaining(line) > 0n ? remaining(line) : 0n), notes: line.notes,
      contract: contracts.get(line.item_id) ?? null,
    })),
    orders: orders.map((order) => ({ id: order.id, number: order.purchase_order_number, status: order.status, href: `/procurement/purchase-orders/${order.id}` })),
    rfqs: rfqs.map((rfq) => ({ id: rfq.id, number: rfq.rfq_number, status: rfq.status, href: `/procurement/rfqs/${rfq.id}` })),
    actions: {
      edit: ["draft", "rejected"].includes(row.status) && mayEdit,
      submit: ["draft", "rejected"].includes(row.status) && mayEdit,
      // An approver does not approve their own indent (the owner may).
      approve: row.status === "submitted" && can(context, INDENT_PERMISSIONS.approve) && (!own || owner),
      reject: row.status === "submitted" && can(context, INDENT_PERMISSIONS.approve),
      order: row.status === "approved" && somethingToOrder && poCan(context, PO_PERMISSIONS.create),
      rfq: row.status === "approved" && somethingToOrder && poCan(context, PO_PERMISSIONS.create),
      close: row.status === "approved" && can(context, INDENT_PERMISSIONS.manage, PO_PERMISSIONS.create),
      cancel: ["draft", "submitted", "rejected", "approved"].includes(row.status) && nothingOrdered && (mayEdit || can(context, INDENT_PERMISSIONS.approve)),
    },
  };
}

// The lines as typed: item, quantity, unit (the item's purchase unit by default), required-by date, warehouse.
async function readLines(client, context, input) {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) fail("Add at least one item.", "lines", "PURCHASE_INDENT_NO_LINES");
  if (lines.length > 200) fail("An indent has at most 200 lines.", "lines");
  const parsed = [];
  for (const [index, line] of lines.entries()) {
    const label = `Line ${index + 1}`;
    const itemId = requireUuid(line.productId ?? line.itemId, `${label} item`);
    const item = (await client.query(`SELECT id, uom_id, purchase_uom_id, status, is_purchasable FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, itemId])).rows[0];
    if (!item || item.status !== "active") fail(`${label}: choose an active item.`, "productId", "PURCHASE_INDENT_ITEM_INVALID", 409);
    if (item.is_purchasable === false) fail(`${label}: this item is not bought.`, "productId", "PURCHASE_INDENT_ITEM_INVALID", 409);
    const quantity = String(line.quantity ?? "").trim();
    if (!/^\d+(\.\d{1,6})?$/.test(quantity) || decimal(quantity) <= 0n) fail(`${label}: the quantity must be more than zero.`, "quantity");
    const uomId = optionalUuid(line.uomId, `${label} unit`) ?? item.purchase_uom_id ?? item.uom_id;
    const unit = await normalizeQuantityToBase(client, context.organizationId, item.id, uomId, decimal(quantity), { purpose: "purchase" });
    if (!unit.ok) fail(`${label}: ${unit.message}`, "uomId", "PURCHASE_INDENT_UOM_INVALID");
    parsed.push({ itemId, quantity, uomId, description: text(line.description, 1000), requiredBy: readDate(line.requiredBy, `${label} required by`),
      warehouseId: optionalUuid(line.warehouseId, `${label} warehouse`), costCenterId: optionalUuid(line.costCenterId, `${label} cost centre`), notes: text(line.notes, 1000) });
  }
  return parsed;
}

async function writeLines(client, context, indentId, lines) {
  await client.query(`DELETE FROM tenant.purchase_indent_lines WHERE organization_id = $1 AND indent_id = $2`, [context.organizationId, indentId]);
  for (const [index, line] of lines.entries())
    await client.query(
      `INSERT INTO tenant.purchase_indent_lines (organization_id, indent_id, line_number, item_id, description, quantity, uom_id, required_by, warehouse_id, cost_center_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [context.organizationId, indentId, index + 1, line.itemId, line.description, line.quantity, line.uomId, line.requiredBy, line.warehouseId, line.costCenterId, line.notes]);
}

async function readHeader(client, context, input) {
  const warehouseId = optionalUuid(input.warehouseId, "Warehouse");
  if (warehouseId && !(await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [context.organizationId, warehouseId])).rows[0])
    fail("Choose a warehouse.", "warehouseId", "PURCHASE_INDENT_WAREHOUSE_INVALID", 409);
  const requiredBy = readDate(input.requiredBy, "Required by");
  if (requiredBy && requiredBy < await databaseToday(client, context.organizationId)) fail("The required-by date has passed.", "requiredBy");
  return { warehouseId, requiredBy, purpose: text(input.purpose, 500), notes: text(input.notes, 2000), departmentId: optionalUuid(input.departmentId, "Department"),
    costCenterId: optionalUuid(input.costCenterId, "Cost centre") };
}

// createPurchaseIndent. input: { requiredBy?, warehouseId?, departmentId?, costCenterId?, purpose?, notes?, lines: [{ productId, quantity, uomId?, requiredBy?,
// warehouseId?, description?, notes? }], submit?, source? (internal: "reorder") }
export async function createPurchaseIndent(client, context, input = {}, { source = "manual" } = {}) {
  if (!can(context, INDENT_PERMISSIONS.create, INDENT_PERMISSIONS.manage)) throw new PurchaseOrderError(403, "You do not have permission to raise purchase indents.", "PERMISSION_DENIED");
  await requireIndentsOn(client, context);
  const header = await readHeader(client, context, input);
  const lines = await readLines(client, context, input);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "purchase_indent" });
  const row = (await client.query(
    `INSERT INTO tenant.purchase_indents (organization_id, indent_number, status, source, requested_by, department_id, cost_center_id, warehouse_id, required_by, purpose, notes,
       submitted_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $5, $5) RETURNING id, indent_number, status`,
    [context.organizationId, number, input.submit ? "submitted" : "draft", source, context.userId ?? null, header.departmentId, header.costCenterId, header.warehouseId, header.requiredBy,
      header.purpose, header.notes, input.submit ? new Date().toISOString() : null])).rows[0];
  await writeLines(client, context, row.id, lines);
  return { id: row.id, number: row.indent_number, status: row.status };
}

export async function updatePurchaseIndent(client, context, indentId, input = {}) {
  const row = await loadIndent(client, context, indentId, { lock: true });
  const detail = await getPurchaseIndent(client, context, row.id);
  if (!detail.actions.edit) throw new PurchaseOrderError(409, `A ${INDENT_STATUS_LABELS[row.status].toLowerCase()} indent cannot be changed.`, "PURCHASE_INDENT_LOCKED");
  const header = await readHeader(client, context, { ...detail.indent, ...input });
  await client.query(
    `UPDATE tenant.purchase_indents SET status = 'draft', warehouse_id = $3, required_by = $4, purpose = $5, notes = $6, department_id = $7, cost_center_id = $8, updated_by = $9,
            updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, header.warehouseId, header.requiredBy, header.purpose, header.notes, header.departmentId, header.costCenterId, context.userId ?? null]);
  if (Array.isArray(input.lines)) await writeLines(client, context, row.id, await readLines(client, context, input));
  return { id: row.id, status: "draft" };
}

async function decide(client, context, indentId, action, input = {}) {
  const row = await loadIndent(client, context, indentId, { lock: true });
  const detail = await getPurchaseIndent(client, context, row.id);
  if (!detail.actions[action]) {
    const why = { approve: "Only a submitted indent is approved, by an approver other than the person who raised it.", reject: "Only a submitted indent is rejected.",
      submit: "Only a draft indent is submitted.", close: "Only an approved indent is closed.", cancel: "An indent with something ordered cannot be cancelled: close it instead." }[action];
    throw new PurchaseOrderError(409, why, "PURCHASE_INDENT_ACTION_NOT_ALLOWED");
  }
  const note = text(input.note ?? input.reason, 1000);
  if (action === "reject" && !note) fail("Give the reason for rejecting the indent.", "reason", "PURCHASE_INDENT_REASON_REQUIRED");
  const status = { submit: "submitted", approve: "approved", reject: "rejected", close: "closed", cancel: "cancelled" }[action];
  await client.query(
    `UPDATE tenant.purchase_indents SET status = $3, submitted_at = CASE WHEN $3 = 'submitted' THEN now() ELSE submitted_at END,
            decided_at = CASE WHEN $3 IN ('approved', 'rejected') THEN now() ELSE decided_at END, decided_by = CASE WHEN $3 IN ('approved', 'rejected') THEN $4 ELSE decided_by END,
            decision_note = CASE WHEN $3 IN ('approved', 'rejected') THEN $5 ELSE decision_note END, closed_at = CASE WHEN $3 IN ('closed', 'cancelled') THEN now() ELSE closed_at END,
            updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null, note]);
  return { id: row.id, status };
}
export const submitPurchaseIndent = (client, context, id) => decide(client, context, id, "submit");
export const approvePurchaseIndent = (client, context, id, input = {}) => decide(client, context, id, "approve", input);
export const rejectPurchaseIndent = (client, context, id, input = {}) => decide(client, context, id, "reject", input);
export const closePurchaseIndent = (client, context, id) => decide(client, context, id, "close");
export const cancelPurchaseIndent = (client, context, id) => decide(client, context, id, "cancel");

// Approved indent lines with something still to order — the buyer's "Indents to buy" picker for a purchase order or an RFQ.
// filters: { itemId?, indentId?, search? }
export async function listIndentLinesToOrder(client, context, filters = {}) {
  requireIndentAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = "";
  if (isUuid(filters.indentId)) where += ` AND indent.id = ${bind(filters.indentId)}`;
  if (isUuid(filters.itemId)) where += ` AND line.item_id = ${bind(filters.itemId)}`;
  const search = text(filters.search, 120);
  if (search) { const term = bind(`%${search}%`); where += ` AND (indent.indent_number ILIKE ${term} OR item.name ILIKE ${term} OR item.code ILIKE ${term})`; }
  const rows = (await client.query(
    `SELECT line.id, line.indent_id, indent.indent_number, line.item_id, item.code AS item_code, item.name AS item_name, line.quantity, line.uom_id, uom.code AS uom_code,
            COALESCE(line.required_by, indent.required_by) AS required_by, COALESCE(line.warehouse_id, indent.warehouse_id) AS warehouse_id, ${ORDERED_SQL} AS ordered_quantity,
            item.purchase_price
       FROM tenant.purchase_indent_lines line
       JOIN tenant.purchase_indents indent ON indent.organization_id = line.organization_id AND indent.id = line.indent_id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
      WHERE line.organization_id = $1 AND indent.status = 'approved' AND line.status = 'open' AND line.quantity > ${ORDERED_SQL}${where}
      ORDER BY COALESCE(line.required_by, indent.required_by) NULLS LAST, indent.indent_number, line.line_number LIMIT 300`, values)).rows;
  return rows.map((row) => ({
    id: row.id, indentId: row.indent_id, indentNumber: row.indent_number, productId: row.item_id, productCode: row.item_code, productName: row.item_name,
    quantity: dec(row.quantity), ordered: dec(row.ordered_quantity), remaining: dec(sub(decimal(row.quantity), decimal(row.ordered_quantity))), uomId: row.uom_id, uomCode: row.uom_code,
    requiredBy: dayOf(row.required_by), warehouseId: row.warehouse_id, purchasePrice: dec(row.purchase_price),
  }));
}

// createPurchaseOrderFromIndents: one draft purchase order to a supplier for approved indent lines (what is still to order, or less).
// input: { supplierId, lines: [{ indentLineId, quantity?, unitPrice? }], expectedDeliveryDate?, defaultWarehouseId?, idempotencyKey? }
// A line's price defaults to the last price agreed with this supplier, else the item's purchase price.
export async function createPurchaseOrderFromIndents(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to create purchase orders.");
  const supplierId = requireUuid(input.supplierId, "Supplier");
  const asked = Array.isArray(input.lines) ? input.lines : [];
  if (!asked.length) fail("Choose the indent lines to order.", "lines", "PURCHASE_INDENT_NO_LINES");
  const open = new Map((await listIndentLinesToOrder(client, context, {})).map((line) => [line.id, line]));
  const lines = [];
  let warehouse = optionalUuid(input.defaultWarehouseId, "Warehouse");
  let earliest = null;
  for (const [index, entry] of asked.entries()) {
    const line = open.get(entry.indentLineId);
    if (!line) fail(`Line ${index + 1}: the indent line is not approved or has nothing left to order.`, "lines", "PURCHASE_INDENT_LINE_INVALID", 409);
    const quantity = entry.quantity ? String(entry.quantity).trim() : line.remaining;
    if (decimal(quantity) <= 0n || decimal(quantity) > decimal(line.remaining)) fail(`${line.indentNumber} · ${line.productName}: order at most ${line.remaining}.`, "lines", "PURCHASE_INDENT_OVER_ORDER", 409);
    let unitPrice = entry.unitPrice !== undefined && entry.unitPrice !== null && entry.unitPrice !== "" ? String(entry.unitPrice) : null;
    if (unitPrice === null) {
      unitPrice = (await client.query(
        `SELECT po_line.unit_price FROM tenant.purchase_order_lines po_line JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id AND po.id = po_line.purchase_order_id
          WHERE po_line.organization_id = $1 AND po_line.product_id = $2 AND po.supplier_id = $3 AND po.status IN ('confirmed', 'closed') AND po_line.purchase_uom_id = $4
          ORDER BY po.order_date DESC LIMIT 1`, [context.organizationId, line.productId, supplierId, line.uomId])).rows[0]?.unit_price ?? line.purchasePrice;
      unitPrice = unitPrice === null || unitPrice === undefined ? null : formatDecimal(unitPrice);
    }
    if (unitPrice === null) fail(`${line.indentNumber} · ${line.productName}: enter the price.`, "lines", "PURCHASE_ORDER_PRICE_MISSING");
    warehouse ??= line.warehouseId;
    if (line.requiredBy && (!earliest || line.requiredBy < earliest)) earliest = line.requiredBy;
    lines.push({ productId: line.productId, quantity, uomId: line.uomId, unitPrice, warehouseId: line.warehouseId ?? undefined, expectedDeliveryDate: line.requiredBy ?? undefined,
      sourceIndentLineId: line.id });
  }
  const today = await databaseToday(client, context.organizationId);
  const indents = [...new Set(asked.map((entry) => open.get(entry.indentLineId).indentNumber))];
  return createPurchaseOrder(client, context, {
    supplierId, defaultWarehouseId: warehouse ?? undefined, expectedDeliveryDate: input.expectedDeliveryDate ?? (earliest && earliest >= today ? earliest : undefined),
    internalNotes: `For indent ${indents.join(", ")}`, idempotencyKey: input.idempotencyKey, lines,
  });
}

// The reorder bridge (Stock › Replenishment, when reorders open indents): a submitted indent for the item and quantity, raised by the
// person who acted on the reorder.
export async function draftIndentFromReorder(client, context, { itemId, quantity, uomId, warehouseId, note }) {
  const internal = { ...context, permissions: [...new Set([...(context.permissions ?? []), INDENT_PERMISSIONS.create])] };
  return createPurchaseIndent(client, internal, { warehouseId, purpose: note, submit: true, lines: [{ productId: itemId, quantity, uomId, warehouseId }] }, { source: "reorder" });
}
