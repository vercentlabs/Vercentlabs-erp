// Real-Time Stock Balance: what the company has now, read from the current-balance projection (stock_balances), which the same transaction
// that posts each Inventory movement keeps up to date, and from the active reservations and open documents. Nothing here changes stock: a
// wrong quantity is corrected by an Inventory adjustment or another stock transaction, never by editing a balance.
//
//   On hand     physical stock, the sum of posted movements, in the item's base unit
//   Reserved    what active reservations hold
//   Restricted  on hand but not usable: quality locations (quality hold, quarantine, damaged), inactive locations, blocked or expired batches
//   Available   eligible (unrestricted) on hand less what is reserved from it; never negative
//   In transit  dispatched between warehouses and not yet received: still the company's, on hand in the system "Goods in transit" warehouse
//               (its TRANSIT location, never allocated)
//   Incoming    expected: confirmed purchase orders still to receive and inbound transfers (drafted or on their way); never on hand at the destination
//   Outgoing    committed: reservations, plus other planned demand (unreserved confirmed sales, drafted outbound transfers and purchase returns)
//
// The projection is checked against the ledger and the reservations (reconcileInventoryBalances) and, when it drifts, rebuilt from them
// with an audit record (rebuildInventoryBalanceProjection). A user listed on some warehouses sees only those.
import { normalizeQuantityToBase } from "../products/uom.js";
import { formatDecimal } from "../../core/decimal.js";
import { openNegativeExceptions } from "./negative-stock-control.js";
import { StockError } from "./index.js";
import { getStockLedger } from "./ledger.js";
import { expiredStockSql, restrictedStockSql, restrictionReasonSql } from "./rules.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message = "You do not have permission to view stock.") => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const text = (value, max = 120) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };

export const STOCK_BALANCE_VIEWS = Object.freeze([
  { id: "all", label: "All stock" }, { id: "available", label: "Available" }, { id: "reserved", label: "Reserved" }, { id: "restricted", label: "Quality / Restricted" },
  { id: "in_transit", label: "In transit" }, { id: "zero", label: "Zero stock" }, { id: "by_warehouse", label: "By warehouse" }, { id: "by_item", label: "By item" },
  { id: "by_batch", label: "By batch" }, { id: "quality_hold", label: "Quality hold" }, { id: "quarantined", label: "Quarantined" }, { id: "damaged", label: "Damaged" },
  { id: "negative", label: "Negative stock" },
]);
const GRAIN = Object.freeze({ all: "position", available: "position", reserved: "position", restricted: "position", in_transit: "warehouse", zero: "item", by_warehouse: "warehouse", by_item: "item", by_batch: "batch", negative: "position", quality_hold: "position", quarantined: "position", damaged: "position" });

// The warehouses this user may see: all of them, unless the user is listed on some (then only those), never one that lists only others.
export async function visibleWarehouseIds(client, c) {
  if (privileged(c) || !c.userId) return null;
  const { rows } = await client.query(
    `SELECT warehouse.id FROM tenant.warehouses warehouse WHERE warehouse.organization_id = $1 AND (
        EXISTS (SELECT 1 FROM tenant.warehouse_user_access access WHERE access.organization_id = $1 AND access.warehouse_id = warehouse.id AND access.user_id = $2)
        OR (NOT EXISTS (SELECT 1 FROM tenant.warehouse_user_access access WHERE access.organization_id = $1 AND access.user_id = $2)
            AND NOT EXISTS (SELECT 1 FROM tenant.warehouse_user_access access WHERE access.organization_id = $1 AND access.warehouse_id = warehouse.id)))`,
    [c.organizationId, c.userId]);
  return rows.map((row) => row.id);
}

// Every stock position as rows of one shape: the projection (on hand, reserved, restricted…) and, for views at warehouse or item grain, the
// expected and in-transit quantities of open documents. asOf replaces the projection by the ledger up to the end of that day (on hand only).
function positionsSql({ withCommitments, asOf }) {
  const physical = asOf
    ? `SELECT movement.item_id, movement.warehouse_id, movement.warehouse_location_id AS location_id, movement.batch_id, sum(movement.quantity) AS on_hand, 0 AS reserved,
              0 AS restricted, 0 AS expired, 0 AS quality, 0 AS free, 0 AS value, 0 AS incoming,
              sum(CASE WHEN location.purpose = 'transit' THEN movement.quantity ELSE 0 END) AS in_transit, 0 AS version, 0 AS quarantined, 0 AS damaged
         FROM tenant.stock_movements movement
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
        WHERE movement.organization_id = $1 AND movement.occurred_at < $2::date + 1
        GROUP BY movement.item_id, movement.warehouse_id, movement.warehouse_location_id, movement.batch_id`
    : `SELECT balance.item_id, balance.warehouse_id, balance.warehouse_location_id AS location_id, balance.batch_id, balance.quantity AS on_hand, balance.reserved_quantity AS reserved,
              CASE WHEN ${restrictedStockSql("location", "batch")} THEN balance.quantity ELSE 0 END AS restricted,
              CASE WHEN ${expiredStockSql("batch")} THEN balance.quantity ELSE 0 END AS expired,
              CASE WHEN COALESCE(location.disposition, 'available') = 'quality_hold' OR (COALESCE(location.disposition, 'available') = 'available' AND location.location_type = 'quality')
                   THEN balance.quantity ELSE 0 END AS quality,
              CASE WHEN ${restrictedStockSql("location", "batch")} THEN 0 ELSE greatest(balance.quantity - balance.reserved_quantity, 0) END AS free,
              balance.quantity * balance.average_cost AS value, 0 AS incoming, CASE WHEN location.purpose = 'transit' THEN balance.quantity ELSE 0 END AS in_transit, balance.version,
              CASE WHEN location.disposition = 'quarantined' THEN balance.quantity ELSE 0 END AS quarantined, CASE WHEN location.disposition = 'damaged' THEN balance.quantity ELSE 0 END AS damaged
         FROM tenant.stock_balances balance
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
        WHERE balance.organization_id = $1 AND $2::date IS NOT NULL`;
  if (!withCommitments || asOf) return physical;
  return `${physical}
    UNION ALL
    SELECT line.product_id, COALESCE(line.receiving_warehouse_id, purchase_order.default_warehouse_id), NULL, NULL, 0, 0, 0, 0, 0, 0, 0,
           progress.remaining_to_receive * line.conversion_factor, 0, 0, 0, 0
      FROM tenant.purchase_order_line_status progress
      JOIN tenant.purchase_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.purchase_order_line_id
      JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
     WHERE progress.organization_id = $1 AND purchase_order.status = 'confirmed' AND progress.remaining_to_receive > 0 AND line.product_id IS NOT NULL
    UNION ALL
    SELECT line.item_id, transfer.destination_warehouse_id, NULL, NULL, 0, 0, 0, 0, 0, 0, 0,
           CASE WHEN transfer.status = 'confirmed' THEN line.base_quantity ELSE line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity END, 0, 0, 0, 0
      FROM tenant.inventory_transfers transfer
      JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
     WHERE transfer.organization_id = $1 AND transfer.transfer_type = 'warehouse' AND transfer.status IN ('confirmed', 'dispatched', 'partially_received')`;
}

const GRAIN_COLUMNS = Object.freeze({
  position: { select: "position.item_id, position.warehouse_id, position.location_id, position.batch_id", group: "position.item_id, position.warehouse_id, position.location_id, position.batch_id" },
  batch: { select: "position.item_id, position.warehouse_id, NULL::uuid AS location_id, position.batch_id", group: "position.item_id, position.warehouse_id, position.batch_id" },
  warehouse: { select: "position.item_id, position.warehouse_id, NULL::uuid AS location_id, NULL::uuid AS batch_id", group: "position.item_id, position.warehouse_id" },
  item: { select: "position.item_id, NULL::uuid AS warehouse_id, NULL::uuid AS location_id, NULL::uuid AS batch_id", group: "position.item_id" },
});

// filters: view (STOCK_BALANCE_VIEWS), warehouseId, locationId, itemId, categoryId, batchId, search (SKU, name, barcode, batch, serial),
// disposition (available | restricted), status (in_stock | out_of_stock | reserved | restricted | in_transit | incoming), includeZero, asOf
// (YYYY-MM-DD: on hand from the ledger at the end of that day), limit, offset.
export async function getStockBalance(client, c, filters = {}) {
  need(c, "stock.view");
  const view = GRAIN[filters.view] ? filters.view : "all";
  const asOf = filters.asOf && DATE.test(String(filters.asOf)) ? String(filters.asOf) : null;
  const grain = asOf && GRAIN[view] === "position" ? "position" : GRAIN[view];
  const withCommitments = grain === "warehouse" || grain === "item";
  const values = [c.organizationId, asOf ?? "1970-01-01"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`(position.warehouse_id IS NULL OR position.warehouse_id = ANY(${bind(visible)}::uuid[]))`);
  if (filters.warehouseId && UUID.test(filters.warehouseId)) where.push(`position.warehouse_id = ${bind(filters.warehouseId)}`);
  if (filters.locationId && UUID.test(filters.locationId)) {
    const main = (await client.query(`SELECT is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, filters.locationId])).rows[0];
    where.push(main?.is_default_storage ? `position.location_id IS NULL` : `position.location_id = ${bind(filters.locationId)}`);
  }
  if (filters.itemId && UUID.test(filters.itemId)) where.push(`position.item_id = ${bind(filters.itemId)}`);
  if (filters.batchId && UUID.test(filters.batchId)) where.push(`position.batch_id = ${bind(filters.batchId)}`);
  if (filters.categoryId && UUID.test(filters.categoryId)) where.push(`item.group_id = ${bind(filters.categoryId)}`);
  const term = text(filters.search);
  if (term) {
    const like = bind(`%${term.toLowerCase()}%`);
    where.push(`(lower(concat_ws(' ', item.code, item.sku, item.name, item.barcode)) LIKE ${like}
      OR EXISTS (SELECT 1 FROM tenant.item_identifiers identifier WHERE identifier.organization_id = item.organization_id AND identifier.item_id = item.id AND lower(identifier.value) LIKE ${like})
      OR EXISTS (SELECT 1 FROM tenant.stock_batches found WHERE found.organization_id = item.organization_id AND found.item_id = item.id AND lower(found.batch_number) LIKE ${like}
                   AND (position.batch_id IS NULL OR position.batch_id = found.id))
      OR EXISTS (SELECT 1 FROM tenant.stock_serials found WHERE found.organization_id = item.organization_id AND found.item_id = item.id AND lower(found.serial_number) LIKE ${like}))`);
  }
  const having = [];
  const zero = view === "zero" || filters.includeZero === true || filters.includeZero === "true";
  if (view === "available" || filters.status === "in_stock" || filters.disposition === "available") having.push("greatest(sum(position.free), 0) > 0");
  if (view === "reserved" || filters.status === "reserved") having.push("sum(position.reserved) > 0");
  if (view === "restricted" || filters.status === "restricted" || filters.disposition === "restricted") having.push("sum(position.restricted) > 0");
  if (view === "in_transit" || filters.status === "in_transit") having.push("sum(position.in_transit) > 0");
  // Held stock by disposition (Quality Holds): on hand, never available.
  if (view === "quality_hold" || filters.disposition === "quality_hold") having.push("sum(position.quality) > 0");
  if (view === "quarantined" || filters.disposition === "quarantined") having.push("sum(position.quarantined) > 0");
  if (view === "damaged" || filters.disposition === "damaged") having.push("sum(position.damaged) > 0");
  // Negative stock: a position below zero (an authorised override, not yet resolved by a receipt) — never hidden, never clamped.
  if (view === "negative" || filters.status === "negative") having.push("sum(least(position.on_hand, 0)) < 0");
  if (filters.status === "incoming") having.push("sum(position.incoming) > 0");
  if (view === "zero" || filters.status === "out_of_stock") having.push("sum(position.on_hand) = 0");
  else if (!zero) having.push("(sum(position.on_hand) <> 0 OR sum(position.reserved) <> 0 OR sum(position.incoming) <> 0 OR sum(position.in_transit) <> 0)");
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const columns = GRAIN_COLUMNS[grain];
  // Zero stock at item grain also lists stock items that never had any.
  const source = grain === "item" && zero
    ? `(${positionsSql({ withCommitments, asOf })} UNION ALL SELECT item.id, NULL, NULL, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 FROM tenant.items item
         WHERE item.organization_id = $1 AND item.track_inventory AND item.lifecycle_status = 'active')`
    : `(${positionsSql({ withCommitments, asOf })})`;
  const { rows } = await client.query(
    `WITH grouped AS (
       SELECT ${columns.select}, sum(position.on_hand) AS on_hand, sum(position.reserved) AS reserved, sum(position.restricted) AS restricted, sum(position.expired) AS expired,
              sum(position.quality) AS quality, sum(position.quarantined) AS quarantined, sum(position.damaged) AS damaged, greatest(sum(position.free), 0) AS available, sum(position.value) AS value, sum(position.incoming) AS incoming,
              sum(position.in_transit) AS in_transit, max(position.version) AS version, -sum(least(position.on_hand, 0)) AS negative_quantity
         FROM ${source} AS position
         JOIN tenant.items item ON item.organization_id = $1 AND item.id = position.item_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY ${columns.group}
        ${having.length ? `HAVING ${having.join(" AND ")}` : ""})
     SELECT grouped.*, item.code AS sku, item.name AS item_name, item.tracking_type, uom.code AS base_uom, category.name AS category_name,
            warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, COALESCE(location.code, CASE WHEN grouped.warehouse_id IS NOT NULL AND ${grain === "position" ? "true" : "false"} THEN 'MAIN' END) AS location_code,
            batch.batch_number, batch.expires_on, batch.status AS batch_status, count(*) OVER () AS total_rows,
            sum(grouped.on_hand) OVER () AS total_on_hand, sum(grouped.reserved) OVER () AS total_reserved, sum(grouped.available) OVER () AS total_available,
            sum(grouped.restricted) OVER () AS total_restricted, sum(grouped.in_transit) OVER () AS total_in_transit, sum(grouped.incoming) OVER () AS total_incoming,
            sum(grouped.value) OVER () AS total_value, count(*) FILTER (WHERE grouped.negative_quantity > 0) OVER () AS total_negative, now() AS as_of_time
       FROM grouped
       JOIN tenant.items item ON item.organization_id = $1 AND item.id = grouped.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
       LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = item.group_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = $1 AND warehouse.id = grouped.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = $1 AND location.id = grouped.location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = $1 AND batch.id = grouped.batch_id
      ORDER BY item.code, warehouse.code NULLS FIRST, location.code NULLS FIRST, batch.batch_number NULLS FIRST
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values);
  const value = can(c, "stock.valuation.view");
  const first = rows[0];
  return {
    view, grain, asOf, asOfTime: first?.as_of_time ?? new Date().toISOString(), showsValue: value && !asOf, total: Number(first?.total_rows ?? 0), limit, offset,
    totals: {
      onHand: n(first?.total_on_hand), ...(asOf ? {} : { reserved: n(first?.total_reserved), available: n(first?.total_available), restricted: n(first?.total_restricted),
        inTransit: n(first?.total_in_transit), incoming: n(first?.total_incoming), ...(value ? { value: n(first?.total_value) } : {}) }),
      negativePositions: Number(first?.total_negative ?? 0),
    },
    rows: rows.map((row) => ({
      key: [row.item_id, row.warehouse_id, row.location_id, row.batch_id].map((part) => part ?? "-").join(":"),
      itemId: row.item_id, sku: row.sku, itemName: row.item_name, trackingType: row.tracking_type, category: row.category_name, baseUom: row.base_uom,
      warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name, locationId: row.location_id, locationCode: row.location_code,
      batchId: row.batch_id, batchNumber: row.batch_number, expiresOn: row.expires_on, batchStatus: row.batch_status, onHand: n(row.on_hand),
      negativeQuantity: n(row.negative_quantity), hasNegativeStock: Number(row.negative_quantity) > 1e-9,
      ...(asOf ? {} : {
        reserved: n(row.reserved), available: n(row.available), restricted: n(row.restricted), expired: n(row.expired), qualityHold: n(row.quality), quarantined: n(row.quarantined), damaged: n(row.damaged),
        inTransit: n(row.in_transit), incoming: withCommitments ? n(row.incoming) : null, version: Number(row.version ?? 0),
        ...(value ? { value: n(row.value) } : {}),
      }),
    })),
  };
}

// One item: summary, warehouses, locations and batches, reservations, incoming, outgoing, batches, serials and recent movements, and whether
// its projection agrees with the ledger.
export async function getItemStock(client, c, itemId) {
  need(c, "stock.view");
  if (!UUID.test(String(itemId ?? ""))) throw new StockError(400, "Item is not valid.", "STOCK_ITEM_NOT_FOUND");
  const item = (await client.query(
    `SELECT item.id, item.code, item.name, item.tracking_type, item.track_inventory, item.lifecycle_status, uom.code AS base_uom FROM tenant.items item
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id WHERE item.organization_id = $1 AND item.id = $2`,
    [c.organizationId, itemId])).rows[0];
  if (!item) throw new StockError(404, "Item not found.", "STOCK_ITEM_NOT_FOUND");
  const visible = await visibleWarehouseIds(client, c);
  const scope = (column) => (visible ? `AND ${column} = ANY($3::uuid[])` : "AND $3::uuid[] IS NULL");
  const query = async (sql) => (await client.query(sql, [c.organizationId, item.id, visible])).rows;
  const [summary, warehouses, positions] = [
    (await getStockBalance(client, c, { view: "by_item", itemId: item.id, includeZero: true })).rows[0],
    (await getStockBalance(client, c, { view: "by_warehouse", itemId: item.id })).rows,
    (await getStockBalance(client, c, { view: "all", itemId: item.id, limit: 1000 })).rows,
  ];
  const reservations = await query(
    `SELECT reservation.id, reservation.reservation_number, reservation.reference_type, reservation.active_quantity, reservation.created_at, warehouse.code AS warehouse_code,
            COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number, sales_order.sales_order_number
       FROM tenant.stock_reservations reservation
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = reservation.organization_id AND warehouse.id = reservation.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = reservation.organization_id AND location.id = reservation.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = reservation.organization_id AND batch.id = reservation.batch_id
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = reservation.organization_id AND sales_order.id = reservation.sales_order_id
      WHERE reservation.organization_id = $1 AND reservation.item_id = $2 AND reservation.status = 'active' ${scope("reservation.warehouse_id")}
      ORDER BY reservation.created_at`);
  const incoming = [
    ...(await query(
      `SELECT 'purchase_order' AS kind, purchase_order.id, purchase_order.purchase_order_number AS reference, warehouse.code AS warehouse_code,
              progress.remaining_to_receive * line.conversion_factor AS quantity, line.expected_delivery_date AS expected
         FROM tenant.purchase_order_line_status progress
         JOIN tenant.purchase_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.purchase_order_line_id
         JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = COALESCE(line.receiving_warehouse_id, purchase_order.default_warehouse_id)
        WHERE progress.organization_id = $1 AND line.product_id = $2 AND purchase_order.status = 'confirmed' AND progress.remaining_to_receive > 0 ${scope("warehouse.id")}
        ORDER BY line.expected_delivery_date NULLS LAST`)),
    ...(await query(
      `SELECT CASE WHEN transfer.status = 'confirmed' THEN 'transfer_in' ELSE 'in_transit' END AS kind, transfer.id, transfer.document_number AS reference,
              warehouse.code AS warehouse_code,
              CASE WHEN transfer.status = 'confirmed' THEN line.base_quantity ELSE line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity END AS quantity,
              COALESCE(transfer.expected_arrival_date::timestamptz, transfer.dispatched_at) AS expected
         FROM tenant.inventory_transfers transfer
         JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id = transfer.organization_id AND warehouse.id = transfer.destination_warehouse_id
        WHERE transfer.organization_id = $1 AND line.item_id = $2 AND transfer.transfer_type = 'warehouse' AND transfer.status IN ('confirmed', 'dispatched', 'partially_received')
          ${scope("warehouse.id")}`)),
  ];
  const outgoing = [
    ...reservations.map((row) => ({ kind: "reservation", id: row.id, reference: row.sales_order_number ?? row.reservation_number, warehouse_code: row.warehouse_code, quantity: row.active_quantity })),
    ...(await query(
      `SELECT 'sales_order' AS kind, sales_order.id, sales_order.sales_order_number AS reference, warehouse.code AS warehouse_code,
              greatest(progress.confirmed_quantity - progress.fulfilled_quantity - progress.cancelled_quantity - progress.reserved_quantity, 0) * line.conversion_factor AS quantity
         FROM tenant.sales_order_line_progress progress
         JOIN tenant.sales_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.sales_order_line_id
         JOIN tenant.sales_orders sales_order ON sales_order.organization_id = line.organization_id AND sales_order.current_version_id = line.sales_order_version_id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id)
        WHERE progress.organization_id = $1 AND line.item_id = $2 AND sales_order.lifecycle_status = 'confirmed'
          AND progress.confirmed_quantity - progress.fulfilled_quantity - progress.cancelled_quantity - progress.reserved_quantity > 0 ${scope("warehouse.id")}`)),
    ...(await query(
      `SELECT 'purchase_return' AS kind, purchase_return.id, purchase_return.return_number AS reference, warehouse.code AS warehouse_code, line.base_quantity AS quantity
         FROM tenant.purchase_returns purchase_return
         JOIN tenant.purchase_return_lines line ON line.organization_id = purchase_return.organization_id AND line.purchase_return_id = purchase_return.id
         JOIN tenant.goods_receipt_lines receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_line_id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id = receipt.organization_id AND warehouse.id = COALESCE(purchase_return.warehouse_id, receipt.warehouse_id)
        WHERE purchase_return.organization_id = $1 AND receipt.product_id = $2 AND purchase_return.document_status = 'draft' ${scope("warehouse.id")}`)),
  ];
  const batches = await query(
    `SELECT batch.id, batch.batch_number, batch.expires_on, batch.status, warehouse.code AS warehouse_code, sum(balance.quantity) AS on_hand, sum(balance.reserved_quantity) AS reserved,
            sum(CASE WHEN ${restrictedStockSql("location", "batch")} THEN 0 ELSE greatest(balance.quantity - balance.reserved_quantity, 0) END) AS free, bool_or(${expiredStockSql("batch")}) AS expired
       FROM tenant.stock_balances balance
       JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
      WHERE balance.organization_id = $1 AND balance.item_id = $2 ${scope("balance.warehouse_id")}
      GROUP BY batch.id, batch.batch_number, batch.expires_on, batch.status, warehouse.code HAVING sum(balance.quantity) <> 0 ORDER BY batch.expires_on NULLS LAST, batch.batch_number`);
  const serials = item.tracking_type === "serial" ? await query(
    `SELECT serial.id, serial.serial_number, serial.status, warehouse.code AS warehouse_code, COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number
       FROM tenant.stock_serials serial
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = serial.organization_id AND warehouse.id = serial.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = serial.organization_id AND batch.id = serial.batch_id
      WHERE serial.organization_id = $1 AND serial.item_id = $2 AND serial.status = 'available' ${scope("serial.warehouse_id")} ORDER BY serial.serial_number LIMIT 2000`) : [];
  // The latest movements come from the Stock Ledger itself (the one canonical query), for those who may see it.
  const movements = can(c, "stock.ledger.view") ? (await getStockLedger(client, c, { itemId, order: "desc", limit: 50 })).rows : [];
  const integrity = (await query(
    `SELECT (SELECT COALESCE(sum(quantity), 0) FROM tenant.stock_movements WHERE organization_id = $1 AND item_id = $2 ${scope("warehouse_id")}) AS ledger,
            (SELECT COALESCE(sum(quantity), 0) FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 ${scope("warehouse_id")}) AS projection,
            (SELECT COALESCE(sum(reserved_quantity), 0) FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 ${scope("warehouse_id")}) AS reserved,
            (SELECT COALESCE(sum(active_quantity), 0) FROM tenant.stock_reservations WHERE organization_id = $1 AND item_id = $2 AND status = 'active' ${scope("warehouse_id")}) AS reservations,
            (SELECT count(*) FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND status = 'available' ${scope("warehouse_id")}) AS serials`))[0];
  const outgoingTotal = n(outgoing.reduce((sum, row) => sum + Number(row.quantity), 0));
  // Negative stock is shown as it is (On Hand below zero; only Available is clamped), with what caused it.
  const negative = can(c, "stock.negative.view_warnings") ? {
    quantity: n(positions.reduce((sum, row) => sum + Number(row.negativeQuantity ?? 0), 0)), positions: positions.filter((row) => row.hasNegativeStock).length,
    exceptions: await openNegativeExceptions(client, c.organizationId, { itemId: item.id, warehouseIds: visible }),
  } : null;
  return {
    item: { id: item.id, sku: item.code, name: item.name, trackingType: item.tracking_type, baseUom: item.base_uom, tracked: item.track_inventory },
    summary: summary ? { ...summary, outgoing: outgoingTotal, otherOutgoing: n(outgoingTotal - n(summary.reserved)) } : null,
    warehouses, positions, negative,
    reservations: reservations.map((row) => ({ id: row.id, number: row.reservation_number, source: row.reference_type, document: row.sales_order_number, quantity: n(row.active_quantity),
      warehouse: row.warehouse_code, location: row.location_code, batch: row.batch_number, since: row.created_at })),
    incoming: incoming.map((row) => ({ kind: row.kind, id: row.id, reference: row.reference, warehouse: row.warehouse_code, quantity: n(row.quantity), expected: row.expected ?? null })),
    outgoing: outgoing.map((row) => ({ kind: row.kind, id: row.id, reference: row.reference, warehouse: row.warehouse_code, quantity: n(row.quantity) })),
    batches: batches.map((row) => ({ id: row.id, batch: row.batch_number, expiresOn: row.expires_on, status: row.status, warehouse: row.warehouse_code, onHand: n(row.on_hand),
      reserved: n(row.reserved), available: Math.max(n(row.free), 0), expired: Boolean(row.expired) })),
    serials: serials.map((row) => ({ id: row.id, serial: row.serial_number, warehouse: row.warehouse_code, location: row.location_code, batch: row.batch_number })),
    movements: movements.map((row) => ({ id: row.id, number: row.number, type: row.typeLabel, source: row.source.number, sourceHref: row.source.href, reason: row.reason,
      quantity: row.quantity, effectiveAt: row.effectiveAt, postedAt: row.postedAt, warehouse: row.warehouse, location: row.location, batch: row.serial ?? row.batch, balance: row.balance })),
    integrity: {
      ledger: n(integrity.ledger), projection: n(integrity.projection), reserved: n(integrity.reserved), reservations: n(integrity.reservations),
      serials: item.tracking_type === "serial" ? Number(integrity.serials) : null,
      consistent: Math.abs(n(integrity.ledger) - n(integrity.projection)) < 1e-6 && Math.abs(n(integrity.reserved) - n(integrity.reservations)) < 1e-6
        && (item.tracking_type !== "serial" || Number(integrity.serials) === n(integrity.projection)),
    },
  };
}

// ------------------------------------------------------------------ reconciliation and rebuild

// Positions whose projected quantity differs from the ledger (rows missing on either side included).
async function quantityDrift(client, c) {
  const { rows } = await client.query(
    `WITH ledger AS (
       SELECT item_id, warehouse_id, warehouse_location_id, batch_id, sum(quantity) AS quantity FROM tenant.stock_movements WHERE organization_id = $1
        GROUP BY item_id, warehouse_id, warehouse_location_id, batch_id)
     SELECT COALESCE(ledger.item_id, balance.item_id) AS item_id, COALESCE(ledger.warehouse_id, balance.warehouse_id) AS warehouse_id,
            COALESCE(ledger.warehouse_location_id, balance.warehouse_location_id) AS location_id, COALESCE(ledger.batch_id, balance.batch_id) AS batch_id,
            COALESCE(ledger.quantity, 0) AS ledger_quantity, COALESCE(balance.quantity, 0) AS balance_quantity
       FROM ledger FULL OUTER JOIN (SELECT * FROM tenant.stock_balances WHERE organization_id = $1) balance
         ON balance.item_id = ledger.item_id AND balance.warehouse_id = ledger.warehouse_id
        AND balance.warehouse_location_id IS NOT DISTINCT FROM ledger.warehouse_location_id AND balance.batch_id IS NOT DISTINCT FROM ledger.batch_id
      WHERE COALESCE(ledger.quantity, 0) <> COALESCE(balance.quantity, 0)`, [c.organizationId]);
  return rows.map((row) => ({ itemId: row.item_id, warehouseId: row.warehouse_id, locationId: row.location_id, batchId: row.batch_id,
    ledger: n(row.ledger_quantity), projection: n(row.balance_quantity), difference: n(Number(row.ledger_quantity) - Number(row.balance_quantity)) }));
}

// Balance rows whose reserved quantity differs from the active reservations held on them.
async function reservedDrift(client, c) {
  const { rows } = await client.query(
    `SELECT balance.id, balance.item_id, balance.warehouse_id, balance.warehouse_location_id, balance.batch_id, balance.reserved_quantity AS cached,
            COALESCE((SELECT sum(reservation.active_quantity) FROM tenant.stock_reservations reservation
                       WHERE reservation.organization_id = balance.organization_id AND reservation.item_id = balance.item_id AND reservation.warehouse_id = balance.warehouse_id
                         AND reservation.warehouse_location_id IS NOT DISTINCT FROM balance.warehouse_location_id AND reservation.batch_id IS NOT DISTINCT FROM balance.batch_id
                         AND reservation.status = 'active'), 0) AS actual
       FROM tenant.stock_balances balance WHERE balance.organization_id = $1`, [c.organizationId]);
  return rows.filter((row) => Math.abs(Number(row.cached) - Number(row.actual)) > 1e-6)
    .map((row) => ({ balanceId: row.id, itemId: row.item_id, warehouseId: row.warehouse_id, locationId: row.warehouse_location_id, batchId: row.batch_id,
      projection: n(row.cached), reservations: n(row.actual), difference: n(Number(row.actual) - Number(row.cached)) }));
}

// Serial-numbered stock whose on-hand quantity is not the number of serials in stock there (an identity defect: reported, never "repaired").
async function serialDrift(client, c) {
  const { rows } = await client.query(
    `WITH quantity AS (
       SELECT balance.item_id, balance.warehouse_id, sum(balance.quantity) AS on_hand FROM tenant.stock_balances balance
         JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id AND item.tracking_type = 'serial'
        WHERE balance.organization_id = $1 GROUP BY balance.item_id, balance.warehouse_id),
     serials AS (
       SELECT serial.item_id, serial.warehouse_id, count(*) AS in_stock FROM tenant.stock_serials serial
         JOIN tenant.items item ON item.organization_id = serial.organization_id AND item.id = serial.item_id AND item.tracking_type = 'serial'
        WHERE serial.organization_id = $1 AND serial.status = 'available' GROUP BY serial.item_id, serial.warehouse_id)
     SELECT COALESCE(quantity.item_id, serials.item_id) AS item_id, COALESCE(quantity.warehouse_id, serials.warehouse_id) AS warehouse_id,
            COALESCE(quantity.on_hand, 0) AS on_hand, COALESCE(serials.in_stock, 0) AS in_stock
       FROM quantity FULL OUTER JOIN serials ON serials.item_id = quantity.item_id AND serials.warehouse_id IS NOT DISTINCT FROM quantity.warehouse_id
      WHERE COALESCE(quantity.on_hand, 0) <> COALESCE(serials.in_stock, 0)`, [c.organizationId]);
  return rows.map((row) => ({ itemId: row.item_id, warehouseId: row.warehouse_id, onHand: n(row.on_hand), serialsInStock: Number(row.in_stock) }));
}

// Is the projection what the ledger and the reservations say? Every difference is listed; nothing is changed.
export async function reconcileInventoryBalances(client, c) {
  need(c, "stock.view");
  const [quantity, reservations, serials] = [await quantityDrift(client, c), await reservedDrift(client, c), await serialDrift(client, c)];
  const ineligible = (await client.query(
    `SELECT balance.item_id, balance.warehouse_id, balance.warehouse_location_id, balance.batch_id, balance.reserved_quantity, ${restrictionReasonSql("location", "batch")} AS reason
       FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND balance.reserved_quantity > 0 AND ${restrictedStockSql("location", "batch")}`, [c.organizationId])).rows
    .map((row) => ({ itemId: row.item_id, warehouseId: row.warehouse_id, locationId: row.warehouse_location_id, batchId: row.batch_id, reserved: n(row.reserved_quantity), reason: row.reason }));
  const checked = (await client.query(`SELECT count(*)::int AS rows, now() AS at FROM tenant.stock_balances WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { checkedAt: checked.at, checkedRows: checked.rows, consistent: !quantity.length && !reservations.length && !serials.length && !ineligible.length, quantity, reservations, serials,
    ineligibleReservations: ineligible };
}

// The reserved part only (Sales' reservation reconciliation repairs it when asked).
export async function reconcileReservedProjection(client, c, { repair = false } = {}) {
  need(c, "stock.view");
  const mismatches = await reservedDrift(client, c);
  if (repair && mismatches.length) {
    need(c, "stock.adjust", "You do not have permission to repair stock reservations.");
    for (const mismatch of mismatches)
      await client.query(`UPDATE tenant.stock_balances SET reserved_quantity = $3, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, mismatch.balanceId, mismatch.reservations]);
  }
  return { mismatchCount: mismatches.length, mismatches, repaired: repair ? mismatches.length : 0 };
}

// Rebuilds the projection from the ledger (quantities) and the active reservations (reserved), recording what changed and why. Average
// cost is left as it is: valuation owns it.
export async function rebuildInventoryBalanceProjection(client, c, input = {}) {
  need(c, "stock.balance.rebuild", "You do not have permission to rebuild stock balances.");
  const reason = text(input.reason, 500);
  if (!reason) throw new StockError(400, "Give the reason for rebuilding the stock balances.", "STOCK_REASON_REQUIRED");
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('stock-balance-rebuild:' || $1))`, [c.organizationId]);
  const quantity = await quantityDrift(client, c);
  // The rebuild reproduces the ledger exactly, a legitimately overridden negative position included: the negative-stock guard lets it through.
  await client.query(`SELECT set_config('vercent.negative_stock', 'rebuild', true)`);
  for (const entry of quantity)
    await client.query(
      `INSERT INTO tenant.stock_balances (organization_id, item_id, warehouse_id, warehouse_location_id, batch_id, quantity, reserved_quantity, average_cost, version)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 1)
       ON CONFLICT (organization_id, item_id, warehouse_id, warehouse_location_id, batch_id) DO UPDATE SET quantity = EXCLUDED.quantity, version = tenant.stock_balances.version + 1, updated_at = now()`,
      [c.organizationId, entry.itemId, entry.warehouseId, entry.locationId, entry.batchId, entry.ledger]);
  await client.query(`SELECT set_config('vercent.negative_stock', '', true)`);
  const reservations = await reservedDrift(client, c);
  for (const entry of reservations)
    await client.query(`UPDATE tenant.stock_balances SET reserved_quantity = $3, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, entry.balanceId, entry.reservations]);
  const record = (await client.query(
    `INSERT INTO tenant.stock_balance_rebuilds (organization_id, reason, quantity_corrections, reservation_corrections, details, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [c.organizationId, reason, quantity.length, reservations.length, JSON.stringify({ quantity: quantity.slice(0, 500), reservations: reservations.slice(0, 500) }), c.userId ?? null])).rows[0];
  return { id: record.id, rebuiltAt: record.created_at, quantityCorrections: quantity.length, reservationCorrections: reservations.length, quantity, reservations,
    after: await reconcileInventoryBalances(client, c) };
}

export async function listStockBalanceRebuilds(client, c) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT rebuild.*, actor.full_name AS actor_name FROM tenant.stock_balance_rebuilds rebuild LEFT JOIN public.users actor ON actor.id = rebuild.actor_user_id
      WHERE rebuild.organization_id = $1 ORDER BY rebuild.created_at DESC LIMIT 50`, [c.organizationId]);
  return rows.map((row) => ({ id: row.id, reason: row.reason, quantityCorrections: row.quantity_corrections, reservationCorrections: row.reservation_corrections,
    actorName: row.actor_name, createdAt: row.created_at }));
}

// What the stock screen needs to draw its filters.
export async function getStockBalanceOptions(client, c) {
  need(c, "stock.view");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY is_default DESC, name`,
    [c.organizationId, visible])).rows;
  const locations = (await client.query(`SELECT id, code, name, warehouse_id FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[]))
      ORDER BY code`, [c.organizationId, visible])).rows;
  const categories = (await client.query(`SELECT id, name FROM tenant.item_groups WHERE organization_id = $1 AND status = 'active' ORDER BY name`, [c.organizationId])).rows;
  return {
    views: STOCK_BALANCE_VIEWS, warehouses, locations: locations.map((row) => ({ id: row.id, code: row.code, name: row.name, warehouseId: row.warehouse_id })), categories,
    capabilities: { viewValue: can(c, "stock.valuation.view"), export: can(c, "stock.reports.view") || can(c, "stock.valuation.view"), rebuild: can(c, "stock.balance.rebuild"),
      transfer: can(c, "stock.transfer"), adjust: can(c, "stock.adjust") },
  };
}

// ------------------------------------------------------------------ Available Stock

const REASON_LABEL = Object.freeze({
  quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged", expired: "Expired", blocked: "Blocked batch", in_transit: "In transit", not_allocatable: "Not allocatable location",
  inactive_location: "Inactive location",
});

// Why an item's available quantity is what it is, per warehouse: physical on hand, less each restriction (by reason, with the locations and
// batches behind it), = eligible on hand, less the active reservations held on it (each with its document), = available. Serial-numbered
// items also say how many serials can actually be allocated. filters: { itemId, warehouseId? }.
export async function getAvailabilityBreakdown(client, c, { itemId, warehouseId = null } = {}) {
  need(c, "stock.view");
  if (!UUID.test(String(itemId ?? ""))) throw new StockError(400, "Item is not valid.", "STOCK_ITEM_NOT_FOUND");
  const item = (await client.query(`SELECT item.id, item.code, item.name, item.tracking_type, uom.code AS base_uom FROM tenant.items item
      LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id WHERE item.organization_id = $1 AND item.id = $2`, [c.organizationId, itemId])).rows[0];
  if (!item) throw new StockError(404, "Item not found.", "STOCK_ITEM_NOT_FOUND");
  const visible = await visibleWarehouseIds(client, c);
  const values = [c.organizationId, item.id, visible, warehouseId && UUID.test(warehouseId) ? warehouseId : null];
  const positions = (await client.query(
    `SELECT balance.warehouse_id, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number,
            balance.quantity, balance.reserved_quantity, ${restrictionReasonSql("location", "batch")} AS reason
       FROM tenant.stock_balances balance
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND balance.item_id = $2 AND ($3::uuid[] IS NULL OR balance.warehouse_id = ANY($3::uuid[])) AND ($4::uuid IS NULL OR balance.warehouse_id = $4)
        AND (balance.quantity <> 0 OR balance.reserved_quantity <> 0)
      ORDER BY warehouse.code, location.code NULLS FIRST, batch.batch_number NULLS FIRST`, values)).rows;
  const reservations = (await client.query(
    `SELECT reservation.warehouse_id, reservation.reservation_number, reservation.reference_type, reservation.active_quantity, sales_order.sales_order_number, transfer.document_number
       FROM tenant.stock_reservations reservation
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = reservation.organization_id AND sales_order.id = reservation.sales_order_id
       LEFT JOIN tenant.inventory_transfers transfer ON transfer.organization_id = reservation.organization_id AND reservation.reference_type = 'stock_transfer' AND transfer.id = reservation.reference_id
      WHERE reservation.organization_id = $1 AND reservation.item_id = $2 AND reservation.status = 'active' AND ($3::uuid[] IS NULL OR reservation.warehouse_id = ANY($3::uuid[]))
        AND ($4::uuid IS NULL OR reservation.warehouse_id = $4) ORDER BY reservation.created_at`, values)).rows;
  const serials = item.tracking_type === "serial" ? (await client.query(
    `SELECT serial.warehouse_id, count(*) FILTER (WHERE NOT ${restrictedStockSql("location", "batch")}) AS eligible
       FROM tenant.stock_serials serial
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = serial.organization_id AND batch.id = serial.batch_id
      WHERE serial.organization_id = $1 AND serial.item_id = $2 AND serial.status = 'available' AND ($3::uuid[] IS NULL OR serial.warehouse_id = ANY($3::uuid[]))
        AND ($4::uuid IS NULL OR serial.warehouse_id = $4) GROUP BY serial.warehouse_id`, values)).rows : [];
  const warehouses = new Map();
  for (const row of positions) {
    const entry = warehouses.get(row.warehouse_id) ?? { warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name, onHand: 0, restrictions: {},
      eligibleOnHand: 0, reserved: 0, reservedOnRestricted: 0, positions: [], reservations: [] };
    const quantity = Number(row.quantity);
    entry.onHand += quantity;
    if (row.reason) {
      const restriction = entry.restrictions[row.reason] ?? { reason: row.reason, label: REASON_LABEL[row.reason] ?? row.reason, quantity: 0, positions: [] };
      restriction.quantity += quantity;
      restriction.positions.push({ location: row.location_code, batch: row.batch_number, quantity: n(quantity) });
      entry.restrictions[row.reason] = restriction;
      entry.reservedOnRestricted += Number(row.reserved_quantity);
    } else {
      entry.eligibleOnHand += quantity;
      entry.reserved += Number(row.reserved_quantity);
    }
    entry.positions.push({ location: row.location_code, batch: row.batch_number, onHand: n(quantity), reserved: n(row.reserved_quantity), eligible: !row.reason,
      restriction: row.reason ? REASON_LABEL[row.reason] ?? row.reason : null });
    warehouses.set(row.warehouse_id, entry);
  }
  for (const row of reservations) {
    const entry = warehouses.get(row.warehouse_id);
    if (entry) entry.reservations.push({ number: row.reservation_number, source: row.reference_type, document: row.sales_order_number ?? row.document_number ?? null, quantity: n(row.active_quantity) });
  }
  const list = [...warehouses.values()].map((entry) => {
    const serial = serials.find((row) => row.warehouse_id === entry.warehouseId);
    const allocatableSerials = item.tracking_type === "serial" ? Math.max(Number(serial?.eligible ?? 0) - entry.reserved, 0) : null;
    const available = Math.max(entry.eligibleOnHand - entry.reserved, 0);
    return {
      ...entry, onHand: n(entry.onHand), eligibleOnHand: n(entry.eligibleOnHand), reserved: n(entry.reserved), reservedOnRestricted: n(entry.reservedOnRestricted),
      restricted: n(Object.values(entry.restrictions).reduce((sum, restriction) => sum + restriction.quantity, 0)),
      restrictions: Object.values(entry.restrictions).map((restriction) => ({ ...restriction, quantity: n(restriction.quantity) })),
      // A serial-numbered item cannot have more available than serials that can actually be allocated.
      available: n(allocatableSerials === null ? available : Math.min(available, allocatableSerials)), allocatableSerials,
    };
  });
  const sum = (key) => n(list.reduce((total, entry) => total + entry[key], 0));
  return {
    item: { id: item.id, sku: item.code, name: item.name, trackingType: item.tracking_type, baseUom: item.base_uom },
    warehouses: list,
    total: { onHand: sum("onHand"), restricted: sum("restricted"), eligibleOnHand: sum("eligibleOnHand"), reserved: sum("reserved"), available: sum("available") },
  };
}

// Can `quantity` (in `uomId`, converted exactly to the item's base unit first) be committed now from this warehouse (and location / batch)?
// Read-only: a transaction that commits stock reserves it atomically (reserveStock / reserveAvailableStock), never on the strength of this
// answer alone. Returns { ok, requested, available, shortfall, baseUom, message }.
export async function validateAvailableStock(client, c, input = {}) {
  need(c, "stock.view");
  if (!UUID.test(String(input.itemId ?? "")) || !UUID.test(String(input.warehouseId ?? ""))) throw new StockError(400, "Choose the item and the warehouse.", "STOCK_AVAILABILITY_SCOPE_REQUIRED");
  const unit = await normalizeQuantityToBase(client, c.organizationId, input.itemId, input.uomId || null, String(input.quantity ?? ""), { purpose: input.purpose ?? null });
  if (!unit.ok) throw new StockError(400, unit.message, unit.code ?? "STOCK_UOM_INVALID");
  const requested = Number(formatDecimal(unit.baseQuantity));
  const breakdown = await getAvailabilityBreakdown(client, c, { itemId: input.itemId, warehouseId: input.warehouseId });
  const warehouse = breakdown.warehouses.find((entry) => entry.warehouseId === input.warehouseId);
  let available = warehouse?.available ?? 0;
  if (input.locationId || input.batchId) {
    const position = (await client.query(
      `SELECT COALESCE(sum(greatest(balance.quantity - balance.reserved_quantity, 0)), 0) AS free FROM tenant.stock_balances balance
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
        WHERE balance.organization_id = $1 AND balance.item_id = $2 AND balance.warehouse_id = $3 AND NOT ${restrictedStockSql("location", "batch")}
          AND ($4::uuid IS NULL OR balance.warehouse_location_id = $4 OR (balance.warehouse_location_id IS NULL AND location.id IS NULL
               AND EXISTS (SELECT 1 FROM tenant.warehouse_locations main WHERE main.organization_id = $1 AND main.id = $4 AND main.is_default_storage)))
          AND ($5::uuid IS NULL OR balance.batch_id = $5)`,
      [c.organizationId, input.itemId, input.warehouseId, input.locationId || null, input.batchId || null])).rows[0];
    available = Math.min(available, n(position.free));
  }
  const shortfall = n(Math.max(requested - available, 0));
  const entered = `${formatDecimal(unit.quantity).replace(/\.?0+$/, "")} ${unit.unit.code}`;
  return {
    ok: shortfall === 0, requested, available, shortfall, baseUom: breakdown.item.baseUom, entered, conversion: Number(formatDecimal(unit.factor)),
    message: shortfall === 0 ? null : `${shortfall} ${breakdown.item.baseUom ?? ""} exceed current availability (requested ${entered} = ${requested} ${breakdown.item.baseUom ?? ""}, available ${available}).`.replace(/\s+/g, " "),
  };
}

// ------------------------------------------------------------------ Reserved Stock

const SOURCE_LABEL = Object.freeze({ sales_order_line: "Sales order", sales_order: "Sales order", stock_transfer: "Internal transfer", purchase_return: "Purchase return",
  manufacturing_work_order: "Work order" });
const RESERVATION_SELECT = `
  SELECT reservation.*, item.code AS sku, item.name AS item_name, uom.code AS base_uom, warehouse.code AS warehouse_code, warehouse.status AS warehouse_status, COALESCE(location.code, 'MAIN') AS location_code,
         batch.batch_number, serial.serial_number, serial.status AS serial_status, serial.warehouse_id AS serial_warehouse_id, reserver.full_name AS reserved_by_name,
         COALESCE(sales_order.sales_order_number, line_order.sales_order_number, transfer.document_number, purchase_return.return_number, work_order.work_order_number) AS document_number,
         COALESCE(sales_order.id, line_order.id, transfer.id, purchase_return.id, work_order.id) AS document_id,
         ${restrictedStockSql("location", "batch")} AS ineligible, ${restrictionReasonSql("location", "batch")} AS ineligible_reason
    FROM tenant.stock_reservations reservation
    JOIN tenant.items item ON item.organization_id = reservation.organization_id AND item.id = reservation.item_id
    LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = reservation.organization_id AND warehouse.id = reservation.warehouse_id
    LEFT JOIN tenant.warehouse_locations location ON location.organization_id = reservation.organization_id AND location.id = reservation.warehouse_location_id
    LEFT JOIN tenant.stock_batches batch ON batch.organization_id = reservation.organization_id AND batch.id = reservation.batch_id
    LEFT JOIN tenant.stock_serials serial ON serial.organization_id = reservation.organization_id AND serial.id = reservation.serial_id
    LEFT JOIN public.users reserver ON reserver.id = reservation.reserved_by
    LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = reservation.organization_id AND reservation.reference_type = 'sales_order' AND sales_order.id = reservation.reference_id
    LEFT JOIN tenant.sales_orders line_order ON line_order.organization_id = reservation.organization_id AND reservation.reference_type = 'sales_order_line' AND line_order.id = reservation.sales_order_id
    LEFT JOIN tenant.inventory_transfers transfer ON transfer.organization_id = reservation.organization_id AND reservation.reference_type = 'stock_transfer' AND transfer.id = reservation.reference_id
    LEFT JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = reservation.organization_id AND reservation.reference_type = 'purchase_return' AND purchase_return.id = reservation.reference_id
    LEFT JOIN tenant.manufacturing_work_orders work_order ON work_order.organization_id = reservation.organization_id AND reservation.reference_type = 'manufacturing_work_order' AND work_order.id = reservation.reference_id`;

function toReservation(row) {
  return {
    id: row.id, number: row.reservation_number, reservationId: row.inventory_reservation_id, status: row.status, itemId: row.item_id, sku: row.sku, itemName: row.item_name, baseUom: row.base_uom,
    source: row.reference_type, sourceLabel: SOURCE_LABEL[row.reference_type] ?? row.reference_type, sourceId: row.reference_id, document: row.document_number, documentId: row.document_id,
    warehouseId: row.warehouse_id, warehouse: row.warehouse_code, location: row.location_code, batch: row.batch_number, serial: row.serial_number,
    allocation: row.serial_number ? `Serial ${row.serial_number}` : row.batch_number ? `Batch ${row.batch_number}` : row.warehouse_location_id ? `Location ${row.location_code}` : "Warehouse",
    quantity: n(row.quantity), active: n(row.active_quantity), consumed: n(row.consumed_quantity), released: n(row.released_quantity),
    salesQuantity: row.sales_quantity === null ? null : n(row.sales_quantity), salesUom: row.sales_uom, expiresAt: row.expires_at, reservedBy: row.reserved_by_name, createdAt: row.created_at,
    releasedAt: row.released_at, releaseReasonCode: row.release_reason_code, releaseReason: row.release_reason,
    eligible: row.status !== "active" || !row.ineligible, ineligibleReason: row.status === "active" && row.ineligible ? row.ineligible_reason : null,
  };
}

// One allocation (RSV-…) of a reservation: where it holds stock, quantities, source, its history and what consumed it.
export async function getReservation(client, c, reservationId) {
  need(c, "stock.view");
  if (!UUID.test(String(reservationId ?? ""))) throw new StockError(400, "Reservation is not valid.", "STOCK_RESERVATION_NOT_FOUND");
  const visible = await visibleWarehouseIds(client, c);
  const row = (await client.query(`${RESERVATION_SELECT} WHERE reservation.organization_id = $1 AND reservation.id = $2 AND ($3::uuid[] IS NULL OR reservation.warehouse_id = ANY($3::uuid[]))`,
    [c.organizationId, reservationId, visible])).rows[0];
  if (!row) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  const events = (await client.query(
    `SELECT event.*, actor.full_name AS actor_name FROM tenant.stock_reservation_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.reservation_id = $2 ORDER BY event.created_at, event.id`, [c.organizationId, row.id])).rows;
  const consumptions = (await client.query(
    `SELECT consumption.quantity, consumption.consumed_at AS created_at, movement.movement_number, delivery.request_number AS delivery_number
       FROM tenant.stock_reservation_consumptions consumption
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = consumption.organization_id AND movement.id = consumption.stock_movement_id
       LEFT JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = consumption.organization_id AND delivery.id = consumption.delivery_id
      WHERE consumption.organization_id = $1 AND consumption.reservation_id = $2 ORDER BY consumption.consumed_at`, [c.organizationId, row.id])).rows;
  return {
    ...toReservation(row),
    history: events.map((event) => ({ id: event.id, type: event.event_type, quantity: n(event.quantity), activeAfter: n(event.active_after), reasonCode: event.reason_code, reason: event.reason,
      details: event.details, actor: event.actor_name, at: event.created_at })),
    consumptions: consumptions.map((entry) => ({ quantity: n(entry.quantity), at: entry.created_at, movement: entry.movement_number, delivery: entry.delivery_number })),
    capabilities: { release: can(c, "stock.reservation.release"), reallocate: can(c, "stock.reservation.reallocate") },
  };
}

// What needs attention: reservations on stock that is no longer eligible, in an inactive warehouse, on a serial no longer in stock, for a
// source that is no longer open, or holding more than the source still needs; and a reserved projection that differs from the reservations.
export async function getReservationExceptions(client, c) {
  need(c, "stock.view");
  const visible = await visibleWarehouseIds(client, c);
  const scope = `($2::uuid[] IS NULL OR reservation.warehouse_id = ANY($2::uuid[]))`;
  const rows = (await client.query(`${RESERVATION_SELECT} WHERE reservation.organization_id = $1 AND reservation.status = 'active' AND ${scope}`,
    [c.organizationId, visible])).rows;
  const exceptions = [];
  const add = (row, kind, message) => exceptions.push({ kind, message, reservation: toReservation(row) });
  for (const row of rows) {
    if (row.ineligible) add(row, "ineligible", `Reserved stock is no longer eligible (${String(row.ineligible_reason).replace(/_/g, " ")}): reallocate or release it.`);
    if (row.warehouse_status !== "active") add(row, "warehouse_inactive", "The warehouse is inactive.");
    if (row.serial_id && (row.serial_status !== "available" || row.serial_warehouse_id !== row.warehouse_id))
      add(row, "serial_missing", `Serial ${row.serial_number ?? ""} is no longer in stock here: reallocate the reservation to another serial number or release it.`.replace("Serial  ", "The serial "));
  }
  const stale = (await client.query(
    `SELECT reservation.id FROM tenant.stock_reservations reservation
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = reservation.organization_id AND sales_order.id = COALESCE(reservation.sales_order_id, CASE WHEN reservation.reference_type = 'sales_order' THEN reservation.reference_id END)
       LEFT JOIN tenant.inventory_transfers transfer ON transfer.organization_id = reservation.organization_id AND reservation.reference_type = 'stock_transfer' AND transfer.id = reservation.reference_id
       LEFT JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = reservation.organization_id AND reservation.reference_type = 'purchase_return' AND purchase_return.id = reservation.reference_id
      WHERE reservation.organization_id = $1 AND reservation.status = 'active' AND ${scope}
        AND ((reservation.reference_type IN ('sales_order', 'sales_order_line') AND COALESCE(sales_order.lifecycle_status, 'missing') <> 'confirmed')
          OR (reservation.reference_type = 'stock_transfer' AND COALESCE(transfer.status, 'missing') NOT IN ('draft', 'confirmed'))
          OR (reservation.reference_type = 'purchase_return' AND COALESCE(purchase_return.document_status, 'missing') <> 'draft'))`, [c.organizationId, visible])).rows.map((row) => row.id);
  for (const row of rows.filter((entry) => stale.includes(entry.id))) add(row, "source_closed", "The source document is no longer open, but the reservation is still active.");
  const excess = (await client.query(
    `SELECT reservation.sales_order_line_id, sum(reservation.active_quantity) AS reserved,
            greatest(progress.confirmed_quantity - progress.fulfilled_quantity - progress.cancelled_quantity, 0) * line.conversion_factor AS open
       FROM tenant.stock_reservations reservation
       JOIN tenant.sales_order_lines line ON line.organization_id = reservation.organization_id AND line.id = reservation.sales_order_line_id
       JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
      WHERE reservation.organization_id = $1 AND reservation.status = 'active' AND ${scope}
      GROUP BY reservation.sales_order_line_id, progress.confirmed_quantity, progress.fulfilled_quantity, progress.cancelled_quantity, line.conversion_factor
     HAVING sum(reservation.active_quantity) > greatest(progress.confirmed_quantity - progress.fulfilled_quantity - progress.cancelled_quantity, 0) * line.conversion_factor + 0.000001`,
    [c.organizationId, visible])).rows;
  for (const entry of excess) {
    const row = rows.find((candidate) => candidate.sales_order_line_id === entry.sales_order_line_id);
    if (row) add(row, "exceeds_demand", `${n(entry.reserved)} is reserved but the order line still needs only ${n(entry.open)}.`);
  }
  // A position holding less stock than is reserved there (counted short, moved by a correction): the reservations cannot all be fulfilled.
  const short = (await client.query(
    `SELECT balance.item_id, balance.warehouse_id, balance.warehouse_location_id, balance.batch_id, balance.quantity FROM tenant.stock_balances balance
      WHERE balance.organization_id = $1 AND balance.reserved_quantity > balance.quantity + 0.000001 AND ($2::uuid[] IS NULL OR balance.warehouse_id = ANY($2::uuid[]))`,
    [c.organizationId, visible])).rows;
  for (const position of short)
    for (const row of rows.filter((entry) => entry.item_id === position.item_id && entry.warehouse_id === position.warehouse_id
      && (entry.warehouse_location_id ?? null) === (position.warehouse_location_id ?? null) && (entry.batch_id ?? null) === (position.batch_id ?? null)))
      add(row, "stock_short", `Only ${n(position.quantity)} is on hand where this is reserved: reallocate or release part of it.`);
  const projection = await reconcileReservedProjection(client, c);
  return { exceptions, projectionMismatches: projection.mismatches, count: exceptions.length + projection.mismatchCount };
}
