import { StockError } from "./index.js";

// Valuation, aging and movement reports plus landed-cost allocation (F133-F138).
// Value is read from the FIFO layers for FIFO items (newest layers make up the quantity on hand, the
// same result as consuming the oldest first) and from the carried average / standard cost otherwise.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new StockError(400, `${label} is invalid.`, "STOCK_REFERENCE_INVALID");
  return String(value);
};
const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p)) throw new StockError(403, "You do not have permission to perform this stock operation.", "STOCK_FORBIDDEN");
};
// Per (item, warehouse): quantity on hand, and its value. FIFO items are valued from layers:
// walking layers newest -> oldest, each contributes min(remaining, still-needed) at its unit cost.
const POSITION_SQL = `
  WITH position AS (
    SELECT balance.item_id,balance.warehouse_id,sum(balance.quantity) AS on_hand,sum(balance.reserved_quantity) AS reserved,
           sum(balance.quantity*balance.average_cost) AS carried_value
      FROM tenant.stock_balances balance
     WHERE balance.organization_id=$1
     GROUP BY balance.item_id,balance.warehouse_id
    HAVING sum(balance.quantity)<>0
  ),
  layered AS (
    SELECT layer.item_id,layer.warehouse_id,layer.remaining_quantity,layer.unit_cost,layer.created_at,
           COALESCE(sum(layer.remaining_quantity) OVER (PARTITION BY layer.item_id,layer.warehouse_id ORDER BY layer.created_at DESC,layer.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS newer_quantity
      FROM tenant.stock_valuation_layers layer
     WHERE layer.organization_id=$1 AND layer.remaining_quantity>0
  ),
  fifo AS (
    SELECT layered.item_id,layered.warehouse_id,layered.created_at,layered.unit_cost,
           LEAST(layered.remaining_quantity,GREATEST(position.on_hand-layered.newer_quantity,0)) AS quantity
      FROM layered JOIN position ON position.item_id=layered.item_id AND position.warehouse_id=layered.warehouse_id
  )`;

export async function getStockValuationReport(client, c, { warehouseId = null, groupId = null } = {}) {
  need(c, "stock.valuation.view");
  const values = [c.organizationId];
  let filter = "";
  if (warehouseId) { values.push(uuid(warehouseId, "Warehouse")); filter += ` AND position.warehouse_id=$${values.length}`; }
  if (groupId) { values.push(uuid(groupId, "Category")); filter += ` AND item.group_id=$${values.length}`; }
  const { rows } = await client.query(
    `${POSITION_SQL}
     SELECT item.id AS item_id,item.code AS item_code,item.name AS item_name,warehouse.id AS warehouse_id,warehouse.name AS warehouse_name,
            CASE WHEN item.valuation_method<>'moving_average' THEN item.valuation_method ELSE COALESCE(settings.costing_method,'moving_average') END AS method,
            position.on_hand::text AS on_hand_quantity,position.reserved::text AS reserved_quantity,
            CASE WHEN CASE WHEN item.valuation_method<>'moving_average' THEN item.valuation_method ELSE COALESCE(settings.costing_method,'moving_average') END='fifo'
                 THEN COALESCE((SELECT sum(fifo.quantity*fifo.unit_cost) FROM fifo WHERE fifo.item_id=position.item_id AND fifo.warehouse_id=position.warehouse_id),position.carried_value)
                 ELSE position.carried_value END::text AS stock_value
       FROM position
       JOIN tenant.items item ON item.organization_id=$1 AND item.id=position.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id=$1 AND warehouse.id=position.warehouse_id
       LEFT JOIN tenant.stock_settings settings ON settings.organization_id=$1
      WHERE true${filter}
      ORDER BY item.name,warehouse.name`,
    values,
  );
  const lines = rows.map((row) => ({ ...row, unit_value: Number(row.on_hand_quantity) ? String(Number(row.stock_value) / Number(row.on_hand_quantity)) : "0" }));
  const byMethod = {};
  let total = 0;
  for (const line of lines) {
    byMethod[line.method] = (byMethod[line.method] || 0) + Number(line.stock_value);
    total += Number(line.stock_value);
  }
  return { lines, totals: { stockValue: String(total), byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, String(v)])) } };
}

// Movement summary (F137): what came in, went out and was adjusted over a period, per item.
export async function getStockMovementSummary(client, c, { from = null, to = null, warehouseId = null } = {}) {
  need(c, "stock.reports.view");
  const values = [c.organizationId];
  let filter = "";
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (from) { if (!day.test(String(from))) throw new StockError(400, "From date is invalid.", "STOCK_DATE_INVALID"); values.push(String(from)); filter += ` AND movement.occurred_at>=$${values.length}::date`; }
  if (to) { if (!day.test(String(to))) throw new StockError(400, "To date is invalid.", "STOCK_DATE_INVALID"); values.push(String(to)); filter += ` AND movement.occurred_at<($${values.length}::date+1)`; }
  if (warehouseId) { values.push(uuid(warehouseId, "Warehouse")); filter += ` AND movement.warehouse_id=$${values.length}`; }
  const { rows } = await client.query(
    `SELECT item.id AS item_id,item.code AS item_code,item.name AS item_name,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.movement_type IN ('receipt','return') AND movement.quantity>0),0)::text AS received_quantity,
            COALESCE(-sum(movement.quantity) FILTER (WHERE movement.movement_type='issue'),0)::text AS issued_quantity,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.movement_type IN ('adjustment','count')),0)::text AS adjusted_quantity,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.movement_type='transfer'),0)::text AS transfer_quantity,
            COALESCE(sum(movement.quantity),0)::text AS net_quantity,
            COALESCE(sum(movement.cost_variance),0)::text AS cost_variance,
            count(*)::int AS movements
       FROM tenant.stock_movements movement JOIN tenant.items item ON item.organization_id=movement.organization_id AND item.id=movement.item_id
      WHERE movement.organization_id=$1${filter}
      GROUP BY item.id,item.code,item.name ORDER BY item.name`,
    values,
  );
  const showValue = has(c, "stock.valuation.view");
  return { lines: showValue ? rows : rows.map((row) => ({ ...row, cost_variance: null })) };
}

