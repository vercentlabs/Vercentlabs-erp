// Stock positions as the stock documents that take stock out (Goods Issues, Internal Transfers) see them: what a position holds, how much of it
// is not reserved, and its disposition for moving — a quality location's disposition, "expired" for a batch past its date or blocked, or
// "restricted" for a position nothing may take from (not allocatable, inactive, in transit).
import { decimal, sub } from "../../core/decimal.js";
import { restrictedStockSql } from "./rules.js";

const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);

export const DISPOSITION_SQL = (location = "location", batch = "batch") => `CASE
     WHEN COALESCE(${location}.disposition, 'available') <> 'available' THEN ${location}.disposition
     WHEN COALESCE(${location}.location_type, '') = 'quality' OR COALESCE(${location}.purpose, '') = 'quality_hold' THEN 'quality_hold'
     WHEN COALESCE(${batch}.status, 'active') <> 'active' OR COALESCE(${batch}.expires_on < current_date, false) THEN 'expired'
     WHEN ${restrictedStockSql(location, batch)} THEN 'restricted'
     ELSE 'available' END`;

// One position: { quantity, reserved, free (not reserved), disposition } as decimals. locationId null is MAIN.
export async function positionOf(client, c, { itemId, warehouseId, locationId, batchId }) {
  const row = (await client.query(
    `SELECT COALESCE(balance.quantity, 0) AS quantity, COALESCE(balance.reserved_quantity, 0) AS reserved, ${DISPOSITION_SQL()} AS disposition
       FROM (SELECT 1) anchor
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = $1 AND location.id = $4
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = $1 AND batch.id = $5
       LEFT JOIN tenant.stock_balances balance ON balance.organization_id = $1 AND balance.item_id = $2 AND balance.warehouse_id = $3
            AND balance.warehouse_location_id IS NOT DISTINCT FROM $4 AND balance.batch_id IS NOT DISTINCT FROM $5`,
    [c.organizationId, itemId, warehouseId, locationId, batchId])).rows[0];
  return { quantity: decimal(row.quantity), reserved: decimal(row.reserved), free: sub(decimal(row.quantity), decimal(row.reserved)), disposition: row.disposition };
}

// An item's positions in a warehouse (on hand, reserved, available, disposition, batch), its serial numbers in stock (reserved ones marked) and
// the warehouse totals — for the line editors.
export async function itemPositions(client, c, { warehouseId, itemId }) {
  const rows = (await client.query(
    `SELECT balance.warehouse_location_id AS location_id, COALESCE(location.code, 'MAIN') AS location_code, balance.batch_id, batch.batch_number, batch.expires_on,
            balance.quantity, balance.reserved_quantity, ${DISPOSITION_SQL()} AS disposition
       FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND balance.item_id = $2 AND balance.warehouse_id = $3 AND balance.quantity <> 0
      ORDER BY location.code NULLS FIRST, batch.expires_on NULLS LAST, batch.batch_number`, [c.organizationId, itemId, warehouseId])).rows;
  const positions = rows.map((row) => ({ locationId: row.location_id, location: row.location_code, batchId: row.batch_id, batch: row.batch_number, expiresOn: dayOf(row.expires_on),
    disposition: row.disposition, onHand: n(row.quantity), reserved: n(row.reserved_quantity), available: n(Math.max(Number(row.quantity) - Number(row.reserved_quantity), 0)) }));
  const serials = (await client.query(
    `SELECT serial.id, serial.serial_number, serial.warehouse_location_id AS location_id, serial.batch_id,
            EXISTS (SELECT 1 FROM tenant.stock_reservations reservation WHERE reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id
              AND reservation.status = 'active') AS reserved
       FROM tenant.stock_serials serial WHERE serial.organization_id = $1 AND serial.item_id = $2 AND serial.warehouse_id = $3 AND serial.status = 'available' ORDER BY serial.serial_number`,
    [c.organizationId, itemId, warehouseId])).rows;
  return {
    positions, serials: serials.map((row) => ({ id: row.id, serialNumber: row.serial_number, locationId: row.location_id, batchId: row.batch_id, reserved: row.reserved })),
    totals: { onHand: n(positions.reduce((sum, row) => sum + row.onHand, 0)), reserved: n(positions.reduce((sum, row) => sum + row.reserved, 0)),
      available: n(positions.filter((row) => row.disposition === "available").reduce((sum, row) => sum + row.available, 0)) },
  };
}

// Stock moves only out of (or into) an active batch; a batch marked expired or blocked is moved — disposed of, transferred as it is, brought
// back — by activating it for the movement and restoring its status straight after, in the same transaction.
export async function withActiveBatch(client, c, batchId, work) {
  if (!batchId) return work();
  const status = (await client.query(`SELECT status FROM tenant.stock_batches WHERE organization_id = $1 AND id = $2`, [c.organizationId, batchId])).rows[0]?.status;
  if (!status || status === "active") return work();
  await client.query(`UPDATE tenant.stock_batches SET status = 'active' WHERE organization_id = $1 AND id = $2`, [c.organizationId, batchId]);
  const result = await work();
  await client.query(`UPDATE tenant.stock_batches SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, batchId, status]);
  return result;
}
