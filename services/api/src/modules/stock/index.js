import { nextDocumentNumber } from "../../core/document-numbering.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { lockInventoryItem } from "../../core/inventory-lock.js";

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
async function stockDimension(client, c, input) {
  const item = (await client.query(
    `SELECT id,company_id,track_inventory,allow_negative_stock,standard_cost FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [c.organizationId, input.itemId],
  )).rows[0];
  if (!item || (item.company_id && item.company_id !== c.companyId))
    throw new StockError(404, "Stock item was not found for the active company.", "STOCK_ITEM_NOT_FOUND");
  if (!item.track_inventory)
    throw new StockError(409, "This item is not inventory-tracked.", "STOCK_ITEM_NOT_TRACKED");

  const warehouse = (await client.query(
    `SELECT id,company_id,allow_negative_stock FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [c.organizationId, input.warehouseId],
  )).rows[0];
  if (!warehouse || warehouse.company_id !== c.companyId)
    throw new StockError(404, "Warehouse was not found for the active company.", "STOCK_WAREHOUSE_NOT_FOUND");

  if (input.warehouseLocationId) {
    const location = (await client.query(
      `SELECT id FROM tenant.warehouse_locations WHERE organization_id=$1 AND id=$2 AND warehouse_id=$3 AND status='active'`,
      [c.organizationId, input.warehouseLocationId, input.warehouseId],
    )).rows[0];
    if (!location)
      throw new StockError(404, "Warehouse location was not found in the selected warehouse.", "STOCK_LOCATION_NOT_FOUND");
  }

  if (input.batchId) {
    const batch = (await client.query(
      `SELECT id FROM tenant.stock_batches WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND item_id=$4 AND status='active'`,
      [c.organizationId, c.companyId, input.batchId, input.itemId],
    )).rows[0];
    if (!batch)
      throw new StockError(404, "Batch was not found for the selected item.", "STOCK_BATCH_NOT_FOUND");
  }

  if (input.serialId) {
    const serial = (await client.query(
      `SELECT id FROM tenant.stock_serials WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND item_id=$4`,
      [c.organizationId, c.companyId, input.serialId, input.itemId],
    )).rows[0];
    if (!serial)
      throw new StockError(404, "Serial number was not found for the selected item.", "STOCK_SERIAL_NOT_FOUND");
  }

  return { item, warehouse };
}

async function assertQualityAllowsDecrease(client, c, input, quantity, oldBalance) {
  const holds = await client.query(
    `SELECT id,hold_number,hold_type,quantity,released_quantity,reason
     FROM tenant.quality_holds
     WHERE organization_id=$1 AND company_id=$2 AND status='active'
       AND item_id=$3
       AND hold_type IN ('inventory','batch','serial')
       AND (warehouse_id IS NULL OR warehouse_id=$4)
       AND (warehouse_location_id IS NULL OR warehouse_location_id IS NOT DISTINCT FROM $5)
       AND (batch_id IS NULL OR batch_id IS NOT DISTINCT FROM $6)
       AND (serial_id IS NULL OR serial_id IS NOT DISTINCT FROM $7)
     ORDER BY placed_at,id
     FOR UPDATE`,
    [
      c.organizationId,
      c.companyId,
      input.itemId,
      input.warehouseId,
      input.warehouseLocationId || null,
      input.batchId || null,
      input.serialId || null,
    ],
  );
  if (!holds.rows.length) return;

  const scopeHold = holds.rows.find((hold) => Number(hold.quantity) === 0);
  const blockedQuantity = holds.rows.reduce((sum, hold) => {
    const total = Number(hold.quantity);
    if (total === 0) return sum;
    return sum + Math.max(total - Number(hold.released_quantity || 0), 0);
  }, 0);
  const availableUnheld = Math.max(
    Number(oldBalance.quantity) - Number(oldBalance.reserved_quantity) - blockedQuantity,
    0,
  );
  if (scopeHold || quantity > availableUnheld) {
    const hold = scopeHold || holds.rows.find((row) => Number(row.quantity) - Number(row.released_quantity || 0) > 0);
    const error = new StockError(
      409,
      `Stock movement is blocked by quality hold ${hold?.hold_number || "unknown"}. Release the applicable hold before moving held stock.`,
      "QUALITY_HOLD_BLOCKED",
    );
    error.holdId = hold?.id || null;
    error.holdNumber = hold?.hold_number || null;
    error.blockedQuantity = scopeHold ? null : String(blockedQuantity);
    error.availableQuantity = String(scopeHold ? 0 : availableUnheld);
    error.nextAction = "release_quality_hold";
    throw error;
  }
}

export async function postStockMovement(client, c, input = {}) {
  const movementType = String(input.movementType || "").toLowerCase();
  if (!new Set(["receipt", "issue", "adjustment"]).has(movementType))
    throw new StockError(400, "Movement type must be receipt, issue or adjustment.", "STOCK_MOVEMENT_TYPE_INVALID");
  const permission = movementType === "receipt" ? "stock.receive" : movementType === "issue" ? "stock.issue" : "stock.adjust";
  need(c, permission);

  const idempotencyKey = String(input.idempotencyKey || "").trim() || null;
  const idempotency = await beginIdempotentOperation(client, c, {
    operation: "stock.movement",
    key: idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const qty = num(input.quantity, "Quantity");
  const direction = movementType === "adjustment" ? String(input.adjustmentDirection || "increase").toLowerCase() : null;
  if (movementType === "adjustment" && !new Set(["increase", "decrease"]).has(direction))
    throw new StockError(400, "Adjustment direction must be increase or decrease.", "STOCK_ADJUSTMENT_DIRECTION_INVALID");
  const signed = movementType === "issue" || direction === "decrease" ? -qty : qty;
  const { item, warehouse } = await stockDimension(client, c, { ...input, movementType });
  await lockInventoryItem(client, c, input.itemId);
  const cfg = await settings(client, c);

  const current = await client.query(
    `SELECT quantity,reserved_quantity,average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4 AND warehouse_location_id IS NOT DISTINCT FROM $5 AND batch_id IS NOT DISTINCT FROM $6 FOR UPDATE`,
    [c.organizationId,c.companyId,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null],
  );
  const old = current.rows[0] || { quantity: 0, reserved_quantity: 0, average_cost: 0 };
  const next = Number(old.quantity) + signed;
  const canGoNegative = Boolean(cfg.allow_negative_stock || item.allow_negative_stock || warehouse.allow_negative_stock);
  if (next < Number(old.reserved_quantity) || (!canGoNegative && next < 0))
    throw new StockError(409, "Insufficient available stock.", "INSUFFICIENT_STOCK");
  if (signed < 0) {
    await assertQualityAllowsDecrease(client, c, input, qty, old);
  }

  const explicitCost = input.unitCost == null || input.unitCost === "" ? null : Number(input.unitCost);
  if (explicitCost != null && (!Number.isFinite(explicitCost) || explicitCost < 0))
    throw new StockError(400, "Unit cost must be zero or greater.", "STOCK_UNIT_COST_INVALID");
  const cost = explicitCost ?? Number(old.average_cost || item.standard_cost || 0);
  const avg = signed > 0 && next > 0
    ? (Number(old.quantity) * Number(old.average_cost) + qty * cost) / next
    : Number(old.average_cost);

  const movementNumber = await nextDocumentNumber(client, c, {
    documentType: "stock_movement",
    prefix: "STK",
  });
  const movement = await client.query(
    `INSERT INTO tenant.stock_movements(organization_id,company_id,movement_number,movement_type,item_id,warehouse_id,warehouse_location_id,batch_id,serial_id,quantity,unit_cost,reference_type,reference_id,reason,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [c.organizationId,c.companyId,movementNumber,movementType,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null,input.serialId || null,signed,cost,input.referenceType || null,input.referenceId || null,input.reason || null,c.userId,idempotencyKey],
  );
  await client.query(
    `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reserved_quantity,average_cost) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8) ON CONFLICT(organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id) DO UPDATE SET quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,updated_at=now()`,
    [c.organizationId,c.companyId,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null,next,avg],
  );
  await client.query(
    `INSERT INTO tenant.stock_valuation_layers(organization_id,company_id,movement_id,item_id,warehouse_id,quantity,unit_cost,remaining_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [c.organizationId,c.companyId,movement.rows[0].id,input.itemId,input.warehouseId,signed,cost,Math.max(signed, 0)],
  );
  const response = { ...movement.rows[0], replayed: false };
  await completeIdempotentOperation(client, c, idempotency, {
    response,
    aggregateType: "stock_movement",
    aggregateId: movement.rows[0].id,
  });
  return response;
}

export async function createStockTransfer(client, c, input = {}) {
  need(c, "stock.transfer");
  const q = num(input.quantity, "Quantity");
  const idempotencyKey = String(input.idempotencyKey || "").trim() || null;
  const idempotency = await beginIdempotentOperation(client, c, {
    operation: "stock.transfer.create",
    key: idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  await stockDimension(client,c,{ itemId: input.itemId, warehouseId: input.sourceWarehouseId, warehouseLocationId: input.sourceLocationId || null, batchId: input.batchId || null });
  await stockDimension(client,c,{ itemId: input.itemId, warehouseId: input.destinationWarehouseId, warehouseLocationId: input.destinationLocationId || null, batchId: input.batchId || null });
  if (input.sourceWarehouseId === input.destinationWarehouseId && (input.sourceLocationId || null) === (input.destinationLocationId || null))
    throw new StockError(400,"Source and destination must be different.","STOCK_TRANSFER_SAME_LOCATION");
  const transferNumber = await nextDocumentNumber(client, c, {
    documentType: "stock_transfer",
    prefix: "TRF",
  });
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_transfers(organization_id,company_id,transfer_number,item_id,source_warehouse_id,source_location_id,destination_warehouse_id,destination_location_id,batch_id,quantity,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.organizationId,c.companyId,transferNumber,input.itemId,input.sourceWarehouseId,input.sourceLocationId || null,input.destinationWarehouseId,input.destinationLocationId || null,input.batchId || null,q,c.userId,idempotencyKey],
  );
  const response = { ...rows[0], replayed: false };
  await completeIdempotentOperation(client, c, idempotency, {
    response,
    aggregateType: "stock_transfer",
    aggregateId: rows[0].id,
  });
  return response;
}

export async function completeStockTransfer(client, c, id) {
  need(c, "stock.transfer");
  const { rows } = await client.query(
    `SELECT * FROM tenant.stock_transfers WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [c.organizationId,c.companyId,id],
  );
  const t = rows[0];
  if (!t) throw new StockError(404,"Stock transfer was not found.","STOCK_TRANSFER_NOT_FOUND");
  if (t.status === "completed") return { ...t, replayed: true };
  if (t.status !== "draft") throw new StockError(409, "Only a draft transfer can be completed.", "STOCK_TRANSFER_STATE_INVALID");

  await postStockMovement(client,{ ...c, permissions: [...new Set([...(c.permissions || []), "stock.issue"])] },{
    movementType:"issue",itemId:t.item_id,warehouseId:t.source_warehouse_id,warehouseLocationId:t.source_location_id,batchId:t.batch_id,quantity:t.quantity,
    referenceType:"stock_transfer",referenceId:t.id,reason:"Transfer issue",idempotencyKey:`transfer:${t.id}:issue`,
  });
  await postStockMovement(client,{ ...c, permissions: [...new Set([...(c.permissions || []), "stock.receive"])] },{
    movementType:"receipt",itemId:t.item_id,warehouseId:t.destination_warehouse_id,warehouseLocationId:t.destination_location_id,batchId:t.batch_id,quantity:t.quantity,
    referenceType:"stock_transfer",referenceId:t.id,reason:"Transfer receipt",idempotencyKey:`transfer:${t.id}:receipt`,
  });
  const done = await client.query(
    `UPDATE tenant.stock_transfers SET status='completed',completed_by=$4,completed_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId,c.companyId,id,c.userId],
  );
  return { ...done.rows[0], replayed: false };
}

// Diagnostic/repair for the historical stock_balances drift Prompt 11/12
// found: before this prompt, Manufacturing and Point of Sale each posted
// stock_movements rows without ever updating stock_balances, so the two
// can disagree for any (item, warehouse, location, batch) combination
// that ever received a movement from either module prior to this fix.
// stock_movements is the append-only ledger; the ledger-derived quantity
// (sum of signed quantities) is always the source of truth. Dry-run by
// default (repair=false) — never mutates unless explicitly asked, is
// always scoped to the caller's own organization/company (never crosses
// tenant boundaries, matching every other function in this file), and
// requires stock.adjust (not just stock.view) before it will write
// anything. Repair only ever corrects `quantity` to match the ledger sum
// exactly — it never invents, deletes, or reorders a movement, and never
// touches average_cost/reserved_quantity.
export async function diagnoseStockBalanceDrift(client, c, { repair = false } = {}) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT
       coalesce(m.item_id, b.item_id) AS item_id,
       coalesce(m.warehouse_id, b.warehouse_id) AS warehouse_id,
       coalesce(m.warehouse_location_id, b.warehouse_location_id) AS warehouse_location_id,
       coalesce(m.batch_id, b.batch_id) AS batch_id,
       coalesce(sum(m.quantity), 0)::numeric(20,6) AS ledger_quantity,
       coalesce(max(b.quantity), 0)::numeric(20,6) AS balance_quantity
     FROM tenant.stock_movements m
     FULL OUTER JOIN tenant.stock_balances b
       ON b.organization_id = m.organization_id AND b.company_id = m.company_id
      AND b.item_id = m.item_id AND b.warehouse_id = m.warehouse_id
      AND b.warehouse_location_id IS NOT DISTINCT FROM m.warehouse_location_id
      AND b.batch_id IS NOT DISTINCT FROM m.batch_id
     WHERE coalesce(m.organization_id, b.organization_id) = $1
       AND coalesce(m.company_id, b.company_id) = $2
     GROUP BY 1, 2, 3, 4
     HAVING coalesce(sum(m.quantity), 0) <> coalesce(max(b.quantity), 0)`,
    [c.organizationId, c.companyId],
  );
  const mismatches = rows.map((row) => ({
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    warehouseLocationId: row.warehouse_location_id,
    batchId: row.batch_id,
    ledgerQuantity: row.ledger_quantity,
    balanceQuantity: row.balance_quantity,
    drift: Number(row.ledger_quantity) - Number(row.balance_quantity),
  }));

  if (!repair || mismatches.length === 0) {
    return { dryRun: !repair, mismatchCount: mismatches.length, mismatches, repaired: [] };
  }

  need(c, "stock.adjust");
  const repaired = [];
  for (const mismatch of mismatches) {
    const result = await client.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reserved_quantity,average_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,0)
       ON CONFLICT(organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id)
       DO UPDATE SET quantity=EXCLUDED.quantity, updated_at=now()
       RETURNING *`,
      [
        c.organizationId,
        c.companyId,
        mismatch.itemId,
        mismatch.warehouseId,
        mismatch.warehouseLocationId,
        mismatch.batchId,
        mismatch.ledgerQuantity,
      ],
    );
    repaired.push({ ...mismatch, balanceAfter: result.rows[0] });
  }
  return { dryRun: false, mismatchCount: mismatches.length, mismatches, repaired };
}
// F112-F114 governed reservation and availability primitives. The stock ledger
// remains the quantity source of truth; reservations only adjust
// stock_balances.reserved_quantity and never invent a stock movement.
export async function getStockAvailability(client, c, input = {}) {
  need(c, "stock.view");
  if (!input.itemId) throw new StockError(400, "Item is required.", "STOCK_ITEM_REQUIRED");
  const values = [c.organizationId, c.companyId, input.itemId];
  let filter = "";
  if (input.warehouseId) { values.push(input.warehouseId); filter += ` AND warehouse_id=$${values.length}`; }
  if (input.warehouseLocationId) { values.push(input.warehouseLocationId); filter += ` AND warehouse_location_id=$${values.length}`; }
  if (input.batchId) { values.push(input.batchId); filter += ` AND batch_id=$${values.length}`; }
  const { rows } = await client.query(
    `SELECT item_id,${input.warehouseId ? "warehouse_id" : "NULL::uuid AS warehouse_id"},
            COALESCE(sum(quantity),0)::text AS on_hand_quantity,
            COALESCE(sum(reserved_quantity),0)::text AS reserved_quantity,
            COALESCE(sum(quantity-reserved_quantity),0)::text AS available_quantity,
            COALESCE(sum(CASE WHEN quantity-reserved_quantity>0 THEN quantity-reserved_quantity ELSE 0 END),0)::text AS available_to_promise
       FROM tenant.stock_balances
      WHERE organization_id=$1 AND company_id=$2 AND item_id=$3${filter}
      GROUP BY item_id${input.warehouseId ? ",warehouse_id" : ""}`,
    values,
  );
  const row = rows[0] || {
    item_id: input.itemId,
    warehouse_id: input.warehouseId || null,
    on_hand_quantity: "0",
    reserved_quantity: "0",
    available_quantity: "0",
    available_to_promise: "0",
  };
  const holdValues = [c.organizationId, c.companyId, input.itemId];
  let holdWarehouseFilter = "";
  if (input.warehouseId) {
    holdValues.push(input.warehouseId);
    holdWarehouseFilter = ` AND (warehouse_id IS NULL OR warehouse_id=$${holdValues.length})`;
  }
  const holdResult = await client.query(
    `SELECT
       bool_or(quantity=0) AS scope_blocked,
       COALESCE(sum(CASE WHEN quantity=0 THEN 0 ELSE greatest(quantity-released_quantity,0) END),0)::text AS held_quantity
     FROM tenant.quality_holds
     WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND status='active'
       AND hold_type IN ('inventory','batch','serial')${holdWarehouseFilter}`,
    holdValues,
  );
  const scopeBlocked = Boolean(holdResult.rows[0]?.scope_blocked);
  const heldQuantity = Number(holdResult.rows[0]?.held_quantity || 0);
  const adjustedAvailable = scopeBlocked ? 0 : Math.max(Number(row.available_quantity) - heldQuantity, 0);
  const adjustedAtp = scopeBlocked ? 0 : Math.max(Number(row.available_to_promise) - heldQuantity, 0);
  const requested = input.requestedQuantity == null || input.requestedQuantity === "" ? null : num(input.requestedQuantity, "Requested quantity");
  return {
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    onHandQuantity: row.on_hand_quantity,
    reservedQuantity: row.reserved_quantity,
    qualityHeldQuantity: scopeBlocked ? null : String(heldQuantity),
    qualityScopeBlocked: scopeBlocked,
    availableQuantity: String(adjustedAvailable),
    availableToPromise: String(adjustedAtp),
    requestedQuantity: requested,
    canPromise: requested == null ? null : adjustedAtp >= requested,
  };
}

export async function reserveStock(client, c, input = {}) {
  need(c, "stock.reserve");
  const quantity = num(input.quantity, "Quantity");
  if (!input.itemId || !input.warehouseId)
    throw new StockError(400, "Item and warehouse are required for a reservation.", "STOCK_RESERVATION_SCOPE_REQUIRED");
  if (!input.referenceType || !input.referenceId)
    throw new StockError(400, "Reservation reference type and reference id are required.", "STOCK_RESERVATION_REFERENCE_REQUIRED");
  await stockDimension(client, c, {
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    warehouseLocationId: input.warehouseLocationId || null,
    batchId: input.batchId || null,
  });
  const idempotencyKey = String(input.idempotencyKey || "").trim() || null;
  const idempotency = await beginIdempotentOperation(client, c, {
    operation: "stock.reservation.create",
    key: idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  await lockInventoryItem(client, c, input.itemId);
  const values = [c.organizationId, c.companyId, input.itemId, input.warehouseId];
  let dimensionFilter = "";
  if (input.warehouseLocationId) { values.push(input.warehouseLocationId); dimensionFilter += ` AND warehouse_location_id=$${values.length}`; }
  if (input.batchId) { values.push(input.batchId); dimensionFilter += ` AND batch_id=$${values.length}`; }
  const balances = await client.query(
    `SELECT * FROM tenant.stock_balances
      WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4${dimensionFilter}
        AND quantity-reserved_quantity >= $${values.length + 1}
      ORDER BY (quantity-reserved_quantity) DESC,updated_at ASC
      LIMIT 1 FOR UPDATE`,
    [...values, quantity],
  );
  const balance = balances.rows[0];
  if (!balance)
    throw new StockError(409, "Insufficient available stock for this reservation.", "STOCK_RESERVATION_INSUFFICIENT");
  await assertQualityAllowsDecrease(
    client,
    c,
    {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      warehouseLocationId: balance.warehouse_location_id,
      batchId: balance.batch_id,
      serialId: null,
    },
    quantity,
    balance,
  );
  const created = await client.query(
    `INSERT INTO tenant.stock_reservations(
       organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,
       reference_type,reference_id,status,reserved_by,idempotency_key,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,now()) RETURNING *`,
    [c.organizationId,c.companyId,input.itemId,input.warehouseId,balance.warehouse_location_id,balance.batch_id,
     quantity,String(input.referenceType).slice(0,100),input.referenceId,c.userId,idempotencyKey],
  );
  await client.query(
    `UPDATE tenant.stock_balances SET reserved_quantity=reserved_quantity+$7,updated_at=now()
      WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4
        AND warehouse_location_id IS NOT DISTINCT FROM $5 AND batch_id IS NOT DISTINCT FROM $6`,
    [c.organizationId,c.companyId,input.itemId,input.warehouseId,balance.warehouse_location_id,balance.batch_id,quantity],
  );
  const response = { ...created.rows[0], replayed: false };
  await completeIdempotentOperation(client, c, idempotency, {
    response,
    aggregateType: "stock_reservation",
    aggregateId: created.rows[0].id,
  });
  return response;
}

export async function releaseStockReservation(client, c, id, { status = "released" } = {}) {
  need(c, "stock.reserve");
  if (!new Set(["released", "cancelled", "consumed"]).has(status))
    throw new StockError(400, "Reservation close status is invalid.", "STOCK_RESERVATION_STATUS_INVALID");
  const found = await client.query(
    `SELECT * FROM tenant.stock_reservations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [c.organizationId,c.companyId,id],
  );
  const reservation = found.rows[0];
  if (!reservation) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  if (reservation.status !== "active") return reservation;
  const balance = await client.query(
    `SELECT reserved_quantity FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4
       AND warehouse_location_id IS NOT DISTINCT FROM $5 AND batch_id IS NOT DISTINCT FROM $6 FOR UPDATE`,
    [c.organizationId,c.companyId,reservation.item_id,reservation.warehouse_id,reservation.warehouse_location_id,reservation.batch_id],
  );
  if (!balance.rows[0] || Number(balance.rows[0].reserved_quantity) < Number(reservation.quantity))
    throw new StockError(409, "Reservation balance is inconsistent; run stock diagnostics before releasing it.", "STOCK_RESERVATION_DRIFT");
  await client.query(
    `UPDATE tenant.stock_balances SET reserved_quantity=reserved_quantity-$7,updated_at=now()
      WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4
        AND warehouse_location_id IS NOT DISTINCT FROM $5 AND batch_id IS NOT DISTINCT FROM $6`,
    [c.organizationId,c.companyId,reservation.item_id,reservation.warehouse_id,reservation.warehouse_location_id,reservation.batch_id,reservation.quantity],
  );
  const closed = await client.query(
    `UPDATE tenant.stock_reservations SET status=$4,released_at=now(),updated_at=now()
      WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId,c.companyId,id,status],
  );
  return closed.rows[0];
}

export async function listActiveStockReservationsByReference(client, c, { referenceType, referenceId }) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT * FROM tenant.stock_reservations
      WHERE organization_id=$1 AND company_id=$2 AND reference_type=$3 AND reference_id=$4 AND status='active'`,
    [c.organizationId, c.companyId, String(referenceType).slice(0,100), referenceId],
  );
  return rows;
}

export async function listStockReorderCandidates(client, c, { limit = 100 } = {}) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT rule.id AS reorder_rule_id,rule.item_id,rule.warehouse_id,rule.preferred_supplier_id,
            rule.reorder_quantity,rule.minimum_quantity,rule.maximum_quantity,rule.lead_time_days,
            COALESCE(sum(balance.quantity),0)::text AS on_hand_quantity,
            COALESCE(sum(balance.reserved_quantity),0)::text AS reserved_quantity,
            COALESCE(sum(balance.quantity-balance.reserved_quantity),0)::text AS available_quantity
       FROM tenant.stock_reorder_rules rule
       LEFT JOIN tenant.stock_balances balance
         ON balance.organization_id=rule.organization_id AND balance.company_id=rule.company_id
        AND balance.item_id=rule.item_id AND balance.warehouse_id=rule.warehouse_id
      WHERE rule.organization_id=$1 AND rule.company_id=$2 AND rule.active
      GROUP BY rule.id
     HAVING COALESCE(sum(balance.quantity-balance.reserved_quantity),0) <= rule.minimum_quantity
      ORDER BY (rule.minimum_quantity-COALESCE(sum(balance.quantity-balance.reserved_quantity),0)) DESC,rule.created_at
      LIMIT $3`,
    [c.organizationId,c.companyId,Math.min(Math.max(Number(limit)||100,1),250)],
  );
  return rows.map((row) => ({
    reorderRuleId: row.reorder_rule_id,
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    preferredSupplierId: row.preferred_supplier_id,
    reorderQuantity: row.reorder_quantity,
    minimumQuantity: row.minimum_quantity,
    maximumQuantity: row.maximum_quantity,
    leadTimeDays: row.lead_time_days,
    onHandQuantity: row.on_hand_quantity,
    reservedQuantity: row.reserved_quantity,
    availableQuantity: row.available_quantity,
  }));
}

export async function listStockOperationOptions(client,c){
  need(c,"stock.view");
  const [items,warehouses,locations,batches]=await Promise.all([
    client.query(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY name LIMIT 500`,[c.organizationId,c.companyId]),
    client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' AND company_id=$2 ORDER BY name LIMIT 200`,[c.organizationId,c.companyId]),
    client.query(`SELECT l.id,l.code,l.name,l.warehouse_id FROM tenant.warehouse_locations l JOIN tenant.warehouses w ON w.organization_id=l.organization_id AND w.id=l.warehouse_id WHERE l.organization_id=$1 AND l.status='active' AND w.company_id=$2 AND w.status='active' ORDER BY w.code,l.code LIMIT 1000`,[c.organizationId,c.companyId]),
    client.query(`SELECT id,batch_number AS code,batch_number AS name,item_id FROM tenant.stock_batches WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 500`,[c.organizationId,c.companyId]),
  ]);
  return {items:items.rows,warehouses:warehouses.rows,locations:locations.rows,batches:batches.rows};
}
