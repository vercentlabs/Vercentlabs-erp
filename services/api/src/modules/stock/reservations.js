// Stock Reservations: the reservation records behind Reserved Stock. A reservation is one source document line's demand for an item (a sales
// order line, a transfer line, a purchase return line, a work order); its allocations are the physical stock protected for it — a warehouse,
// optionally a location, a batch or a serial number (each numbered RSV-…). Reserved Stock is the sum of the active allocations: a projection,
// reconciled against them and rebuildable from them.
//
// Documents create, consume and release reservations through the engine (modules/stock/index.js: reserveStock, reserveAvailableStock,
// consumeStockReservation, releaseStockReservation, reallocateStockReservation); here they are read, explained, released or reallocated by
// Inventory, reconciled and rebuilt. There is no setter for a reserved quantity, and nothing here moves stock or posts to the books.
import { STOCK_RESERVATION_PERMISSIONS as P } from "@vercentlabs/permissions";

import { getReservation, getReservationExceptions, reconcileReservedProjection, visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { releaseStockReservation } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };

export const RESERVATION_SOURCE_TYPES = Object.freeze([
  { id: "sales_order", label: "Sales order" }, { id: "inventory_transfer", label: "Internal transfer" }, { id: "purchase_return", label: "Purchase return" },
  { id: "manufacturing_work_order", label: "Work order" },
]);
const SOURCE_LABEL = Object.fromEntries(RESERVATION_SOURCE_TYPES.map((entry) => [entry.id, entry.label]));
const STATUS_LABEL = { active: "Active", consumed: "Consumed", released: "Released", cancelled: "Cancelled", expired: "Expired" };
export const reservationSourceHref = (type, id) => ({ sales_order: `/sales/orders/${id}`, inventory_transfer: `/inventory/transfers/${id}`, purchase_return: `/procurement/purchase-returns/${id}`,
  manufacturing_work_order: `/manufacturing/order/${id}` })[type] ?? null;

// The reservation with its source document's number and line, the item, and where its allocations are.
const SELECT = `
  SELECT parent.*, item.code AS sku, item.name AS item_name, uom.code AS base_uom,
         COALESCE(sales_order.sales_order_number, transfer.document_number, purchase_return.return_number, work_order.work_order_number) AS document_number,
         COALESCE(transfer_line.line_number, return_line.line_number) AS line_number,
         (SELECT array_agg(DISTINCT warehouse.code) FROM tenant.stock_reservations allocation JOIN tenant.warehouses warehouse ON warehouse.id = allocation.warehouse_id
           WHERE allocation.inventory_reservation_id = parent.id AND (allocation.status = 'active' OR parent.status <> 'active')) AS warehouses,
         (SELECT array_agg(DISTINCT allocation.warehouse_id) FROM tenant.stock_reservations allocation WHERE allocation.inventory_reservation_id = parent.id) AS warehouse_ids,
         (SELECT array_agg(DISTINCT batch.batch_number) FROM tenant.stock_reservations allocation JOIN tenant.stock_batches batch ON batch.id = allocation.batch_id
           WHERE allocation.inventory_reservation_id = parent.id AND allocation.status = 'active') AS batches,
         (SELECT array_agg(DISTINCT serial.serial_number) FROM tenant.stock_reservations allocation JOIN tenant.stock_serials serial ON serial.id = allocation.serial_id
           WHERE allocation.inventory_reservation_id = parent.id AND allocation.status = 'active') AS serials,
         (SELECT count(*) FROM tenant.stock_reservations allocation WHERE allocation.inventory_reservation_id = parent.id) AS allocation_count,
         creator.full_name AS created_by_name
    FROM tenant.inventory_reservations parent
    JOIN tenant.items item ON item.organization_id = parent.organization_id AND item.id = parent.item_id
    LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
    LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = parent.organization_id AND parent.source_document_type = 'sales_order' AND sales_order.id = parent.source_document_id
    LEFT JOIN tenant.inventory_transfers transfer ON transfer.organization_id = parent.organization_id AND parent.source_document_type = 'inventory_transfer' AND transfer.id = parent.source_document_id
    LEFT JOIN tenant.inventory_transfer_lines transfer_line ON transfer_line.organization_id = parent.organization_id AND parent.source_document_type = 'inventory_transfer' AND transfer_line.id = parent.source_line_id
    LEFT JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = parent.organization_id AND parent.source_document_type = 'purchase_return' AND purchase_return.id = parent.source_document_id
    LEFT JOIN tenant.purchase_return_lines return_line ON return_line.organization_id = parent.organization_id AND parent.source_document_type = 'purchase_return' AND return_line.id = parent.source_line_id
    LEFT JOIN tenant.manufacturing_work_orders work_order ON work_order.organization_id = parent.organization_id AND parent.source_document_type = 'manufacturing_work_order' AND work_order.id = parent.source_document_id
    LEFT JOIN public.users creator ON creator.id = parent.created_by`;

function toReservation(row, c) {
  const allocations = can(c, P.viewAllocations);
  return {
    id: row.id, status: row.status, statusLabel: STATUS_LABEL[row.status] ?? row.status, itemId: row.item_id, sku: row.sku, itemName: row.item_name, baseUom: row.base_uom,
    sourceType: row.source_document_type, sourceLabel: SOURCE_LABEL[row.source_document_type] ?? row.source_document_type, sourceId: row.source_document_id,
    sourceLineId: row.source_line_id, sourceLineNumber: row.line_number ?? null, document: row.document_number, sourceHref: reservationSourceHref(row.source_document_type, row.source_document_id),
    requested: n(row.requested_base_quantity), reserved: n(row.reserved_base_quantity), consumed: n(row.consumed_base_quantity), released: n(row.released_base_quantity),
    active: n(row.active_base_quantity), unreserved: n(Math.max(Number(row.requested_base_quantity) - Number(row.active_base_quantity), 0)),
    warehouses: row.warehouses ?? [], warehouseIds: row.warehouse_ids ?? [], allocationCount: Number(row.allocation_count ?? 0),
    ...(allocations ? { batches: row.batches ?? [], serials: row.serials ?? [] } : {}), expiresAt: row.expires_at, createdAt: row.created_at, createdByName: row.created_by_name,
    updatedAt: row.updated_at, version: row.version,
  };
}

// The reservations: filters status (active default | all | consumed | released | cancelled | expired), sourceType, sourceId, itemId, warehouseId,
// from, to, search (SKU, item, document, batch, serial, allocation number), limit, offset. Only reservations in warehouses the user may see.
export async function listInventoryReservations(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view stock reservations.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["parent.organization_id = $1"];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`EXISTS (SELECT 1 FROM tenant.stock_reservations allocation WHERE allocation.inventory_reservation_id = parent.id AND allocation.warehouse_id = ANY(${bind(visible)}::uuid[]))`);
  const status = filters.status ?? "active";
  if (STATUS_LABEL[status]) where.push(`parent.status = ${bind(status)}`);
  if (SOURCE_LABEL[filters.sourceType]) where.push(`parent.source_document_type = ${bind(filters.sourceType)}`);
  if (filters.sourceId && UUID.test(filters.sourceId)) where.push(`parent.source_document_id = ${bind(filters.sourceId)}`);
  if (filters.itemId && UUID.test(filters.itemId)) where.push(`parent.item_id = ${bind(filters.itemId)}`);
  if (filters.warehouseId && UUID.test(filters.warehouseId))
    where.push(`EXISTS (SELECT 1 FROM tenant.stock_reservations allocation WHERE allocation.inventory_reservation_id = parent.id AND allocation.warehouse_id = ${bind(filters.warehouseId)})`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`parent.created_at >= ${bind(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`parent.created_at < ${bind(filters.to)}::date + 1`);
  const term = text(filters.search, 120);
  if (term) {
    const like = bind(`%${term.toLowerCase()}%`);
    where.push(`(lower(concat_ws(' ', item.code, item.name, sales_order.sales_order_number, transfer.document_number, purchase_return.return_number, work_order.work_order_number)) LIKE ${like}
      OR EXISTS (SELECT 1 FROM tenant.stock_reservations allocation LEFT JOIN tenant.stock_batches batch ON batch.id = allocation.batch_id
        LEFT JOIN tenant.stock_serials serial ON serial.id = allocation.serial_id WHERE allocation.inventory_reservation_id = parent.id
        AND lower(concat_ws(' ', allocation.reservation_number, batch.batch_number, serial.serial_number)) LIKE ${like}))`);
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = Number((await client.query(`SELECT count(*) FROM (${SELECT} WHERE ${where.join(" AND ")}) AS listed`, values)).rows[0].count);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY parent.created_at DESC, parent.id LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const list = rows.map((row) => toReservation(row, c));
  return { total, rows: list, totalActive: n(list.reduce((sum, entry) => sum + entry.active, 0)),
    capabilities: { release: can(c, P.release), reallocate: can(c, P.reallocate), reallocateWarehouse: can(c, P.reallocateWarehouse), exceptions: can(c, P.resolveExceptions),
      reconcile: can(c, P.reconcile), rebuild: can(c, P.rebuild), viewAllocations: can(c, P.viewAllocations), viewSources: can(c, P.viewSources) } };
}

// One reservation: the demand (requested, reserved, consumed, released, active), every allocation with its history and consumptions, and the
// exceptions on them.
export async function getInventoryReservation(client, c, reservationId) {
  need(c, P.view, "You do not have permission to view stock reservations.");
  if (!UUID.test(String(reservationId ?? ""))) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  const row = (await client.query(`${SELECT} WHERE parent.organization_id = $1 AND parent.id = $2`, [c.organizationId, reservationId])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !(row.warehouse_ids ?? []).some((id) => visible.includes(id)))) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  const ids = (await client.query(`SELECT id FROM tenant.stock_reservations WHERE organization_id = $1 AND inventory_reservation_id = $2 ORDER BY created_at, id`, [c.organizationId, row.id])).rows;
  const showAllocations = can(c, P.viewAllocations);
  const allocations = [];
  for (const { id } of ids) {
    const allocation = await getReservation(client, { ...c, permissions: [...(c.permissions ?? []), "stock.view"] }, id).catch((error) => (error.code === "STOCK_RESERVATION_NOT_FOUND" ? null : Promise.reject(error)));
    if (!allocation) continue;
    allocations.push(showAllocations ? allocation : { ...allocation, location: null, batch: null, serial: null, allocation: "Warehouse" });
  }
  const exceptions = (await getReservationExceptions(client, { ...c, permissions: [...(c.permissions ?? []), "stock.view"] })).exceptions
    .filter((entry) => entry.reservation.reservationId === row.id).map((entry) => ({ kind: entry.kind, message: entry.message, allocationId: entry.reservation.id, allocation: entry.reservation.number }));
  const history = allocations.flatMap((allocation) => allocation.history.map((event) => ({ ...event, allocation: allocation.number })))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return {
    reservation: toReservation(row, c), allocations, history, exceptions,
    capabilities: { release: row.status === "active" && can(c, P.release), reallocate: row.status === "active" && can(c, P.reallocate),
      reallocateWarehouse: row.status === "active" && can(c, P.reallocateWarehouse), viewAllocations: showAllocations },
  };
}

// The reservations of one source document (a sales order, a transfer, a purchase return, a work order), line by line.
export async function getReservationsForSource(client, c, { sourceType, sourceId } = {}) {
  need(c, P.view, "You do not have permission to view stock reservations.");
  if (!SOURCE_LABEL[sourceType] || !UUID.test(String(sourceId ?? ""))) throw new StockError(400, "Name the source document.", "STOCK_RESERVATION_SOURCE_INVALID");
  return (await listInventoryReservations(client, c, { sourceType, sourceId, status: "all", limit: 1000 })).rows;
}

// Which documents hold an item's reserved stock (in one warehouse, or all): the source breakdown behind Reserved.
export async function getReservationBreakdown(client, c, { itemId, warehouseId = null } = {}) {
  need(c, P.viewSources, "You do not have permission to see which documents hold reserved stock.");
  if (!UUID.test(String(itemId ?? ""))) throw new StockError(400, "Choose the item.", "STOCK_ITEM_REQUIRED");
  const visible = await visibleWarehouseIds(client, c);
  const rows = (await client.query(
    `SELECT * FROM (SELECT parent.id, parent.source_document_type, parent.source_document_id, warehouse.code AS warehouse, allocation.warehouse_id, sum(allocation.active_quantity) AS active,
            min(COALESCE(sales_order.sales_order_number, transfer.document_number, purchase_return.return_number, work_order.work_order_number)) AS document_number
       FROM tenant.stock_reservations allocation
       JOIN tenant.inventory_reservations parent ON parent.id = allocation.inventory_reservation_id
       JOIN tenant.warehouses warehouse ON warehouse.id = allocation.warehouse_id
       LEFT JOIN tenant.sales_orders sales_order ON parent.source_document_type = 'sales_order' AND sales_order.id = parent.source_document_id
       LEFT JOIN tenant.inventory_transfers transfer ON parent.source_document_type = 'inventory_transfer' AND transfer.id = parent.source_document_id
       LEFT JOIN tenant.purchase_returns purchase_return ON parent.source_document_type = 'purchase_return' AND purchase_return.id = parent.source_document_id
       LEFT JOIN tenant.manufacturing_work_orders work_order ON parent.source_document_type = 'manufacturing_work_order' AND work_order.id = parent.source_document_id
      WHERE allocation.organization_id = $1 AND allocation.item_id = $2 AND allocation.status = 'active' AND ($3::uuid IS NULL OR allocation.warehouse_id = $3)
        AND ($4::uuid[] IS NULL OR allocation.warehouse_id = ANY($4::uuid[]))
      GROUP BY parent.id, parent.source_document_type, parent.source_document_id, warehouse.code, allocation.warehouse_id) AS sources
      ORDER BY active DESC`, [c.organizationId, itemId, UUID.test(String(warehouseId ?? "")) ? warehouseId : null, visible])).rows;
  const sources = rows.map((row) => ({ reservationId: row.id, sourceType: row.source_document_type, sourceLabel: SOURCE_LABEL[row.source_document_type], sourceId: row.source_document_id,
    document: row.document_number, sourceHref: reservationSourceHref(row.source_document_type, row.source_document_id), warehouse: row.warehouse, warehouseId: row.warehouse_id, active: n(row.active) }));
  return { itemId, sources, total: n(sources.reduce((sum, entry) => sum + entry.active, 0)) };
}

// Release what a reservation still holds (or part of it, newest allocation first) for another process's document: Inventory's own permission and a
// reason. The source keeps its demand, now unreserved. input: { quantity? (base), reason }.
export async function releaseInventoryReservation(client, c, reservationId, input = {}) {
  need(c, P.release, "You do not have permission to release another document's reservation.");
  const reason = text(input.reason);
  if (!reason) throw new StockError(400, "Give the reason for releasing the reservation.", "STOCK_REASON_REQUIRED");
  const parent = (await client.query(`SELECT * FROM tenant.inventory_reservations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, String(reservationId)])).rows[0];
  if (!parent) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  if (parent.status !== "active") return getInventoryReservation(client, c, parent.id);
  let left = input.quantity === undefined || input.quantity === null || input.quantity === "" ? null : Number(input.quantity);
  if (left !== null && (!Number.isFinite(left) || left <= 0)) throw new StockError(400, "Enter the quantity to release.", "STOCK_QUANTITY_INVALID");
  if (left !== null && left > Number(parent.active_base_quantity) + 1e-9) throw new StockError(409, `Only ${n(parent.active_base_quantity)} is still reserved.`, "STOCK_RESERVATION_EXCEEDS_ACTIVE");
  const allocations = (await client.query(`SELECT id, active_quantity FROM tenant.stock_reservations WHERE organization_id = $1 AND inventory_reservation_id = $2 AND status = 'active'
      ORDER BY created_at DESC, id`, [c.organizationId, parent.id])).rows;
  const stock = { ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.reserve"])] };
  for (const allocation of allocations) {
    if (left !== null && left <= 1e-9) break;
    const take = left === null ? null : Math.min(left, Number(allocation.active_quantity));
    await releaseStockReservation(client, stock, allocation.id, { status: "released", quantity: take, reasonCode: "inventory_release", reason });
    if (left !== null) left = n(left - take);
  }
  return getInventoryReservation(client, c, parent.id);
}

// Reconciliation: Reserved (the projection) against the active allocations, each reservation's totals against its allocations, a serial
// number held twice, a position reserved beyond what it holds, active reservations for sources that are no longer open. Nothing is changed.
export async function reconcileInventoryReservations(client, c) {
  need(c, P.reconcile, "You do not have permission to reconcile stock reservations.");
  const ctx = { ...c, permissions: [...(c.permissions ?? []), "stock.view"] };
  const projection = await reconcileReservedProjection(client, ctx);
  const parents = (await client.query(
    `SELECT parent.id, parent.active_base_quantity, COALESCE(sum(allocation.active_quantity), 0) AS allocated FROM tenant.inventory_reservations parent
       LEFT JOIN tenant.stock_reservations allocation ON allocation.inventory_reservation_id = parent.id
      WHERE parent.organization_id = $1 GROUP BY parent.id HAVING abs(parent.active_base_quantity - COALESCE(sum(allocation.active_quantity), 0)) > 0.000001`, [c.organizationId])).rows
    .map((row) => ({ reservationId: row.id, recorded: n(row.active_base_quantity), allocations: n(row.allocated) }));
  const orphans = Number((await client.query(`SELECT count(*) FROM tenant.stock_reservations WHERE organization_id = $1 AND inventory_reservation_id IS NULL`, [c.organizationId])).rows[0].count);
  const serials = (await client.query(`SELECT serial_id, count(*) AS holds FROM tenant.stock_reservations WHERE organization_id = $1 AND status = 'active' AND serial_id IS NOT NULL
      GROUP BY serial_id HAVING count(*) > 1`, [c.organizationId])).rows.map((row) => ({ serialId: row.serial_id, holds: Number(row.holds) }));
  const exceptions = (await getReservationExceptions(client, ctx)).exceptions;
  const sourceIssues = exceptions.filter((entry) => ["source_closed", "exceeds_demand", "stock_short"].includes(entry.kind));
  return { checkedAt: new Date().toISOString(), consistent: !projection.mismatchCount && !parents.length && !orphans && !serials.length && !sourceIssues.length,
    projection: projection.mismatches, reservationTotals: parents, unattachedAllocations: orphans, serialsHeldTwice: serials,
    sourceIssues: sourceIssues.map((entry) => ({ kind: entry.kind, message: entry.message, allocation: entry.reservation.number, reservationId: entry.reservation.reservationId })) };
}

// Rebuilds Reserved (the projection on stock balances) from the active allocations — never creating, changing or deleting a reservation.
export async function rebuildReservedStockProjection(client, c, input = {}) {
  need(c, P.rebuild, "You do not have permission to rebuild reserved stock.");
  const reason = text(input.reason);
  if (!reason) throw new StockError(400, "Give the reason for rebuilding reserved stock.", "STOCK_REASON_REQUIRED");
  const ctx = { ...c, permissions: [...(c.permissions ?? []), "stock.view", "stock.adjust"] };
  const before = await reconcileReservedProjection(client, ctx, { repair: true });
  await client.query(`SELECT tenant.refresh_inventory_reservation(id) FROM tenant.inventory_reservations WHERE organization_id = $1`, [c.organizationId]);
  const after = await reconcileReservedProjection(client, ctx);
  await client.query(
    `INSERT INTO tenant.stock_balance_rebuilds (organization_id, reason, quantity_corrections, reservation_corrections, details, actor_user_id) VALUES ($1, $2, 0, $3, $4, $5)`,
    [c.organizationId, `Reserved stock: ${reason}`, before.repaired, JSON.stringify({ reservations: before.mismatches.slice(0, 500) }), c.userId ?? null]);
  return { corrected: before.repaired, corrections: before.mismatches, consistent: after.mismatchCount === 0 };
}
