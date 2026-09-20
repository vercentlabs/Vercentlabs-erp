import { StockError } from "./index.js";

// Read models for the Inventory screens: names joined in, filters applied in SQL, and cost
// removed server-side for callers without stock.valuation.view.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new StockError(400, `${label} is invalid.`, "STOCK_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p)) throw new StockError(403, "You do not have permission to perform this stock operation.", "STOCK_FORBIDDEN");
};
const canSeeValue = (c) => has(c, "stock.valuation.view");
const clampLimit = (value, fallback = 250) => Math.min(Math.max(Number(value) || fallback, 1), 500);

export async function listStockBalancesDetailed(client, c, { itemId = null, warehouseId = null, search = "", limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (itemId) { values.push(uuid(itemId, "Item")); filter += ` AND balance.item_id=$${values.length}`; }
  if (warehouseId) { values.push(uuid(warehouseId, "Warehouse")); filter += ` AND balance.warehouse_id=$${values.length}`; }
  if (text(search)) { values.push(`%${text(search).replace(/[%_\\]/g, "\\$&")}%`); filter += ` AND (item.code ILIKE $${values.length} OR item.name ILIKE $${values.length})`; }
  values.push(clampLimit(limit));
  const { rows } = await client.query(
    `SELECT balance.id,balance.item_id,item.code AS item_code,item.name AS item_name,item.tracking_type,balance.warehouse_id,warehouse.name AS warehouse_name,
            balance.warehouse_location_id,location.code AS location_code,balance.batch_id,batch.batch_number,batch.expires_on,
            balance.quantity::text AS on_hand_quantity,balance.reserved_quantity::text AS reserved_quantity,(balance.quantity-balance.reserved_quantity)::text AS available_quantity,
            balance.average_cost::text AS average_cost,(balance.quantity*balance.average_cost)::text AS stock_value
       FROM tenant.stock_balances balance
       JOIN tenant.items item ON item.organization_id=balance.organization_id AND item.id=balance.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id=balance.organization_id AND warehouse.id=balance.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
      WHERE balance.organization_id=$1 AND balance.company_id=$2${filter}
      ORDER BY item.name,warehouse.name,location.code NULLS FIRST,batch.batch_number NULLS FIRST
      LIMIT $${values.length}`,
    values,
  );
  if (canSeeValue(c)) return rows;
  return rows.map((row) => ({ ...row, average_cost: null, stock_value: null }));
}

export async function listStockLedger(client, c, { itemId = null, warehouseId = null, movementType = null, referenceType = null, referenceId = null, limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (itemId) { values.push(uuid(itemId, "Item")); filter += ` AND movement.item_id=$${values.length}`; }
  if (warehouseId) { values.push(uuid(warehouseId, "Warehouse")); filter += ` AND movement.warehouse_id=$${values.length}`; }
  if (movementType) { values.push(String(movementType)); filter += ` AND movement.movement_type=$${values.length}`; }
  if (referenceType) { values.push(text(referenceType, 200).split(",").map((t) => t.trim()).filter(Boolean)); filter += ` AND movement.reference_type=ANY($${values.length}::text[])`; }
  if (referenceId) { values.push(uuid(referenceId, "Reference")); filter += ` AND movement.reference_id=$${values.length}`; }
  values.push(clampLimit(limit));
  const { rows } = await client.query(
    `SELECT movement.id,movement.movement_number,movement.movement_type,movement.item_id,item.code AS item_code,item.name AS item_name,movement.warehouse_id,warehouse.name AS warehouse_name,
            location.code AS location_code,batch.batch_number,serial.serial_number,movement.quantity::text AS quantity,movement.unit_cost::text AS unit_cost,
            movement.reference_type,movement.reference_id,movement.reason,movement.occurred_at,movement.created_by
       FROM tenant.stock_movements movement
       JOIN tenant.items item ON item.organization_id=movement.organization_id AND item.id=movement.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id=movement.organization_id AND warehouse.id=movement.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=movement.organization_id AND location.id=movement.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=movement.organization_id AND batch.id=movement.batch_id
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id=movement.organization_id AND serial.id=movement.serial_id
      WHERE movement.organization_id=$1 AND movement.company_id=$2${filter}
      ORDER BY movement.occurred_at DESC,movement.movement_number DESC
      LIMIT $${values.length}`,
    values,
  );
  if (canSeeValue(c)) return rows;
  return rows.map((row) => ({ ...row, unit_cost: null }));
}

export async function listStockTransfersDetailed(client, c, { status = null, limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (status) { values.push(String(status)); filter = ` AND transfer.status=$${values.length}`; }
  values.push(clampLimit(limit));
  const { rows } = await client.query(
    `SELECT transfer.id,transfer.transfer_number,transfer.status,transfer.quantity::text AS quantity,transfer.item_id,item.code AS item_code,item.name AS item_name,
            transfer.source_warehouse_id,source.name AS source_warehouse_name,transfer.destination_warehouse_id,destination.name AS destination_warehouse_name,
            transfer.requested_by,transfer.completed_by,transfer.completed_at,transfer.created_at
       FROM tenant.stock_transfers transfer
       JOIN tenant.items item ON item.organization_id=transfer.organization_id AND item.id=transfer.item_id
       JOIN tenant.warehouses source ON source.organization_id=transfer.organization_id AND source.id=transfer.source_warehouse_id
       JOIN tenant.warehouses destination ON destination.organization_id=transfer.organization_id AND destination.id=transfer.destination_warehouse_id
      WHERE transfer.organization_id=$1 AND transfer.company_id=$2${filter}
      ORDER BY transfer.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

export async function listStockReservationsDetailed(client, c, { status = null, limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (status) { values.push(String(status)); filter = ` AND reservation.status=$${values.length}`; }
  values.push(clampLimit(limit));
  const { rows } = await client.query(
    `SELECT reservation.id,reservation.status,reservation.quantity::text AS quantity,reservation.item_id,item.code AS item_code,item.name AS item_name,reservation.warehouse_id,warehouse.name AS warehouse_name,
            batch.batch_number,reservation.reference_type,reservation.reference_id,reservation.reserved_by,reservation.created_at,reservation.released_at
       FROM tenant.stock_reservations reservation
       JOIN tenant.items item ON item.organization_id=reservation.organization_id AND item.id=reservation.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id=reservation.organization_id AND warehouse.id=reservation.warehouse_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=reservation.organization_id AND batch.id=reservation.batch_id
      WHERE reservation.organization_id=$1 AND reservation.company_id=$2${filter}
      ORDER BY reservation.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}
