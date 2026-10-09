// Reorder Level / Replenishment: static Min/Max planning rules per warehouse and stock item. A planning control only — it never moves stock,
// never confirms a purchase order, receipt or transfer, and never stores a stock figure of its own.
//
//   rule            configuration: enabled, reorder level, target, order multiple (base units), notes          tenant.inventory_reorder_rules
//   status          the rebuildable planning projection: eligible on hand, firm demand, firm incoming, positions, suggested quantity, status
//                   (computed by tenant.refresh_reorder_rule — the one definition — and kept current by database triggers)
//   recommendation  one live per rule: open → actioned (a draft purchase order or transfer was opened) | dismissed → resolved by itself
//
// Every quantity is in the item's base unit; a purchase draft shows it in the purchase unit when it converts exactly. Drafts opened from a
// recommendation are ordinary drafts of their own workflows: they count as incoming only once confirmed there.
import { STOCK_REORDER_PERMISSIONS as P } from "@vercentlabs/permissions";
import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { decimal, formatDecimal } from "../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { parseCsvUpload } from "../../core/platform/data-exchange/csv.js";
import { buildXlsxWorkbook, isXlsxFileName, parseXlsxUpload } from "../../core/platform/data-exchange/xlsx.js";
import { createPurchaseOrder } from "../procurement/purchase-orders/index.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { restrictedStockSql } from "./rules.js";
import { createInventoryTransfer } from "./transfers.js";

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const n = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 1e6) / 1e6);
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
export class ReorderError extends StockError {}
const fail = (message, code = "REORDER_INVALID", status = 400, details) => { throw Object.assign(new ReorderError(status, message, code), details ? { details } : {}); };
const uuid = (value, label) => {
  if (!value || !UUID.test(String(value))) fail(`${label} is required.`, "REORDER_INVALID");
  return String(value);
};
const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));

export const REORDER_STATUSES = Object.freeze([
  { id: "reorder_required", label: "Reorder required" }, { id: "out_of_stock", label: "Out of stock" },
  { id: "below_reorder_covered", label: "Low stock — replenishment in progress" }, { id: "ok", label: "OK" }, { id: "disabled", label: "Disabled" },
]);
const STATUS_LABEL = Object.fromEntries(REORDER_STATUSES.map((entry) => [entry.id, entry.label]));

// ---------------------------------------------------------------- the arithmetic (the database function is the one used; this explains it)
// suggested = max(0, target − projected), rounded up to the order multiple, else up to whole units when the unit has no decimals.
export function calculateSuggestedReplenishmentQuantity({ target, projected, orderMultiple = null, wholeUnits = false }) {
  const raw = Math.max(0, Number(target) - Number(projected));
  if (raw === 0) return 0;
  if (orderMultiple) return n(Math.ceil(raw / Number(orderMultiple) - 1e-9) * Number(orderMultiple));
  return wholeUnits ? Math.ceil(raw - 1e-9) : n(raw);
}

// ---------------------------------------------------------------- scope
async function warehouses(client, c) { return visibleWarehouseIds(client, c); }
async function assertWarehouse(client, c, warehouseId) {
  const row = (await client.query(`SELECT id, code, name, system_role, status FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, warehouseId])).rows[0];
  if (!row) fail("Warehouse not found.", "REORDER_WAREHOUSE_NOT_FOUND", 404);
  if (row.system_role) fail("Reorder rules belong to stocking warehouses, not the in-transit warehouse.", "REORDER_WAREHOUSE_INVALID");
  const visible = await warehouses(client, c);
  if (visible && !visible.includes(row.id)) fail("You do not have access to that warehouse.", "REORDER_WAREHOUSE_FORBIDDEN", 403);
  return row;
}
// A stock item: tracked in inventory (never a service or a non-stock item), with its base unit's precision.
async function stockItem(client, c, itemId) {
  const row = (await client.query(
    `SELECT item.id, item.code, item.name, item.item_type, item.track_inventory, item.tracking_type, item.uom_id, item.purchase_uom_id, item.lifecycle_status,
            uom.code AS base_uom, COALESCE(uom.decimal_places, 6) AS decimals
       FROM tenant.items item LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
      WHERE item.organization_id = $1 AND item.id = $2`, [c.organizationId, itemId])).rows[0];
  if (!row) fail("Item not found.", "REORDER_ITEM_NOT_FOUND", 404);
  if (row.item_type === "service") fail(`${row.code} is a service: services have no stock to reorder.`, "REORDER_ITEM_NOT_STOCK");
  if (!row.track_inventory) fail(`${row.code} is not a stock item: only items kept in inventory have reorder levels.`, "REORDER_ITEM_NOT_STOCK");
  return row;
}

// Quantities: zero or more (the reorder level), more than the reorder level (the target), more than zero (the multiple); whole units for
// serial numbers or a unit without decimals, never more decimals than the base unit allows.
function quantities(input, item, current = null) {
  const pick = (key, column) => (input[key] !== undefined ? input[key] : current?.[column]);
  const read = (value, label, { required = true, positive = false } = {}) => {
    if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`, "REORDER_QUANTITY_REQUIRED"); return null; }
    const raw = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) fail(`${label} must be a number, zero or more.`, "REORDER_QUANTITY_INVALID");
    const decimals = raw.includes(".") ? raw.split(".")[1].replace(/0+$/, "").length : 0;
    const allowed = item.tracking_type === "serial" ? 0 : Math.min(Number(item.decimals), 6);
    if (decimals > allowed) fail(`${label}: ${item.tracking_type === "serial" ? "serial-numbered items are planned in whole units" : `${item.base_uom} allows ${allowed} decimal place${allowed === 1 ? "" : "s"}`}.`, "REORDER_QUANTITY_PRECISION");
    if (positive && Number(raw) <= 0) fail(`${label} must be more than zero.`, "REORDER_MULTIPLE_INVALID");
    return formatDecimal(decimal(raw));
  };
  const reorder = read(pick("reorderLevel", "reorder_level_base_quantity"), "Reorder level");
  const target = read(pick("targetLevel", "target_level_base_quantity"), "Target stock level");
  const multipleInput = pick("orderMultiple", "order_multiple_base_quantity");
  const multiple = read(multipleInput, "Order multiple", { required: false, positive: true });
  if (Number(target) <= Number(reorder)) fail("The target stock level must be more than the reorder level.", "REORDER_TARGET_INVALID");
  return { reorder, target, multiple };
}

async function event(client, c, { ruleId = null, recommendationId = null, type, summary, oldValues = null, newValues = null, details = {} }) {
  await client.query(
    `INSERT INTO tenant.inventory_reorder_events (organization_id, rule_id, recommendation_id, event_type, summary, old_values, new_values, details, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [c.organizationId, ruleId, recommendationId, type, summary, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, JSON.stringify(details), c.userId ?? null]);
}
const configOf = (row) => ({ enabled: row.enabled, reorderLevel: n(row.reorder_level_base_quantity), targetLevel: n(row.target_level_base_quantity),
  orderMultiple: n(row.order_multiple_base_quantity), notes: row.notes ?? null });

// ---------------------------------------------------------------- rules
// input: { warehouseId, itemId, reorderLevel, targetLevel, orderMultiple?, enabled?, notes? } (base units)
export async function createReorderRule(client, c, input = {}) {
  need(c, P.create, "You do not have permission to create reorder rules.");
  const warehouse = await assertWarehouse(client, c, uuid(input.warehouseId, "Warehouse"));
  const item = await stockItem(client, c, uuid(input.itemId, "Item"));
  const { reorder, target, multiple } = quantities(input, item);
  const exists = (await client.query(`SELECT id FROM tenant.inventory_reorder_rules WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [c.organizationId, warehouse.id, item.id])).rows[0];
  if (exists) fail(`${item.code} already has a reorder rule at ${warehouse.code}: edit it instead.`, "REORDER_RULE_EXISTS", 409, { ruleId: exists.id });
  const row = (await client.query(
    `INSERT INTO tenant.inventory_reorder_rules (organization_id, warehouse_id, item_id, enabled, reorder_level_base_quantity, target_level_base_quantity,
       order_multiple_base_quantity, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
    [c.organizationId, warehouse.id, item.id, input.enabled !== false, reorder, target, multiple, text(input.notes, 2000), c.userId ?? null])).rows[0];
  await event(client, c, { ruleId: row.id, type: "rule.created", summary: `Rule created: reorder at ${reorder}, target ${target}${multiple ? `, multiple ${multiple}` : ""} ${item.base_uom ?? ""}`.trim(),
    newValues: configOf(row) });
  return getReorderRule(client, c, row.id);
}

// input: { reorderLevel?, targetLevel?, orderMultiple? (null clears), notes?, enabled?, expectedVersion? }
export async function updateReorderRule(client, c, ruleId, input = {}) {
  const current = await lockRule(client, c, ruleId);
  const touchesConfig = ["reorderLevel", "targetLevel", "orderMultiple", "notes"].some((key) => input[key] !== undefined);
  if (touchesConfig) need(c, P.edit, "You do not have permission to edit reorder rules.");
  if (input.enabled !== undefined && Boolean(input.enabled) !== current.enabled) need(c, P.disable, "You do not have permission to enable or disable reorder rules.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== current.version)
    fail("This rule was changed by someone else. Reload it and try again.", "REORDER_RULE_STALE", 409);
  const item = await stockItem(client, c, current.item_id);
  const { reorder, target, multiple } = quantities({ ...input, orderMultiple: input.orderMultiple === undefined ? undefined : input.orderMultiple ?? "" }, item, current);
  const enabled = input.enabled === undefined ? current.enabled : Boolean(input.enabled);
  const notes = input.notes === undefined ? current.notes : text(input.notes, 2000);
  await alertAction(client, c, current.id, { type: "rule_updated", notes: "The reorder rule was changed" });
  const row = (await client.query(
    `UPDATE tenant.inventory_reorder_rules SET enabled = $3, reorder_level_base_quantity = $4, target_level_base_quantity = $5, order_multiple_base_quantity = $6, notes = $7,
            updated_by = $8, updated_at = now(), version = version + 1
      WHERE organization_id = $1 AND id = $2 RETURNING *`, [c.organizationId, current.id, enabled, reorder, target, multiple, notes, c.userId ?? null])).rows[0];
  const before = configOf(current);
  const after = configOf(row);
  const changed = Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (changed.length) {
    const type = changed.length === 1 && changed[0] === "enabled" ? (enabled ? "rule.enabled" : "rule.disabled") : "rule.updated";
    const labels = { enabled: "enabled", reorderLevel: "reorder level", targetLevel: "target", orderMultiple: "order multiple", notes: "notes" };
    await event(client, c, { ruleId: row.id, type, summary: type === "rule.updated" ? `Changed: ${changed.map((key) => labels[key]).join(", ")}` : enabled ? "Rule enabled" : "Rule disabled",
      oldValues: Object.fromEntries(changed.map((key) => [key, before[key]])), newValues: Object.fromEntries(changed.map((key) => [key, after[key]])) });
  }
  return getReorderRule(client, c, row.id);
}
export const enableReorderRule = (client, c, ruleId) => updateReorderRule(client, c, ruleId, { enabled: true });
export const disableReorderRule = (client, c, ruleId) => updateReorderRule(client, c, ruleId, { enabled: false });

async function lockRule(client, c, ruleId) {
  const row = (await client.query(`SELECT * FROM tenant.inventory_reorder_rules WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(ruleId, "Reorder rule")])).rows[0];
  if (!row) fail("Reorder rule not found.", "REORDER_RULE_NOT_FOUND", 404);
  const visible = await warehouses(client, c);
  if (visible && !visible.includes(row.warehouse_id)) fail("Reorder rule not found.", "REORDER_RULE_NOT_FOUND", 404);
  return row;
}

// ---------------------------------------------------------------- reading
const LIST_FROM = `
    FROM tenant.inventory_reorder_rules rule
    JOIN tenant.items item ON item.organization_id = rule.organization_id AND item.id = rule.item_id
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = rule.organization_id AND warehouse.id = rule.warehouse_id
    LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
    LEFT JOIN tenant.inventory_reorder_status status ON status.rule_id = rule.id
    LEFT JOIN tenant.inventory_replenishment_recommendations recommendation ON recommendation.rule_id = rule.id AND recommendation.status <> 'resolved'`;
const LIST_COLUMNS = `rule.*, item.code AS sku, item.name AS item_name, item.tracking_type, uom.code AS base_uom, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
    status.eligible_on_hand, status.sales_demand, status.transfer_demand, status.firm_open_demand, status.current_planning_position, status.purchase_incoming,
    status.transfer_incoming, status.firm_incoming, status.projected_position, status.raw_suggested_base_quantity, status.suggested_base_quantity, status.status,
    status.out_of_stock, status.earliest_incoming_date, status.overdue_incoming, status.calculated_at,
    recommendation.id AS recommendation_id, recommendation.status AS recommendation_status, recommendation.action_document_type, recommendation.action_document_id,
    recommendation.action_document_number, recommendation.actioned_at, recommendation.dismissed_at, recommendation.dismiss_reason`;

function toRule(row) {
  const status = row.status ?? (row.enabled ? "ok" : "disabled");
  return {
    id: row.id, version: row.version, enabled: row.enabled, notes: row.notes ?? null,
    itemId: row.item_id, sku: row.sku, itemName: row.item_name, trackingType: row.tracking_type, baseUom: row.base_uom,
    warehouseId: row.warehouse_id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name,
    reorderLevel: n(row.reorder_level_base_quantity), targetLevel: n(row.target_level_base_quantity), orderMultiple: n(row.order_multiple_base_quantity),
    eligibleOnHand: n(row.eligible_on_hand ?? 0), salesDemand: n(row.sales_demand ?? 0), transferDemand: n(row.transfer_demand ?? 0), firmDemand: n(row.firm_open_demand ?? 0),
    currentPosition: n(row.current_planning_position ?? 0), purchaseIncoming: n(row.purchase_incoming ?? 0), transferIncoming: n(row.transfer_incoming ?? 0),
    firmIncoming: n(row.firm_incoming ?? 0), projectedPosition: n(row.projected_position ?? 0), rawSuggested: n(row.raw_suggested_base_quantity ?? 0),
    suggested: n(row.suggested_base_quantity ?? 0), status, statusLabel: STATUS_LABEL[status], outOfStock: Boolean(row.out_of_stock),
    nextIncoming: row.earliest_incoming_date ?? null, overdueIncoming: Boolean(row.overdue_incoming), calculatedAt: row.calculated_at ?? null,
    recommendation: row.recommendation_id ? { id: row.recommendation_id, status: row.recommendation_status, actionType: row.action_document_type,
      actionId: row.action_document_id, actionNumber: row.action_document_number, actionHref: actionHref(row.action_document_type, row.action_document_id),
      actionedAt: row.actioned_at, dismissedAt: row.dismissed_at, dismissReason: row.dismiss_reason } : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
const actionHref = (type, id) => (!id ? null : type === "purchase_order" ? `/procurement/purchase-orders/${id}` : `/inventory/transfers/${id}`);

// filters: view (required | covered | below | all | ok | disabled), warehouseId, itemId, categoryId, search, overdue (true), limit, offset.
// required = reorder required or out of stock; covered = below reorder, covered by incoming; below = either.
export async function getReorderRules(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view reorder levels.");
  const view = filters.view || "all";
  if (["required", "covered", "below"].includes(view)) need(c, P.viewRequirements, "You do not have permission to view replenishment requirements.");
  const visible = await warehouses(client, c);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["rule.organization_id = $1"];
  if (visible) where.push(`rule.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  const warehouseId = uuidOrNull(filters.warehouseId, "Warehouse");
  if (warehouseId) {
    if (visible && !visible.includes(warehouseId)) fail("You do not have access to that warehouse.", "REORDER_WAREHOUSE_FORBIDDEN", 403);
    where.push(`rule.warehouse_id = ${bind(warehouseId)}`);
  }
  const itemId = uuidOrNull(filters.itemId, "Item");
  if (itemId) where.push(`rule.item_id = ${bind(itemId)}`);
  const categoryId = uuidOrNull(filters.categoryId, "Category");
  if (categoryId) where.push(`item.group_id = ${bind(categoryId)}`);
  const search = text(filters.search, 120);
  if (search) where.push(`lower(concat_ws(' ', item.code, item.name, item.barcode, warehouse.code, warehouse.name)) LIKE ${bind(`%${search.toLowerCase()}%`)}`);
  if (view === "required") where.push("rule.enabled AND status.status IN ('reorder_required', 'out_of_stock')");
  else if (view === "covered") where.push("rule.enabled AND status.status = 'below_reorder_covered'");
  else if (view === "below") where.push("rule.enabled AND status.status IN ('reorder_required', 'out_of_stock', 'below_reorder_covered')");
  else if (view === "ok") where.push("rule.enabled AND status.status = 'ok'");
  else if (view === "disabled") where.push("NOT rule.enabled");
  else if (view !== "all") fail("Unknown view.", "REORDER_INVALID");
  if (String(filters.overdue) === "true") where.push("status.overdue_incoming");
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const { rows } = await client.query(
    `SELECT ${LIST_COLUMNS}, count(*) OVER () AS total ${LIST_FROM} WHERE ${where.join(" AND ")}
      ORDER BY CASE status.status WHEN 'out_of_stock' THEN 0 WHEN 'reorder_required' THEN 1 WHEN 'below_reorder_covered' THEN 2 WHEN 'ok' THEN 3 ELSE 4 END,
               status.suggested_base_quantity DESC NULLS LAST, item.code, warehouse.code
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values);
  const counts = (await client.query(
    `SELECT count(*) FILTER (WHERE rule.enabled AND status.status IN ('reorder_required', 'out_of_stock')) AS required,
            count(*) FILTER (WHERE rule.enabled AND status.status = 'below_reorder_covered') AS covered, count(*) FILTER (WHERE rule.enabled AND status.status = 'out_of_stock') AS out_of_stock,
            count(*) AS rules
       FROM tenant.inventory_reorder_rules rule LEFT JOIN tenant.inventory_reorder_status status ON status.rule_id = rule.id
      WHERE rule.organization_id = $1 ${visible ? "AND rule.warehouse_id = ANY($2::uuid[])" : ""}`, visible ? [c.organizationId, visible] : [c.organizationId])).rows[0];
  return {
    rows: rows.map(toRule), total: Number(rows[0]?.total ?? 0),
    counts: { required: Number(counts.required), covered: Number(counts.covered), outOfStock: Number(counts.out_of_stock), rules: Number(counts.rules) },
    capabilities: capabilities(c),
  };
}
export const getReorderRequirements = (client, c, filters = {}) => getReorderRules(client, c, { ...filters, view: "required" });
export const getReorderCoveredByIncoming = (client, c, filters = {}) => getReorderRules(client, c, { ...filters, view: "covered" });
export const getItemsBelowReorder = (client, c, filters = {}) => getReorderRules(client, c, { ...filters, view: "below" });

const capabilities = (c) => ({
  create: can(c, P.create), edit: can(c, P.edit), disable: can(c, P.disable), import: can(c, P.import), export: can(c, P.export), dismiss: can(c, P.dismiss),
  viewDemand: can(c, P.viewDemand), viewIncoming: can(c, P.viewIncoming), viewOtherStock: can(c, P.viewOtherStock),
  purchaseDraft: can(c, P.createPurchaseDraft), transferDraft: can(c, P.createTransferDraft), viewRequirements: can(c, P.viewRequirements),
});

// One rule, recalculated now from the sources, with what explains it: the demand and incoming documents, other warehouses' available stock,
// the preferred supplier and its lead time (from Procurement), the live recommendation and the history.
export async function getReorderRule(client, c, ruleId) {
  need(c, P.view, "You do not have permission to view reorder levels.");
  const rule = await lockRule(client, c, ruleId);
  await client.query(`SELECT tenant.refresh_reorder_rule($1)`, [rule.id]);
  const row = (await client.query(`SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE rule.organization_id = $1 AND rule.id = $2`, [c.organizationId, rule.id])).rows[0];
  const history = (await client.query(
    `SELECT event.event_type, event.summary, event.old_values, event.new_values, event.created_at, actor.full_name FROM tenant.inventory_reorder_events event
       LEFT JOIN public.users actor ON actor.id = event.actor_user_id WHERE event.organization_id = $1 AND event.rule_id = $2 ORDER BY event.created_at DESC LIMIT 100`,
    [c.organizationId, rule.id])).rows.map((entry) => ({ type: entry.event_type, summary: entry.summary, oldValues: entry.old_values, newValues: entry.new_values,
    at: entry.created_at, by: entry.full_name ?? (entry.event_type.startsWith("recommendation.") && !entry.full_name ? "System" : null) }));
  return {
    rule: toRule(row),
    demand: can(c, P.viewDemand) ? await getReorderDemandBreakdown(client, c, rule.item_id, rule.warehouse_id) : null,
    incoming: can(c, P.viewIncoming) ? await getReorderIncomingBreakdown(client, c, rule.item_id, rule.warehouse_id) : null,
    otherWarehouses: can(c, P.viewOtherStock) ? await getOtherWarehouseAvailability(client, c, rule.item_id, rule.warehouse_id) : null,
    supplier: can(c, P.createPurchaseDraft) ? await preferredSupplier(client, c, rule.item_id) : null,
    history, capabilities: capabilities(c),
  };
}

// The firm open demand, document by document: confirmed sales orders still to ship, confirmed transfers out not yet dispatched.
export async function getReorderDemandBreakdown(client, c, itemId, warehouseId) {
  need(c, P.viewDemand, "You do not have permission to view replenishment demand.");
  const sales = (await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number AS number, sales_order.lifecycle_status, line.requested_delivery_date AS date,
            greatest((progress.confirmed_quantity - progress.cancelled_quantity) * COALESCE(NULLIF(line.conversion_factor, 0), 1)
              - COALESCE((SELECT sum(shipped.base_quantity) FROM tenant.sales_delivery_lines shipped JOIN tenant.sales_fulfillment_requests delivery
                  ON delivery.organization_id = shipped.organization_id AND delivery.id = shipped.delivery_id
                 WHERE shipped.organization_id = line.organization_id AND shipped.sales_order_line_id = line.id AND shipped.stock_issued AND delivery.delivery_status <> 'cancelled'), 0), 0) AS quantity,
            (SELECT COALESCE(sum(reservation.active_quantity), 0) FROM tenant.stock_reservations reservation WHERE reservation.organization_id = line.organization_id
               AND reservation.sales_order_line_id = line.id AND reservation.status = 'active') AS reserved
       FROM tenant.sales_order_line_progress progress
       JOIN tenant.sales_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.sales_order_line_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = line.organization_id AND sales_order.current_version_id = line.sales_order_version_id
      WHERE progress.organization_id = $1 AND line.item_id = $2 AND COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id) = $3
        AND sales_order.lifecycle_status IN ('confirmed', 'on_hold') ORDER BY line.requested_delivery_date NULLS LAST, sales_order.sales_order_number`,
    [c.organizationId, itemId, warehouseId])).rows.filter((row) => Number(row.quantity) > 0);
  const transfers = (await client.query(
    `SELECT transfer.id, transfer.document_number AS number, destination.code AS destination, transfer.transfer_date AS date, sum(line.base_quantity) AS quantity
       FROM tenant.inventory_transfers transfer JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
       JOIN tenant.warehouses destination ON destination.organization_id = transfer.organization_id AND destination.id = transfer.destination_warehouse_id
      WHERE transfer.organization_id = $1 AND line.item_id = $2 AND transfer.source_warehouse_id = $3 AND transfer.transfer_type = 'warehouse' AND transfer.status = 'confirmed'
      GROUP BY transfer.id, destination.code ORDER BY transfer.transfer_date`, [c.organizationId, itemId, warehouseId])).rows;
  return [
    ...sales.map((row) => ({ kind: "sales_order", id: row.id, number: row.number, status: row.lifecycle_status, date: row.date, quantity: n(row.quantity),
      reserved: n(row.reserved), href: `/sales/orders/${row.id}` })),
    ...transfers.map((row) => ({ kind: "transfer_out", id: row.id, number: row.number, status: "confirmed", date: row.date, quantity: n(row.quantity), destination: row.destination,
      href: `/inventory/transfers/${row.id}` })),
  ];
}

// The firm incoming, document by document, with its expected date (overdue when it has passed and the goods are still not here).
export async function getReorderIncomingBreakdown(client, c, itemId, warehouseId) {
  need(c, P.viewIncoming, "You do not have permission to view replenishment incoming.");
  const today = (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const purchases = (await client.query(
    `SELECT purchase_order.id, purchase_order.purchase_order_number AS number, COALESCE(line.expected_delivery_date, purchase_order.expected_delivery_date) AS expected,
            party.display_name AS supplier, sum(progress.remaining_to_receive * line.conversion_factor) AS quantity
       FROM tenant.purchase_order_line_status progress
       JOIN tenant.purchase_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.purchase_order_line_id
       JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = purchase_order.organization_id AND party.id = purchase_order.party_id
      WHERE progress.organization_id = $1 AND line.product_id = $2 AND COALESCE(line.receiving_warehouse_id, purchase_order.default_warehouse_id) = $3
        AND purchase_order.status = 'confirmed' AND progress.remaining_to_receive > 0
      GROUP BY purchase_order.id, party.display_name, COALESCE(line.expected_delivery_date, purchase_order.expected_delivery_date) ORDER BY expected NULLS LAST`,
    [c.organizationId, itemId, warehouseId])).rows;
  const transfers = (await client.query(
    `SELECT transfer.id, transfer.document_number AS number, transfer.status, source.code AS source, transfer.expected_arrival_date AS expected,
            sum(CASE WHEN transfer.status = 'confirmed' THEN line.base_quantity ELSE greatest(line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity, 0) END) AS quantity
       FROM tenant.inventory_transfers transfer JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
       JOIN tenant.warehouses source ON source.organization_id = transfer.organization_id AND source.id = transfer.source_warehouse_id
      WHERE transfer.organization_id = $1 AND line.item_id = $2 AND transfer.destination_warehouse_id = $3 AND transfer.transfer_type = 'warehouse'
        AND transfer.status IN ('confirmed', 'dispatched', 'partially_received')
      GROUP BY transfer.id, source.code ORDER BY transfer.expected_arrival_date NULLS LAST`, [c.organizationId, itemId, warehouseId])).rows.filter((row) => Number(row.quantity) > 0);
  const overdue = (date) => Boolean(date) && String(date instanceof Date ? date.toISOString().slice(0, 10) : date).slice(0, 10) < today;
  return [
    ...purchases.map((row) => ({ kind: "purchase_order", id: row.id, number: row.number, supplier: row.supplier, expected: row.expected, overdue: overdue(row.expected),
      quantity: n(row.quantity), href: `/procurement/purchase-orders/${row.id}` })),
    ...transfers.map((row) => ({ kind: row.status === "confirmed" ? "transfer_in" : "in_transit", id: row.id, number: row.number, source: row.source, expected: row.expected,
      overdue: overdue(row.expected), quantity: n(row.quantity), href: `/inventory/transfers/${row.id}` })),
  ];
}

// What other warehouses could send (advisory): their available stock — eligible on hand less what is reserved there.
export async function getOtherWarehouseAvailability(client, c, itemId, warehouseId) {
  need(c, P.viewOtherStock, "You do not have permission to view other warehouses' stock.");
  const visible = await warehouses(client, c);
  const { rows } = await client.query(
    `SELECT warehouse.id, warehouse.code, warehouse.name, COALESCE(sum(balance.quantity) FILTER (WHERE NOT ${restrictedStockSql("location", "batch")}), 0) AS eligible,
            COALESCE(sum(greatest(balance.quantity - balance.reserved_quantity, 0)) FILTER (WHERE NOT ${restrictedStockSql("location", "batch")}), 0) AS available
       FROM tenant.stock_balances balance
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND balance.item_id = $2 AND balance.warehouse_id <> $3 AND warehouse.system_role IS NULL AND warehouse.status = 'active'
        AND ($4::uuid[] IS NULL OR warehouse.id = ANY($4::uuid[]))
      GROUP BY warehouse.id HAVING COALESCE(sum(greatest(balance.quantity - balance.reserved_quantity, 0)) FILTER (WHERE NOT ${restrictedStockSql("location", "batch")}), 0) > 0
      ORDER BY available DESC`, [c.organizationId, itemId, warehouseId, visible]);
  return rows.map((row) => ({ warehouseId: row.id, warehouse: row.code, warehouseName: row.name, eligible: n(row.eligible), available: n(row.available) }));
}

// The supplier Procurement would buy from: an active supplier price for the item (the latest valid one), else the supplier of its latest
// purchase order; with its lead time and price. Nothing is copied onto the rule.
async function preferredSupplier(client, c, itemId) {
  const priced = (await client.query(
    `SELECT price.supplier_id, price.rate, price.uom_id, price.currency_code, price.minimum_quantity FROM tenant.procurement_supplier_prices price
      WHERE price.organization_id = $1 AND price.item_id = $2 AND price.status = 'active' AND (price.valid_from IS NULL OR price.valid_from <= current_date)
        AND (price.valid_to IS NULL OR price.valid_to >= current_date) ORDER BY price.valid_from DESC NULLS LAST, price.created_at DESC LIMIT 1`, [c.organizationId, itemId])).rows[0];
  const last = priced ? null : (await client.query(
    `SELECT purchase_order.supplier_id, line.unit_price AS rate, line.purchase_uom_id AS uom_id, purchase_order.currency_code FROM tenant.purchase_order_lines line
       JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
      WHERE line.organization_id = $1 AND line.product_id = $2 AND purchase_order.status IN ('confirmed', 'closed') ORDER BY purchase_order.order_date DESC, purchase_order.created_at DESC LIMIT 1`,
    [c.organizationId, itemId])).rows[0];
  const source = priced ?? last;
  if (!source?.supplier_id) return null;
  const supplier = (await client.query(
    `SELECT supplier.id, supplier.supplier_number, party.display_name AS name FROM tenant.procurement_suppliers supplier
       LEFT JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id WHERE supplier.organization_id = $1 AND supplier.id = $2`,
    [c.organizationId, source.supplier_id])).rows[0];
  const lead = (await client.query(
    `SELECT lead_time_days FROM tenant.procurement_supplier_lead_times WHERE organization_id = $1 AND supplier_id = $2 AND item_id = $3 AND status = 'active'
        AND (effective_from IS NULL OR effective_from <= current_date) AND (effective_to IS NULL OR effective_to >= current_date) ORDER BY effective_from DESC NULLS LAST LIMIT 1`,
    [c.organizationId, source.supplier_id, itemId]).catch(() => ({ rows: [] }))).rows[0];
  const uom = source.uom_id ? (await client.query(`SELECT code FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2`, [c.organizationId, source.uom_id])).rows[0] : null;
  return { supplierId: supplier?.id ?? source.supplier_id, number: supplier?.supplier_number ?? null, name: supplier?.name ?? null, source: priced ? "supplier_price" : "last_purchase",
    unitPrice: source.rate === null || source.rate === undefined ? null : String(source.rate), priceUomId: source.uom_id ?? null, priceUom: uom?.code ?? null,
    currencyCode: source.currency_code?.trim?.() ?? null, leadTimeDays: lead?.lead_time_days ?? null };
}

// The planning position of any item at a warehouse (with or without a rule), from the one database definition.
export async function calculateReorderStatus(client, c, ruleId) {
  need(c, P.view, "You do not have permission to view reorder levels.");
  const rule = await lockRule(client, c, ruleId);
  const status = (await client.query(`SELECT tenant.refresh_reorder_rule($1) AS status`, [rule.id])).rows[0].status;
  return { ruleId: rule.id, status };
}
async function position(client, c, itemId, warehouseId) {
  need(c, P.view, "You do not have permission to view reorder levels.");
  await assertWarehouse(client, c, uuid(warehouseId, "Warehouse"));
  const row = (await client.query(`SELECT * FROM tenant.reorder_planning_position($1, $2, $3)`, [c.organizationId, uuid(itemId, "Item"), warehouseId])).rows[0];
  const demand = Number(row.sales_demand) + Number(row.transfer_demand);
  const incoming = Number(row.purchase_incoming) + Number(row.transfer_incoming);
  return { eligibleOnHand: n(row.eligible_on_hand), salesDemand: n(row.sales_demand), transferDemand: n(row.transfer_demand), firmDemand: n(demand),
    currentPosition: n(Number(row.eligible_on_hand) - demand), purchaseIncoming: n(row.purchase_incoming), transferIncoming: n(row.transfer_incoming), firmIncoming: n(incoming),
    projectedPosition: n(Number(row.eligible_on_hand) - demand + incoming), nextIncoming: row.earliest_incoming ?? null, overdueIncoming: Boolean(row.overdue) };
}
export const calculateCurrentPlanningPosition = async (client, c, itemId, warehouseId) => (await position(client, c, itemId, warehouseId)).currentPosition;
export const calculateFirmOpenDemand = async (client, c, itemId, warehouseId) => (await position(client, c, itemId, warehouseId)).firmDemand;
export const calculateFirmIncoming = async (client, c, itemId, warehouseId) => (await position(client, c, itemId, warehouseId)).firmIncoming;
export const getPlanningPosition = position;

// ---------------------------------------------------------------- actions
// The recommendation an action works from, recalculated first (never a stale screen quantity).
async function actionable(client, c, ruleId) {
  const rule = await lockRule(client, c, ruleId);
  if (!rule.enabled) fail("This rule is disabled: enable it to replenish from it.", "REORDER_RULE_DISABLED", 409);
  await client.query(`SELECT tenant.refresh_reorder_rule($1)`, [rule.id]);
  const row = (await client.query(`SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE rule.organization_id = $1 AND rule.id = $2`, [c.organizationId, rule.id])).rows[0];
  return { rule, row: toRule(row) };
}
function quantityFor(row, input) {
  if (input.quantity === undefined || input.quantity === null || input.quantity === "") {
    if (!(row.suggested > 0)) fail("No additional replenishment is required now: enter the quantity to replenish anyway.", "REORDER_NOTHING_TO_REPLENISH", 409);
    return row.suggested;
  }
  const value = Number(input.quantity);
  if (!Number.isFinite(value) || value <= 0) fail("The quantity must be more than zero.", "REORDER_QUANTITY_INVALID");
  if (row.trackingType === "serial" && !Number.isInteger(value)) fail("Serial-numbered items are replenished in whole units.", "REORDER_QUANTITY_PRECISION");
  return value;
}
// What was done is also recorded on the rule's live low-stock alert (its action history), never resolving it.
async function alertAction(client, c, ruleId, { type, documentType = null, documentId = null, documentNumber = null, quantity = null, notes = null }) {
  const live = (await client.query(`SELECT id FROM tenant.inventory_low_stock_alerts WHERE organization_id = $1 AND rule_id = $2 AND status <> 'resolved'`, [c.organizationId, ruleId])).rows[0];
  if (!live) return;
  await client.query(
    `INSERT INTO tenant.inventory_low_stock_alert_actions (organization_id, alert_id, action_type, document_type, document_id, document_number, base_quantity, notes, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [c.organizationId, live.id, type, documentType, documentId, documentNumber, quantity, notes, c.userId ?? null]);
}

async function markActioned(client, c, ruleId, type, document) {
  const live = (await client.query(`SELECT id FROM tenant.inventory_replenishment_recommendations WHERE organization_id = $1 AND rule_id = $2 AND status <> 'resolved' FOR UPDATE`,
    [c.organizationId, ruleId])).rows[0];
  if (live) await client.query(
    `UPDATE tenant.inventory_replenishment_recommendations SET status = 'actioned', action_document_type = $3, action_document_id = $4, action_document_number = $5, actioned_at = now(),
            actioned_by = $6, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, live.id, type, document.id, document.number, c.userId ?? null]);
  await event(client, c, { ruleId, recommendationId: live?.id ?? null, type: type === "purchase_order" ? "purchase_draft.created" : "transfer_draft.created",
    summary: `${type === "purchase_order" ? "Draft purchase order" : "Draft transfer"} ${document.number ?? ""} opened for ${document.quantity}`.replace("  ", " "),
    details: { documentId: document.id, documentNumber: document.number, quantity: document.quantity } });
  if (live) await event(client, c, { ruleId, recommendationId: live.id, type: "recommendation.actioned", summary: `Actioned with ${document.number ?? "a draft"}` });
  await alertAction(client, c, ruleId, { type: type === "purchase_order" ? "purchase_draft_created" : "transfer_draft_created", documentType: type, documentId: document.id,
    documentNumber: document.number ?? null, quantity: document.baseQuantity ?? null });
}

// Opens a draft purchase order for the requirement: the warehouse, the item, the suggested quantity (recalculated now, or the quantity given),
// in the purchase unit when it converts exactly, from the supplier given or the preferred one, at the price given or the supplier's price.
// It stays a draft — incoming only once Procurement confirms it. A retried request (same idempotencyKey) opens one draft.
// input: { supplierId?, quantity? (base), unitPrice?, idempotencyKey }
export async function createPurchaseDraftFromReorder(client, c, ruleId, input = {}) {
  need(c, P.createPurchaseDraft, "You do not have permission to create purchase drafts from replenishment.");
  const key = text(input.idempotencyKey, 200);
  if (!key) fail("A request key is required (it prevents a double click from opening two drafts).", "REORDER_IDEMPOTENCY_REQUIRED");
  const idempotency = await beginIdempotentOperation(client, c, { operation: "stock.reorder.purchase_draft", key, payload: { ruleId, ...input, idempotencyKey: undefined } });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const { rule, row } = await actionable(client, c, ruleId);
  const base = quantityFor(row, input);
  const preferred = await preferredSupplier(client, c, rule.item_id);
  const supplierId = uuidOrNull(input.supplierId, "Supplier") ?? preferred?.supplierId;
  if (!supplierId) fail("Choose the supplier: Procurement has no price or earlier order for this item.", "REORDER_SUPPLIER_REQUIRED");
  const item = await stockItem(client, c, rule.item_id);
  // The purchase unit when the quantity converts into it exactly (400 PCS = 20 BOX), else the base unit.
  let uomId = item.uom_id;
  let quantity = base;
  if (item.purchase_uom_id && item.purchase_uom_id !== item.uom_id) {
    const factor = Number((await client.query(
      `SELECT conversion_factor FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = $2 AND from_uom_id = $3 AND to_uom_id = $4 AND status = 'active'`,
      [c.organizationId, item.id, item.purchase_uom_id, item.uom_id])).rows[0]?.conversion_factor ?? 0);
    if (factor > 0 && Math.abs(base / factor - Math.round(base / factor)) < 1e-9) { uomId = item.purchase_uom_id; quantity = Math.round(base / factor); }
  }
  const samePrice = preferred && preferred.supplierId === supplierId && (!preferred.priceUomId || preferred.priceUomId === uomId);
  const unitPrice = input.unitPrice !== undefined && input.unitPrice !== null && input.unitPrice !== "" ? String(input.unitPrice) : samePrice ? preferred.unitPrice : null;
  if (unitPrice === null) fail("Enter the purchase price: Procurement has no price for this supplier and unit.", "REORDER_PRICE_REQUIRED");
  const order = await createPurchaseOrder(client, c, {
    supplierId, defaultWarehouseId: rule.warehouse_id, idempotencyKey: `reorder:${key}`,
    internalNotes: `Replenishment for ${row.sku} at ${row.warehouse}: projected ${row.projectedPosition}, target ${row.targetLevel} ${row.baseUom ?? ""}`.trim(),
    lines: [{ productId: rule.item_id, quantity: String(quantity), uomId, unitPrice, warehouseId: rule.warehouse_id }],
  });
  await markActioned(client, c, rule.id, "purchase_order", { id: order.id, number: order.purchaseOrderNumber, baseQuantity: base, quantity: `${quantity}${uomId === item.uom_id ? ` ${item.base_uom ?? ""}` : ""}`.trim() });
  const response = { purchaseOrderId: order.id, purchaseOrderNumber: order.purchaseOrderNumber, quantity, uomId, baseQuantity: base, href: `/procurement/purchase-orders/${order.id}`,
    warnings: order.warnings ?? [], replayed: false };
  await completeIdempotentOperation(client, c, idempotency, { response, aggregateType: "inventory_reorder_rule", aggregateId: rule.id });
  return response;
}

// Opens a draft internal transfer into the rule's warehouse from the source chosen. The transfer's own confirmation reserves and moves.
// input: { sourceWarehouseId, quantity? (base), idempotencyKey }
export async function createTransferDraftFromReorder(client, c, ruleId, input = {}) {
  need(c, P.createTransferDraft, "You do not have permission to create transfer drafts from replenishment.");
  const key = text(input.idempotencyKey, 200);
  if (!key) fail("A request key is required (it prevents a double click from opening two drafts).", "REORDER_IDEMPOTENCY_REQUIRED");
  const idempotency = await beginIdempotentOperation(client, c, { operation: "stock.reorder.transfer_draft", key, payload: { ruleId, ...input, idempotencyKey: undefined } });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const { rule, row } = await actionable(client, c, ruleId);
  const source = await assertWarehouse(client, c, uuid(input.sourceWarehouseId, "Source warehouse"));
  if (source.id === rule.warehouse_id) fail("Choose another warehouse to transfer from.", "REORDER_SOURCE_INVALID");
  const quantity = quantityFor(row, input);
  const made = await createInventoryTransfer(client, c, {
    sourceWarehouseId: source.id, destinationWarehouseId: rule.warehouse_id, transferMode: "in_transit", idempotencyKey: `reorder:${key}`,
    notes: `Replenishment for ${row.sku} at ${row.warehouse} (projected ${row.projectedPosition}, target ${row.targetLevel})`,
    lines: [{ itemId: rule.item_id, quantity: String(quantity) }],
  });
  await markActioned(client, c, rule.id, "inventory_transfer", { id: made.transfer.id, number: made.transfer.number ?? made.transfer.documentNumber, baseQuantity: quantity, quantity: `${quantity} ${row.baseUom ?? ""}`.trim() });
  const response = { transferId: made.transfer.id, transferNumber: made.transfer.number ?? made.transfer.documentNumber ?? null, quantity, href: `/inventory/transfers/${made.transfer.id}`, replayed: false };
  await completeIdempotentOperation(client, c, idempotency, { response, aggregateType: "inventory_reorder_rule", aggregateId: rule.id });
  return response;
}

// Dismisses the live recommendation. Stock and the rule are untouched, and the item still shows below reorder while it is.
export async function dismissReplenishmentRecommendation(client, c, ruleId, input = {}) {
  need(c, P.dismiss, "You do not have permission to dismiss replenishment recommendations.");
  const rule = await lockRule(client, c, ruleId);
  const reason = text(input.reason, 1000);
  if (!reason) fail("Say why the recommendation is dismissed.", "REORDER_REASON_REQUIRED");
  const live = (await client.query(`SELECT id, status FROM tenant.inventory_replenishment_recommendations WHERE organization_id = $1 AND rule_id = $2 AND status <> 'resolved' FOR UPDATE`,
    [c.organizationId, rule.id])).rows[0];
  if (!live) fail("There is no open recommendation for this rule.", "REORDER_NO_RECOMMENDATION", 409);
  if (live.status === "dismissed") return getReorderRule(client, c, rule.id);
  await client.query(`UPDATE tenant.inventory_replenishment_recommendations SET status = 'dismissed', dismissed_at = now(), dismissed_by = $3, dismiss_reason = $4, updated_at = now(),
      version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, live.id, c.userId ?? null, reason]);
  await event(client, c, { ruleId: rule.id, recommendationId: live.id, type: "recommendation.dismissed", summary: `Dismissed: ${reason}` });
  return getReorderRule(client, c, rule.id);
}

// ---------------------------------------------------------------- recalculation and reconciliation
// The rules of the item / warehouse pairs a change touched (the database triggers do this on every source change; callers may too).
export async function recalculateAffectedReorderRules(client, c, pairs = []) {
  let count = 0;
  for (const pair of pairs) {
    await client.query(`SELECT tenant.refresh_reorder_position($1, $2, $3)`, [c.organizationId, pair.itemId, pair.warehouseId]);
    count += 1;
  }
  return { recalculated: count };
}

// The periodic proof that the projection is the sources: every rule recalculated; any rule whose stored status differed is reported.
export async function reconcileReorderStatusProjection(client, c, { recordRun = true } = {}) {
  const rules = (await client.query(
    `SELECT rule.id, status.eligible_on_hand, status.firm_open_demand, status.firm_incoming, status.suggested_base_quantity, status.status
       FROM tenant.inventory_reorder_rules rule LEFT JOIN tenant.inventory_reorder_status status ON status.rule_id = rule.id WHERE rule.organization_id = $1`, [c.organizationId])).rows;
  const differences = [];
  for (const before of rules) {
    await client.query(`SELECT tenant.refresh_reorder_rule($1)`, [before.id]);
    const after = (await client.query(`SELECT eligible_on_hand, firm_open_demand, firm_incoming, suggested_base_quantity, status FROM tenant.inventory_reorder_status WHERE rule_id = $1`, [before.id])).rows[0];
    const same = before.status === after.status && ["eligible_on_hand", "firm_open_demand", "firm_incoming", "suggested_base_quantity"].every((key) => Math.abs(Number(before[key] ?? 0) - Number(after[key])) < 1e-6);
    if (!same) differences.push({ ruleId: before.id, before: { status: before.status ?? null, suggested: n(before.suggested_base_quantity) }, after: { status: after.status, suggested: n(after.suggested_base_quantity) } });
  }
  if (recordRun && differences.length)
    await event(client, c, { type: "projection.reconciled", summary: `${differences.length} reorder status${differences.length === 1 ? "" : "es"} corrected by reconciliation`, details: { differences: differences.slice(0, 50) } });
  return { rules: rules.length, differences, consistent: differences.length === 0 };
}

// ---------------------------------------------------------------- bulk configuration
const IMPORT_COLUMNS = Object.freeze([
  { key: "sku", label: "SKU" }, { key: "warehouse", label: "Warehouse Code" }, { key: "enabled", label: "Enabled" }, { key: "reorderLevel", label: "Reorder Level" },
  { key: "targetLevel", label: "Target Stock Level" }, { key: "orderMultiple", label: "Order Multiple" },
]);
export async function exportReorderRules(client, c, filters = {}, format = "csv") {
  need(c, P.export, "You do not have permission to export replenishment data.");
  const data = (await getReorderRules(client, c, { ...filters, limit: 1000 })).rows;
  const columns = [...IMPORT_COLUMNS, { key: "item", label: "Item" }, { key: "baseUom", label: "Base UOM" }, { key: "eligible", label: "Eligible On Hand" },
    { key: "demand", label: "Firm Demand" }, { key: "current", label: "Current Position" }, { key: "incoming", label: "Firm Incoming" }, { key: "projected", label: "Projected Position" },
    { key: "suggested", label: "Suggested Qty" }, { key: "status", label: "Status" }, { key: "nextIncoming", label: "Next Incoming" }];
  const rows = data.map((row) => ({ sku: row.sku, warehouse: row.warehouse, enabled: row.enabled ? "Yes" : "No", reorderLevel: row.reorderLevel, targetLevel: row.targetLevel,
    orderMultiple: row.orderMultiple ?? "", item: row.itemName, baseUom: row.baseUom, eligible: row.eligibleOnHand, demand: row.firmDemand, current: row.currentPosition,
    incoming: row.firmIncoming, projected: row.projectedPosition, suggested: row.suggested, status: row.statusLabel, nextIncoming: row.nextIncoming ? String(row.nextIncoming).slice(0, 10) : "" }));
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx") return { fileName: `reorder-rules-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: buildXlsxWorkbook({ sheetName: "Reorder rules", columns, rows }), rowCount: rows.length };
  return { fileName: `reorder-rules-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: rowsToCsv(columns, rows), rowCount: rows.length };
}

// Upload → validate → preview → apply. Every row is checked (SKU, stock item, warehouse, duplicates, quantities); nothing is applied while any
// row has an error. input: { fileName, bytes (Buffer | base64 string), apply? }
export async function importReorderRules(client, c, input = {}) {
  need(c, P.import, "You do not have permission to import reorder rules.");
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(String(input.bytes ?? ""), "base64");
  if (!bytes.length) fail("Choose a CSV or XLSX file.", "REORDER_IMPORT_EMPTY");
  let parsed;
  try {
    parsed = isXlsxFileName(input.fileName ?? "") ? parseXlsxUpload(bytes, { maxRows: 5000 }) : parseCsvUpload(bytes, { maxRows: 5000 });
  } catch (error) {
    fail(error.message || "The file could not be read.", error.code ?? "REORDER_IMPORT_UNREADABLE");
  }
  const header = (parsed.headers ?? []).map((value) => String(value).trim().toLowerCase());
  const at = (labels) => header.findIndex((value) => labels.includes(value));
  const index = { sku: at(["sku", "item code"]), warehouse: at(["warehouse code", "warehouse"]), enabled: at(["enabled"]), reorderLevel: at(["reorder level", "minimum"]),
    targetLevel: at(["target stock level", "target", "maximum"]), orderMultiple: at(["order multiple", "multiple"]) };
  const missing = ["sku", "warehouse", "reorderLevel", "targetLevel"].filter((key) => index[key] < 0);
  if (missing.length) fail(`The file needs the columns ${missing.map((key) => IMPORT_COLUMNS.find((column) => column.key === key).label).join(", ")}.`, "REORDER_IMPORT_COLUMNS");
  const visible = await warehouses(client, c);
  const seen = new Map();
  const rows = [];
  const records = parsed.records ?? [];
  for (let position = 0; position < records.length; position += 1) {
    const record = records[position];
    const cell = (key) => (index[key] < 0 ? "" : String(record[parsed.headers[index[key]]] ?? "").trim());
    const line = position + 2;
    const errors = [];
    const sku = cell("sku");
    const warehouseCode = cell("warehouse");
    const item = sku ? (await client.query(`SELECT id FROM tenant.items WHERE organization_id = $1 AND upper(code) = upper($2)`, [c.organizationId, sku])).rows[0] : null;
    const warehouse = warehouseCode ? (await client.query(`SELECT id, system_role FROM tenant.warehouses WHERE organization_id = $1 AND upper(code) = upper($2)`, [c.organizationId, warehouseCode])).rows[0] : null;
    if (!sku) errors.push("SKU is required."); else if (!item) errors.push(`Unknown SKU ${sku}.`);
    if (!warehouseCode) errors.push("Warehouse code is required.");
    else if (!warehouse || warehouse.system_role) errors.push(`Unknown warehouse ${warehouseCode}.`);
    else if (visible && !visible.includes(warehouse.id)) errors.push(`You do not have access to warehouse ${warehouseCode}.`);
    const enabledText = cell("enabled").toLowerCase();
    if (enabledText && !["yes", "no", "true", "false", "1", "0", "y", "n"].includes(enabledText)) errors.push("Enabled is Yes or No.");
    const enabled = !enabledText || ["yes", "true", "1", "y"].includes(enabledText);
    let values = null;
    let existing = null;
    if (item && warehouse) {
      const pairKey = `${item.id}:${warehouse.id}`;
      if (seen.has(pairKey)) errors.push(`Duplicate of row ${seen.get(pairKey)}: one rule per item and warehouse.`); else seen.set(pairKey, line);
      try {
        const stock = await stockItem(client, c, item.id);
        values = quantities({ reorderLevel: cell("reorderLevel"), targetLevel: cell("targetLevel"), orderMultiple: cell("orderMultiple") || null }, stock);
      } catch (error) { if (error instanceof StockError) errors.push(error.message); else throw error; }
      existing = (await client.query(`SELECT id, version FROM tenant.inventory_reorder_rules WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3`,
        [c.organizationId, item.id, warehouse.id])).rows[0] ?? null;
    }
    rows.push({ line, sku, warehouse: warehouseCode, enabled, reorderLevel: values?.reorder ?? cell("reorderLevel"), targetLevel: values?.target ?? cell("targetLevel"),
      orderMultiple: values?.multiple ?? (cell("orderMultiple") || null), action: errors.length ? "error" : existing ? "update" : "create", errors,
      itemId: item?.id ?? null, warehouseId: warehouse?.id ?? null, ruleId: existing?.id ?? null });
  }
  const invalid = rows.filter((row) => row.errors.length);
  const summary = { rows: rows.length, create: rows.filter((row) => row.action === "create").length, update: rows.filter((row) => row.action === "update").length, errors: invalid.length };
  if (!input.apply || invalid.length) return { applied: false, summary, rows: rows.map(({ itemId, warehouseId, ruleId, ...row }) => row) };
  for (const row of rows) {
    if (row.ruleId) {
      need(c, P.edit, "You do not have permission to edit reorder rules.");
      const before = (await client.query(`SELECT * FROM tenant.inventory_reorder_rules WHERE id = $1`, [row.ruleId])).rows[0];
      const after = (await client.query(
        `UPDATE tenant.inventory_reorder_rules SET enabled = $2, reorder_level_base_quantity = $3, target_level_base_quantity = $4, order_multiple_base_quantity = $5, updated_by = $6,
                updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`, [row.ruleId, row.enabled, row.reorderLevel, row.targetLevel, row.orderMultiple, c.userId ?? null])).rows[0];
      await event(client, c, { ruleId: row.ruleId, type: "rule.bulk_updated", summary: `Updated by import (row ${row.line})`, oldValues: configOf(before), newValues: configOf(after) });
    } else {
      const made = (await client.query(
        `INSERT INTO tenant.inventory_reorder_rules (organization_id, warehouse_id, item_id, enabled, reorder_level_base_quantity, target_level_base_quantity, order_multiple_base_quantity,
           created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
        [c.organizationId, row.warehouseId, row.itemId, row.enabled, row.reorderLevel, row.targetLevel, row.orderMultiple, c.userId ?? null])).rows[0];
      await event(client, c, { ruleId: made.id, type: "rule.bulk_created", summary: `Created by import (row ${row.line})`, newValues: configOf(made) });
    }
  }
  return { applied: true, summary, rows: rows.map(({ itemId, warehouseId, ruleId, ...row }) => row) };
}
export const IMPORT_TEMPLATE_COLUMNS = IMPORT_COLUMNS;

// ---------------------------------------------------------------- integrations
// Item → per warehouse, and Warehouse → counts: read from the projection.
export async function getReorderSummary(client, c, { itemId = null, warehouseId = null } = {}) {
  if (!can(c, P.view)) return null;
  const visible = await warehouses(client, c);
  const { rows } = await client.query(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE rule.organization_id = $1 AND ($2::uuid IS NULL OR rule.item_id = $2) AND ($3::uuid IS NULL OR rule.warehouse_id = $3)
        AND ($4::uuid[] IS NULL OR rule.warehouse_id = ANY($4::uuid[])) ORDER BY warehouse.code, item.code LIMIT 500`,
    [c.organizationId, uuidOrNull(itemId, "Item"), uuidOrNull(warehouseId, "Warehouse"), visible]);
  const list = rows.map(toRule);
  const enabled = list.filter((row) => row.enabled);
  return {
    rules: itemId ? list : undefined,
    counts: { below: enabled.filter((row) => ["reorder_required", "out_of_stock", "below_reorder_covered"].includes(row.status)).length,
      required: enabled.filter((row) => ["reorder_required", "out_of_stock"].includes(row.status)).length, covered: enabled.filter((row) => row.status === "below_reorder_covered").length,
      outOfStock: enabled.filter((row) => row.status === "out_of_stock").length, rules: list.length },
  };
}

export async function getReorderOptions(client, c) {
  need(c, P.view, "You do not have permission to view reorder levels.");
  const visible = await warehouses(client, c);
  const list = (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND system_role IS NULL AND status = 'active'
      AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY is_default DESC, code`, [c.organizationId, visible])).rows;
  const categories = (await client.query(`SELECT id, name FROM tenant.item_groups WHERE organization_id = $1 ORDER BY name LIMIT 500`, [c.organizationId])).rows;
  return { warehouses: list, categories, statuses: REORDER_STATUSES, importColumns: IMPORT_COLUMNS, capabilities: capabilities(c) };
}
