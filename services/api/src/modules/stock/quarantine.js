import { StockError } from "./index.js";

// Quarantine / quality-held stock (F140).
const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p)) throw new StockError(403, "You do not have permission to perform this stock operation.", "STOCK_FORBIDDEN");
};

// Stock held by Quality (active holds) and stock sitting in quality-type locations.
export async function listStockQuarantine(client, c) {
  need(c, "stock.view");
  const holds = (
    await client.query(
      `SELECT hold.id,hold.hold_number,hold.hold_type,hold.reason,hold.placed_at,hold.quantity::text AS quantity,hold.released_quantity::text AS released_quantity,
              item.code AS item_code,item.name AS item_name,warehouse.name AS warehouse_name,batch.batch_number,serial.serial_number,'hold' AS source
         FROM tenant.quality_holds hold JOIN tenant.items item ON item.organization_id=hold.organization_id AND item.id=hold.item_id
         LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id=hold.organization_id AND warehouse.id=hold.warehouse_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id=hold.organization_id AND batch.id=hold.batch_id
         LEFT JOIN tenant.stock_serials serial ON serial.organization_id=hold.organization_id AND serial.id=hold.serial_id
        WHERE hold.organization_id=$1 AND hold.status='active' ORDER BY hold.placed_at DESC LIMIT 250`,
      [c.organizationId],
    )
  ).rows;
  const located = (
    await client.query(
      `SELECT balance.id,item.code AS item_code,item.name AS item_name,warehouse.name AS warehouse_name,location.code AS location_code,batch.batch_number,balance.quantity::text AS quantity
         FROM tenant.stock_balances balance JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id AND location.location_type='quality'
         JOIN tenant.items item ON item.organization_id=balance.organization_id AND item.id=balance.item_id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id=balance.organization_id AND warehouse.id=balance.warehouse_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
        WHERE balance.organization_id=$1 AND balance.quantity>0 ORDER BY item.name LIMIT 250`,
      [c.organizationId],
    )
  ).rows;
  return { holds, located };
}

