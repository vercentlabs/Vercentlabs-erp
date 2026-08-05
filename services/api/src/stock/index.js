export class StockError extends Error {
  constructor(status, message, code = "STOCK_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0)
    throw new StockError(400, `${name} must be greater than zero.`);
  return n;
};
const has = (c, p) =>
  c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p))
    throw new StockError(
      403,
      "You do not have permission to perform this stock operation.",
    );
};
export function stockContext(session) {
  const companyId = session.activeCompanyId || session.companyId;
  if (!companyId) {
    throw new StockError(400, "Select an active company before using Stock.", "ACTIVE_COMPANY_REQUIRED");
  }
  return {
    organizationId: session.organizationId,
    companyId,
    userId: session.userId,
    permissions: session.permissions || [],
    roleSlugs: session.roleSlugs || [],
  };
}
export async function getStockDashboard(client, c) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT COALESCE(sum(quantity),0)::text total_quantity,COALESCE(sum(quantity*average_cost),0)::text inventory_value,COALESCE(sum(reserved_quantity),0)::text reserved_quantity,count(DISTINCT item_id)::int stocked_items,count(DISTINCT warehouse_id)::int warehouses FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2`,
    [c.organizationId, c.companyId],
  );
  const low = await client.query(
    `SELECT count(*)::int count FROM tenant.stock_reorder_rules r LEFT JOIN tenant.stock_balances b ON b.organization_id=r.organization_id AND b.company_id=r.company_id AND b.item_id=r.item_id AND b.warehouse_id=r.warehouse_id WHERE r.organization_id=$1 AND r.company_id=$2 AND r.active AND COALESCE(b.quantity-b.reserved_quantity,0)<=r.minimum_quantity`,
    [c.organizationId, c.companyId],
  );
  return { ...rows[0], low_stock_items: low.rows[0].count };
}
export async function listStockResource(
  client,
  c,
  resource,
  { limit = 100, offset = 0 } = {},
) {
  need(c, "stock.view");
  const tables = {
    balances: "stock_balances",
    movements: "stock_movements",
    transfers: "stock_transfers",
    reservations: "stock_reservations",
    "reorder-rules": "stock_reorder_rules",
    batches: "stock_batches",
    serials: "stock_serials",
  };
  const table = tables[resource];
  if (!table) throw new StockError(404, "Unknown stock resource.");
  const { rows } = await client.query(
    `SELECT * FROM tenant.${table} WHERE organization_id=$1 AND company_id=$2 ORDER BY ${resource === "movements" ? "occurred_at" : "created_at"} DESC LIMIT $3 OFFSET $4`,
    [
      c.organizationId,
      c.companyId,
      Math.min(Number(limit) || 100, 250),
      Number(offset) || 0,
    ],
  );
  return rows;
}
async function settings(client, c) {
  const { rows } = await client.query(
    `SELECT allow_negative_stock,costing_method FROM tenant.stock_settings WHERE organization_id=$1 AND company_id=$2`,
    [c.organizationId, c.companyId],
  );
  return (
    rows[0] || { allow_negative_stock: false, costing_method: "moving_average" }
  );
}
export async function postStockMovement(client, c, input) {
  const permission =
    input.movementType === "receipt"
      ? "stock.receive"
      : input.movementType === "issue"
        ? "stock.issue"
        : "stock.adjust";
  need(c, permission);
  const qty = num(input.quantity, "Quantity");
  const signed = input.movementType === "issue" ? -qty : qty;
  const cfg = await settings(client, c);
  const current = await client.query(
    `SELECT quantity,reserved_quantity,average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4 AND warehouse_location_id IS NOT DISTINCT FROM $5 AND batch_id IS NOT DISTINCT FROM $6 FOR UPDATE`,
    [
      c.organizationId,
      c.companyId,
      input.itemId,
      input.warehouseId,
      input.warehouseLocationId || null,
      input.batchId || null,
    ],
  );
  const old = current.rows[0] || {
    quantity: 0,
    reserved_quantity: 0,
    average_cost: 0,
  };
  const next = Number(old.quantity) + signed;
  if (
    next < Number(old.reserved_quantity) ||
    (!cfg.allow_negative_stock && next < 0)
  )
    throw new StockError(
      409,
      "Insufficient available stock.",
      "INSUFFICIENT_STOCK",
    );
  const cost = Number(input.unitCost || old.average_cost || 0);
  const avg =
    signed > 0 && next > 0
      ? (Number(old.quantity) * Number(old.average_cost) + qty * cost) / next
      : Number(old.average_cost);
  const movement = await client.query(
    `INSERT INTO tenant.stock_movements(organization_id,company_id,movement_number,movement_type,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,unit_cost,reference_type,reference_id,reason,created_by,idempotency_key) VALUES($1,$2,'STK-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      c.organizationId,
      c.companyId,
      input.movementType,
      input.itemId,
      input.warehouseId,
      input.warehouseLocationId || null,
      input.batchId || null,
      signed,
      cost,
      input.referenceType || null,
      input.referenceId || null,
      input.reason || null,
      c.userId,
      input.idempotencyKey || null,
    ],
  );
  await client.query(
    `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reserved_quantity,average_cost) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8) ON CONFLICT(organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id) DO UPDATE SET quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,updated_at=now()`,
    [
      c.organizationId,
      c.companyId,
      input.itemId,
      input.warehouseId,
      input.warehouseLocationId || null,
      input.batchId || null,
      next,
      avg,
    ],
  );
  await client.query(
    `INSERT INTO tenant.stock_valuation_layers(organization_id,company_id,movement_id,item_id,warehouse_id,quantity,unit_cost,remaining_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      c.organizationId,
      c.companyId,
      movement.rows[0].id,
      input.itemId,
      input.warehouseId,
      signed,
      cost,
      Math.max(signed, 0),
    ],
  );
  return movement.rows[0];
}
export async function createStockTransfer(client, c, input) {
  need(c, "stock.transfer");
  const q = num(input.quantity, "Quantity");
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_transfers(organization_id,company_id,transfer_number,item_id,source_warehouse_id,source_location_id,destination_warehouse_id,destination_location_id,batch_id,quantity,requested_by) VALUES($1,$2,'TRF-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      c.organizationId,
      c.companyId,
      input.itemId,
      input.sourceWarehouseId,
      input.sourceLocationId || null,
      input.destinationWarehouseId,
      input.destinationLocationId || null,
      input.batchId || null,
      q,
      c.userId,
    ],
  );
  return rows[0];
}
export async function completeStockTransfer(client, c, id) {
  need(c, "stock.transfer");
  const { rows } = await client.query(
    `SELECT * FROM tenant.stock_transfers WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [c.organizationId, c.companyId, id],
  );
  const t = rows[0];
  if (!t || t.status !== "draft")
    throw new StockError(409, "Only a draft transfer can be completed.");
  await postStockMovement(
    client,
    { ...c, permissions: [...c.permissions, "stock.issue"] },
    {
      movementType: "issue",
      itemId: t.item_id,
      warehouseId: t.source_warehouse_id,
      warehouseLocationId: t.source_location_id,
      batchId: t.batch_id,
      quantity: t.quantity,
      referenceType: "stock_transfer",
      referenceId: t.id,
      reason: "Transfer issue",
    },
  );
  await postStockMovement(
    client,
    { ...c, permissions: [...c.permissions, "stock.receive"] },
    {
      movementType: "receipt",
      itemId: t.item_id,
      warehouseId: t.destination_warehouse_id,
      warehouseLocationId: t.destination_location_id,
      batchId: t.batch_id,
      quantity: t.quantity,
      referenceType: "stock_transfer",
      referenceId: t.id,
      reason: "Transfer receipt",
    },
  );
  const done = await client.query(
    `UPDATE tenant.stock_transfers SET status='completed',completed_by=$4,completed_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, id, c.userId],
  );
  return done.rows[0];
}
