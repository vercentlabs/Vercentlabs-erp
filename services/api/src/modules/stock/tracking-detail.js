// Batch and serial detail: one batch (or serial number) wherever it is — its stock by warehouse, location and disposition (on hand,
// reserved, available, quality hold, quarantined, damaged), its expiry, the reservations and quality holds on it, and its movement trail
// (from Movement History). Read only; actions (transfer, hold, purchase return, goods issue) open their own workflows.
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { getInventoryMovementHistory, getSerialMovementHistory } from "./movement-history.js";
import { restrictedStockSql } from "./rules.js";

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const id = (value, label) => { if (!value || !UUID.test(String(value))) throw new StockError(400, `${label} is invalid.`, "STOCK_TRACKING_INVALID"); return String(value); };

// The positions of a batch or a serial number, by disposition.
async function positions(client, c, where, values, visible) {
  const { rows } = await client.query(
    `SELECT warehouse.id AS warehouse_id, warehouse.code AS warehouse, warehouse.system_role, COALESCE(location.code, 'MAIN') AS location, location.id AS location_id,
            COALESCE(location.disposition, 'available') AS disposition, ${restrictedStockSql("location", "batch")} AS restricted,
            sum(balance.quantity) AS on_hand, sum(balance.reserved_quantity) AS reserved
       FROM tenant.stock_balances balance
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND ${where} AND ($${values.length + 2}::uuid[] IS NULL OR balance.warehouse_id = ANY($${values.length + 2}::uuid[]))
      GROUP BY warehouse.id, location.id, batch.id HAVING sum(balance.quantity) <> 0 ORDER BY warehouse.code, location`, [c.organizationId, ...values, visible]);
  return rows.map((row) => ({
    warehouseId: row.warehouse_id, warehouse: row.system_role === "in_transit" ? "In transit" : row.warehouse, locationId: row.location_id, location: row.location,
    disposition: row.disposition, onHand: n(row.on_hand), reserved: n(row.reserved), available: row.restricted ? 0 : n(Math.max(0, Number(row.on_hand) - Number(row.reserved))),
    restricted: Boolean(row.restricted),
  }));
}
const totals = (list) => {
  const sum = (filter) => n(list.filter(filter).reduce((total, row) => total + row.onHand, 0));
  return { onHand: sum(() => true), reserved: n(list.reduce((total, row) => total + row.reserved, 0)), available: n(list.reduce((total, row) => total + row.available, 0)),
    qualityHold: sum((row) => row.disposition === "quality_hold"), quarantined: sum((row) => row.disposition === "quarantined"), damaged: sum((row) => row.disposition === "damaged") };
};
async function reservationsOf(client, c, column, value) {
  return (await client.query(
    `SELECT reservation.id, reservation.reservation_number, reservation.active_quantity, reservation.reference_type, sales_order.sales_order_number, warehouse.code AS warehouse
       FROM tenant.stock_reservations reservation
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = reservation.organization_id AND warehouse.id = reservation.warehouse_id
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = reservation.organization_id AND sales_order.id = reservation.sales_order_id
      WHERE reservation.organization_id = $1 AND reservation.${column} = $2 AND reservation.status = 'active' ORDER BY reservation.created_at`, [c.organizationId, value])).rows
    .map((row) => ({ id: row.id, number: row.reservation_number, quantity: n(row.active_quantity), source: row.sales_order_number ?? row.reference_type, warehouse: row.warehouse,
      href: `/inventory/reservations/${row.id}` }));
}
async function holdsOf(client, c, column, value) {
  return (await client.query(
    `SELECT DISTINCT hold.id, hold.document_number, hold.hold_type, hold.status, sum(allocation.held_base_quantity - allocation.resolved_base_quantity) OVER (PARTITION BY hold.id) AS held
       FROM tenant.inventory_stock_hold_allocations allocation JOIN tenant.inventory_stock_holds hold ON hold.id = allocation.hold_id
      WHERE allocation.organization_id = $1 AND allocation.${column} = $2 ORDER BY hold.document_number DESC`, [c.organizationId, value])).rows
    .map((row) => ({ id: row.id, number: row.document_number, type: row.hold_type, status: row.status, held: n(row.held), href: `/inventory/quality-holds/${row.id}` }));
}

export async function getBatchDetail(client, c, batchId) {
  need(c, "stock.view", "You do not have permission to view stock.");
  const row = (await client.query(
    `SELECT batch.*, item.code AS sku, item.name AS item_name, item.id AS item_id, uom.code AS base_uom FROM tenant.stock_batches batch
       JOIN tenant.items item ON item.organization_id = batch.organization_id AND item.id = batch.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
      WHERE batch.organization_id = $1 AND batch.id = $2`, [c.organizationId, id(batchId, "Batch")])).rows[0];
  if (!row) throw new StockError(404, "Batch not found.", "STOCK_BATCH_NOT_FOUND");
  const visible = await visibleWarehouseIds(client, c);
  const list = await positions(client, c, "balance.batch_id = $2", [row.id], visible);
  const today = new Date().toISOString().slice(0, 10);
  const expiry = row.expires_on ? String(row.expires_on instanceof Date ? row.expires_on.toISOString().slice(0, 10) : row.expires_on).slice(0, 10) : null;
  return {
    batch: { id: row.id, batchNumber: row.batch_number, itemId: row.item_id, sku: row.sku, itemName: row.item_name, baseUom: row.base_uom, status: row.status,
      manufacturedOn: row.manufactured_on, expiresOn: expiry, expired: Boolean(expiry && expiry < today) || row.status === "expired", notes: row.notes ?? null },
    totals: totals(list), positions: list,
    reservations: can(c, "stock.reservations.view") ? await reservationsOf(client, c, "batch_id", row.id) : null,
    holds: can(c, "stock.holds.view") ? await holdsOf(client, c, "batch_id", row.id) : null,
    movements: can(c, STOCK_LEDGER_PERMISSIONS.view) ? (await getInventoryMovementHistory(client, c, { batchId: row.id, sort: "effective", order: "asc", limit: 200 })).rows : null,
    actions: actionsFor(c),
  };
}

export async function getSerialDetail(client, c, serialId) {
  need(c, "stock.view", "You do not have permission to view stock.");
  const row = (await client.query(
    `SELECT serial.*, item.code AS sku, item.name AS item_name, batch.batch_number, warehouse.code AS warehouse_code, warehouse.system_role, COALESCE(location.code, 'MAIN') AS location_code,
            COALESCE(location.disposition, 'available') AS disposition
       FROM tenant.stock_serials serial JOIN tenant.items item ON item.organization_id = serial.organization_id AND item.id = serial.item_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = serial.organization_id AND batch.id = serial.batch_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = serial.organization_id AND warehouse.id = serial.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
      WHERE serial.organization_id = $1 AND serial.id = $2`, [c.organizationId, id(serialId, "Serial number")])).rows[0];
  if (!row) throw new StockError(404, "Serial number not found.", "STOCK_SERIAL_NOT_FOUND");
  const visible = await visibleWarehouseIds(client, c);
  const inStock = row.status === "available";
  const shown = inStock && (!visible || visible.includes(row.warehouse_id));
  const history = can(c, STOCK_LEDGER_PERMISSIONS.view) ? (await getSerialMovementHistory(client, c, { serialId: row.id })).movements : null;
  const source = history?.find((entry) => ["purchase_receipt", "opening_stock", "production_receipt", "sales_return", "adjustment_in"].includes(entry.type)) ?? null;
  return {
    serial: { id: row.id, serialNumber: row.serial_number, itemId: row.item_id, sku: row.sku, itemName: row.item_name, batch: row.batch_number ?? null, batchId: row.batch_id ?? null,
      status: row.status, inStock, warehouseId: shown ? row.warehouse_id : null, warehouse: shown ? (row.system_role === "in_transit" ? "In transit" : row.warehouse_code) : null,
      location: shown ? row.location_code : null, disposition: shown ? row.disposition : null, missingSince: row.missing_since ?? null },
    source: source ? { type: source.typeLabel, number: source.source.number, href: source.source.href, at: source.effectiveAt } : null,
    reservations: can(c, "stock.reservations.view") ? await reservationsOf(client, c, "serial_id", row.id) : null,
    holds: can(c, "stock.holds.view") ? await holdsOf(client, c, "serial_id", row.id) : null,
    movements: history, actions: actionsFor(c),
  };
}

const actionsFor = (c) => ({
  transfer: can(c, "stock.transfers.create"), hold: can(c, "stock.holds.create"), goodsIssue: can(c, "stock.goods_issue.create"),
  purchaseReturn: can(c, "procurement.returns.manage"),
});
