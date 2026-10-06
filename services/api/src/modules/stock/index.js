import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
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
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    permissions: session.permissions || [],
    roleSlugs: session.roleSlugs || [],
  };
}
export async function getStockDashboard(client, c) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT COALESCE(sum(quantity),0)::text total_quantity,COALESCE(sum(quantity*average_cost),0)::text inventory_value,COALESCE(sum(reserved_quantity),0)::text reserved_quantity,count(DISTINCT item_id)::int stocked_items,count(DISTINCT warehouse_id)::int warehouses FROM tenant.stock_balances WHERE organization_id=$1`,
    [c.organizationId],
  );
  const low = await client.query(
    `SELECT count(*)::int count FROM tenant.stock_reorder_rules r LEFT JOIN tenant.stock_balances b ON b.organization_id=r.organization_id AND b.item_id=r.item_id AND b.warehouse_id=r.warehouse_id WHERE r.organization_id=$1 AND r.active AND COALESCE(b.quantity-b.reserved_quantity,0)<=r.minimum_quantity`,
    [c.organizationId],
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
    `SELECT * FROM tenant.${table} WHERE organization_id=$1 ORDER BY ${resource === "movements" ? "occurred_at" : "created_at"} DESC LIMIT $2 OFFSET $3`,
    [
      c.organizationId,
      Math.min(Number(limit) || 100, 250),
      Number(offset) || 0,
    ],
  );
  return rows;
}
async function settings(client, c) {
  const { rows } = await client.query(
    `SELECT allow_negative_stock,costing_method FROM tenant.stock_settings WHERE organization_id=$1`,
    [c.organizationId],
  );
  return (
    rows[0] || { allow_negative_stock: false, costing_method: "moving_average" }
  );
}
async function stockDimension(client, c, input) {
  const item = (await client.query(
    `SELECT id,track_inventory,allow_negative_stock,standard_cost,tracking_type,valuation_method FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [c.organizationId, input.itemId],
  )).rows[0];
  if (!item)
    throw new StockError(404, "Stock item was not found.", "STOCK_ITEM_NOT_FOUND");
  if (!item.track_inventory)
    throw new StockError(409, "This item is not inventory-tracked.", "STOCK_ITEM_NOT_TRACKED");

  const warehouse = (await client.query(
    `SELECT id,allow_negative_stock FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [c.organizationId, input.warehouseId],
  )).rows[0];
  if (!warehouse)
    throw new StockError(404, "Warehouse was not found.", "STOCK_WAREHOUSE_NOT_FOUND");

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
      `SELECT id FROM tenant.stock_batches WHERE organization_id=$1 AND id=$2 AND item_id=$3 AND status='active'`,
      [c.organizationId, input.batchId, input.itemId],
    )).rows[0];
    if (!batch)
      throw new StockError(404, "Batch was not found for the selected item.", "STOCK_BATCH_NOT_FOUND");
  }

  if (input.serialId) {
    const serial = (await client.query(
      `SELECT id FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2 AND item_id=$3`,
      [c.organizationId, input.serialId, input.itemId],
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
     WHERE organization_id=$1 AND status='active'
       AND item_id=$2
       AND hold_type IN ('inventory','batch','serial')
       AND (warehouse_id IS NULL OR warehouse_id=$3)
       AND (warehouse_location_id IS NULL OR warehouse_location_id IS NOT DISTINCT FROM $4)
       AND (batch_id IS NULL OR batch_id IS NOT DISTINCT FROM $5)
       AND (serial_id IS NULL OR serial_id IS NOT DISTINCT FROM $6)
     ORDER BY placed_at,id
     FOR UPDATE`,
    [
      c.organizationId,
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

// F295: tenant.items.tracking_type (migration 117) is the item master's
// declaration that it must be sold/issued against a specific batch or
// serial -- previously nothing anywhere required one or checked it made
// sense. For 'batch' items, stock_balances is already correctly
// dimensioned by batch_id (see the balance query in postStockMovement
// below), so the only real gap was that a batch was never actually
// REQUIRED on an issue; the existing FOR UPDATE row lock and
// quantity/reserved-quantity check already correctly prevent a batch from
// going negative once one is supplied, so no separate state machine is
// needed for batches the way serials need one.
function requireTrackingReference(item, movementType, input) {
  if (movementType !== "issue") return;
  if (item.tracking_type === "batch" && !input.batchId) {
    throw new StockError(400, "This item requires a batch to be selected before it can be issued.", "STOCK_BATCH_REQUIRED");
  }
  if (item.tracking_type === "serial" && !input.serialId) {
    throw new StockError(400, "This item requires a serial number to be selected before it can be issued.", "STOCK_SERIAL_REQUIRED");
  }
}

// F295: a serial is a single, discrete unit -- unlike a batch's quantity,
// it can only ever be in one of two coherent states: sitting in stock
// ('available') or already sold ('sold'). This is the ONLY code anywhere
// that ever transitions tenant.stock_serials.status (see migration 117's
// comment). Locked with its own FOR UPDATE so two concurrent issues
// against the SAME serial id serialize on this row: the second one to
// reach here always observes the first one's already-committed 'sold'
// status and is rejected, closing the double-sell race deterministically
// rather than relying on timing.
//
// Documented rule for 'receipt' (the return/restock direction): a serial
// can only be receipted back to 'available' from 'sold' -- that is the
// only prior state a genuine return can coherently come from (the serial
// was sold on the original sale, and this receipt is undoing exactly
// that). A receipt against a serial that is already 'available' has no
// coherent prior state to undo (it was never sold, or was already
// returned once) and is rejected rather than silently accepted, which
// would let the same physical return double-credit stock. A 'receipt'
// with no serialId at all (e.g. bulk initial stock intake before any
// serial numbers are individually registered) is left alone -- this
// module has no serial-registration endpoint yet, so requiring one on
// every receipt would make it impossible to ever receive serial-tracked
// stock for the first time; that is a disclosed, separate gap, not one
// this pass silently papers over.
async function applySerialTransition(client, c, input, item, movementType) {
  if (item.tracking_type !== "serial" || !input.serialId) return;
  const serial = await client.query(
    `SELECT id,status FROM tenant.stock_serials
     WHERE organization_id=$1 AND id=$2 AND item_id=$3
     FOR UPDATE`,
    [c.organizationId, input.serialId, input.itemId],
  );
  const row = serial.rows[0];
  if (!row) throw new StockError(404, "Serial number was not found for the selected item.", "STOCK_SERIAL_NOT_FOUND");
  if (movementType === "issue") {
    if (row.status !== "available") {
      throw new StockError(409, "This serial number has already been sold and is not available.", "STOCK_SERIAL_NOT_AVAILABLE");
    }
    await client.query(
      `UPDATE tenant.stock_serials SET status='sold',warehouse_id=$3,warehouse_location_id=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [c.organizationId, row.id, input.warehouseId, input.warehouseLocationId || null],
    );
  } else if (movementType === "receipt") {
    if (row.status !== "sold") {
      throw new StockError(
        409,
        "This serial number is not currently marked as sold, so it has no coherent sale to return.",
        "STOCK_SERIAL_NOT_RETURNABLE",
      );
    }
    await client.query(
      `UPDATE tenant.stock_serials SET status='available',warehouse_id=$3,warehouse_location_id=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [c.organizationId, row.id, input.warehouseId, input.warehouseLocationId || null],
    );
  }
}

// FIFO: an issue takes stock from the oldest layers of the item's warehouse first. Layers were
// historically never drawn down, so before consuming, any surplus over the quantity actually on
// hand is retired from the OLDEST end -- exactly what earlier issues would have done -- which makes
// the first FIFO issue on legacy data correct. Quantity the layers cannot cover (negative-stock
// cases) is costed at the fallback average.
async function consumeFifoLayers(client, c, itemId, warehouseId, qty, fallbackCost) {
  const layers = (await client.query(
    `SELECT id,remaining_quantity,unit_cost FROM tenant.stock_valuation_layers WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND remaining_quantity>0 ORDER BY created_at,id FOR UPDATE`,
    [c.organizationId, itemId, warehouseId],
  )).rows;
  const onHand = Number((await client.query(
    `SELECT COALESCE(sum(quantity),0) AS q FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`,
    [c.organizationId, itemId, warehouseId],
  )).rows[0].q);
  let surplus = Math.max(layers.reduce((sum, l) => sum + Number(l.remaining_quantity), 0) - onHand, 0);
  let toTake = qty;
  let value = 0;
  let remainingQty = 0;
  let remainingValue = 0;
  for (const layer of layers) {
    let left = Number(layer.remaining_quantity);
    const retire = Math.min(surplus, left);
    surplus -= retire;
    left -= retire;
    const take = Math.min(toTake, left);
    toTake -= take;
    value += take * Number(layer.unit_cost);
    left -= take;
    if (left !== Number(layer.remaining_quantity)) {
      await client.query(`UPDATE tenant.stock_valuation_layers SET remaining_quantity=$2 WHERE id=$1`, [layer.id, left]);
    }
    remainingQty += left;
    remainingValue += left * Number(layer.unit_cost);
  }
  const uncovered = toTake;
  return {
    unitCost: (value + uncovered * fallbackCost) / qty,
    remainingAverage: remainingQty > 0 ? remainingValue / remainingQty : null,
  };
}

export async function postStockMovement(client, c, input = {}) {
  const movementType = String(input.movementType || "").toLowerCase();
  // return: goods coming back from a customer (a sales return), received like a receipt.
  if (!new Set(["receipt", "issue", "adjustment", "return"]).has(movementType))
    throw new StockError(400, "Movement type must be receipt, issue, adjustment or return.", "STOCK_MOVEMENT_TYPE_INVALID");
  const permission = movementType === "receipt" || movementType === "return" ? "stock.receive" : movementType === "issue" ? "stock.issue" : "stock.adjust";
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
  requireTrackingReference(item, movementType, input);
  if (input.referenceType !== "stock_count") {
    const frozen = (await client.query(
      `SELECT count_number FROM tenant.stock_counts WHERE organization_id=$1 AND warehouse_id=$2 AND freeze_stock AND status IN ('counting','review') LIMIT 1`,
      [c.organizationId, input.warehouseId],
    )).rows[0];
    if (frozen) throw new StockError(409, `This warehouse is frozen for count ${frozen.count_number}. Stock cannot move until the count is posted or cancelled.`, "STOCK_WAREHOUSE_FROZEN");
  }
  await lockInventoryItem(client, c, input.itemId);
  const cfg = await settings(client, c);

  const current = await client.query(
    `SELECT quantity,reserved_quantity,average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5 FOR UPDATE`,
    [c.organizationId,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null],
  );
  const old = current.rows[0] || { quantity: 0, reserved_quantity: 0, average_cost: 0 };
  const next = Number(old.quantity) + signed;
  const canGoNegative = Boolean(cfg.allow_negative_stock || item.allow_negative_stock || warehouse.allow_negative_stock);
  if (next < Number(old.reserved_quantity) || (!canGoNegative && next < 0)) {
    // Stock is held per location and batch. When the request names none but the warehouse holds
    // enough elsewhere, say so -- "insufficient" alone sends people looking for a shortage that
    // is really a missing location.
    if (signed < 0 && (!input.warehouseLocationId || !input.batchId)) {
      const elsewhere = Number((await client.query(
        `SELECT COALESCE(sum(quantity-reserved_quantity),0) AS q FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`,
        [c.organizationId, input.itemId, input.warehouseId],
      )).rows[0].q);
      if (elsewhere >= qty) {
        throw new StockError(409, "Insufficient available stock at that location. The warehouse holds enough in other locations or batches, so choose the location (and batch) the stock is in.", "INSUFFICIENT_STOCK");
      }
    }
    throw new StockError(409, "Insufficient available stock.", "INSUFFICIENT_STOCK");
  }
  if (signed < 0) {
    await assertQualityAllowsDecrease(client, c, input, qty, old);
  }
  // F295: validated and transitioned under the serial row's own FOR UPDATE
  // lock (inside applySerialTransition), in the same transaction as the
  // balance lock taken just above -- see that function's doc comment for
  // the exact available/sold rule.
  await applySerialTransition(client, c, input, item, movementType);

  const explicitCost = input.unitCost == null || input.unitCost === "" ? null : Number(input.unitCost);
  if (explicitCost != null && (!Number.isFinite(explicitCost) || explicitCost < 0))
    throw new StockError(400, "Unit cost must be zero or greater.", "STOCK_UNIT_COST_INVALID");
  // Costing (F133-F135). The item's own method wins when it is not the default; otherwise the
  // organization setting applies.
  //   moving_average: receipts blend into the running average; issues leave at that average.
  //   fifo:           issues consume the OLDEST layers of the warehouse, so cost follows the stock.
  //   standard:       stock is carried at the item's standard cost; a receipt at a different price
  //                   books the difference as a purchase-price variance on the movement.
  const method = item.valuation_method && item.valuation_method !== "moving_average" ? item.valuation_method : cfg.costing_method;
  const standardCost = Number(item.standard_cost || 0);
  let cost = explicitCost ?? Number(old.average_cost || item.standard_cost || 0);
  let layerCost = cost;
  let costVariance = 0;
  let avg = signed > 0 && next > 0
    ? (Number(old.quantity) * Number(old.average_cost) + qty * cost) / next
    : Number(old.average_cost);
  if (method === "standard" && standardCost > 0) {
    if (signed > 0) {
      cost = explicitCost ?? standardCost;
      costVariance = (cost - standardCost) * qty;
    } else {
      cost = standardCost;
    }
    layerCost = standardCost;
    avg = standardCost;
  } else if (method === "fifo" && signed < 0) {
    const consumed = await consumeFifoLayers(client, c, input.itemId, input.warehouseId, qty, Number(old.average_cost || standardCost || 0));
    cost = consumed.unitCost;
    layerCost = cost;
    if (consumed.remainingAverage !== null) avg = consumed.remainingAverage;
  } else if (signed < 0) {
    // Other methods do not cost from layers, but layers still track what is left of each receipt
    // (landed cost, aging and a later switch to FIFO all rely on it).
    await consumeFifoLayers(client, c, input.itemId, input.warehouseId, qty, Number(old.average_cost || standardCost || 0));
  }

  const movementNumber = await nextDocumentNumber(client, c, {
    documentType: "stock_movement",
    prefix: "STK",
  });
  const movement = await client.query(
    `INSERT INTO tenant.stock_movements(organization_id,movement_number,movement_type,item_id,warehouse_id,warehouse_location_id,batch_id,serial_id,quantity,unit_cost,reference_type,reference_id,reason,created_by,idempotency_key,cost_variance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [c.organizationId,movementNumber,movementType,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null,input.serialId || null,signed,cost,input.referenceType || null,input.referenceId || null,input.reason || null,c.userId,idempotencyKey,costVariance],
  );
  await client.query(
    `INSERT INTO tenant.stock_balances(organization_id,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reserved_quantity,average_cost) VALUES($1,$2,$3,$4,$5,$6,0,$7) ON CONFLICT(organization_id,item_id,warehouse_id,warehouse_location_id,batch_id) DO UPDATE SET quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,updated_at=now()`,
    [c.organizationId,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null,next,avg],
  );
  await client.query(
    `INSERT INTO tenant.stock_valuation_layers(organization_id,movement_id,item_id,warehouse_id,quantity,unit_cost,remaining_quantity) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId,movement.rows[0].id,input.itemId,input.warehouseId,signed,layerCost,Math.max(signed, 0)],
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
    `INSERT INTO tenant.stock_transfers(organization_id,transfer_number,item_id,source_warehouse_id,source_location_id,destination_warehouse_id,destination_location_id,batch_id,quantity,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId,transferNumber,input.itemId,input.sourceWarehouseId,input.sourceLocationId || null,input.destinationWarehouseId,input.destinationLocationId || null,input.batchId || null,q,c.userId,idempotencyKey],
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
    `SELECT * FROM tenant.stock_transfers WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [c.organizationId,id],
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
    `UPDATE tenant.stock_transfers SET status='completed',completed_by=$3,completed_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId,id,c.userId],
  );
  return { ...done.rows[0], replayed: false };
}

// Diagnostic/repair for historical stock_balances drift: older
// Manufacturing and Point of Sale movements were posted to stock_movements
// without updating stock_balances, so the two can disagree for any (item,
// warehouse, location, batch) combination that received such a movement.
// stock_movements is the append-only ledger; the ledger-derived quantity
// (sum of signed quantities) is always the source of truth. Dry-run by
// default (repair=false) — never mutates unless explicitly asked, is
// always scoped to the caller's own organization (never crosses
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
       ON b.organization_id = m.organization_id
      AND b.item_id = m.item_id AND b.warehouse_id = m.warehouse_id
      AND b.warehouse_location_id IS NOT DISTINCT FROM m.warehouse_location_id
      AND b.batch_id IS NOT DISTINCT FROM m.batch_id
     WHERE coalesce(m.organization_id, b.organization_id) = $1
     GROUP BY 1, 2, 3, 4
     HAVING coalesce(sum(m.quantity), 0) <> coalesce(max(b.quantity), 0)`,
    [c.organizationId],
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
      `INSERT INTO tenant.stock_balances(organization_id,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reserved_quantity,average_cost)
       VALUES ($1,$2,$3,$4,$5,$6,0,0)
       ON CONFLICT(organization_id,item_id,warehouse_id,warehouse_location_id,batch_id)
       DO UPDATE SET quantity=EXCLUDED.quantity, updated_at=now()
       RETURNING *`,
      [
        c.organizationId,
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
  const values = [c.organizationId, input.itemId];
  let filter = "";
  if (input.warehouseId) { values.push(input.warehouseId); filter += ` AND balance.warehouse_id=$${values.length}`; }
  if (input.warehouseLocationId) { values.push(input.warehouseLocationId); filter += ` AND balance.warehouse_location_id=$${values.length}`; }
  if (input.batchId) { values.push(input.batchId); filter += ` AND balance.batch_id=$${values.length}`; }
  // On hand counts every row; available only usable ones (USABLE_ROW): stock in a quality or
  // inactive location, or in a blocked or expired batch, is on hand but cannot be sold.
  const { rows } = await client.query(
    `SELECT balance.item_id,${input.warehouseId ? "balance.warehouse_id" : "NULL::uuid AS warehouse_id"},
            COALESCE(sum(balance.quantity),0)::text AS on_hand_quantity,
            COALESCE(sum(balance.reserved_quantity),0)::text AS reserved_quantity,
            COALESCE(sum(CASE WHEN ${USABLE_ROW} THEN balance.quantity-balance.reserved_quantity ELSE 0 END),0)::text AS available_quantity,
            COALESCE(sum(CASE WHEN ${USABLE_ROW} AND balance.quantity-balance.reserved_quantity>0 THEN balance.quantity-balance.reserved_quantity ELSE 0 END),0)::text AS available_to_promise,
            COALESCE(sum(CASE WHEN ${USABLE_ROW} THEN 0 ELSE balance.quantity END),0)::text AS unusable_quantity
       FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
      WHERE balance.organization_id=$1 AND balance.item_id=$2${filter}
      GROUP BY balance.item_id${input.warehouseId ? ",balance.warehouse_id" : ""}`,
    values,
  );
  const row = rows[0] || {
    item_id: input.itemId,
    warehouse_id: input.warehouseId || null,
    on_hand_quantity: "0",
    reserved_quantity: "0",
    available_quantity: "0",
    available_to_promise: "0",
    unusable_quantity: "0",
  };
  const holdValues = [c.organizationId, input.itemId];
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
     WHERE organization_id=$1 AND item_id=$2 AND status='active'
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
    // On hand in quality or inactive locations, or in blocked or expired batches: never available.
    unusableQuantity: row.unusable_quantity,
    availableQuantity: String(adjustedAvailable),
    availableToPromise: String(adjustedAtp),
    requestedQuantity: requested,
    canPromise: requested == null ? null : adjustedAtp >= requested,
  };
}

// ---- Stock reservations ------------------------------------------------------
// A reservation commits usable stock in one warehouse (and one location and
// batch row) to a demand: an order line, a work order, a manual hold. It
// lowers what is available, never what is on hand, and creates no stock
// movement and no accounting entry. It keeps what it reserved; consumption by
// a delivery and releases are recorded beside it:
//   active = reserved − consumed − released
// stock_balances.reserved_quantity is a cache of the active quantities of a
// balance row, changed in the same statement order as the reservation and
// rebuilt from the reservations by reconcileStockReservations.

// Usable means: not in a quality or inactive location, not in a blocked or expired batch.
const USABLE_ROW = `COALESCE(location.location_type,'') <> 'quality' AND COALESCE(location.status,'active')='active' AND COALESCE(batch.status,'active')='active'`;
const reservationRound = (value) => Math.round(Number(value) * 1e6) / 1e6;

async function insertReservation(client, c, balance, quantity, input, idempotencyKey) {
  const number = await nextDocumentNumber(client, c, { documentType: "stock_reservation" });
  const created = await client.query(
    `INSERT INTO tenant.stock_reservations(
       organization_id,reservation_number,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reference_type,reference_id,status,reserved_by,idempotency_key,
       sales_order_id,sales_order_line_id,sales_quantity,sales_uom,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$12,$13,$14,$15,now()) RETURNING *`,
    [c.organizationId, number, input.itemId, input.warehouseId, balance.warehouse_location_id, balance.batch_id, quantity, String(input.referenceType).slice(0, 100), input.referenceId,
      c.userId ?? null, idempotencyKey, input.salesOrderId ?? null, input.salesOrderLineId ?? null, input.salesQuantity ?? null, input.salesUom ?? null],
  );
  await client.query(
    `UPDATE tenant.stock_balances SET reserved_quantity=reserved_quantity+$6,updated_at=now()
      WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`,
    [c.organizationId, input.itemId, input.warehouseId, balance.warehouse_location_id, balance.batch_id, quantity],
  );
  return created.rows[0];
}

// Reserves exactly `quantity` from one balance row (a manual hold, a work order).
export async function reserveStock(client, c, input = {}) {
  need(c, "stock.reserve");
  const quantity = num(input.quantity, "Quantity");
  if (!input.itemId || !input.warehouseId)
    throw new StockError(400, "Item and warehouse are required for a reservation.", "STOCK_RESERVATION_SCOPE_REQUIRED");
  if (!input.referenceType || !input.referenceId)
    throw new StockError(400, "Reservation reference type and reference id are required.", "STOCK_RESERVATION_REFERENCE_REQUIRED");
  await stockDimension(client, c, { itemId: input.itemId, warehouseId: input.warehouseId, warehouseLocationId: input.warehouseLocationId || null, batchId: input.batchId || null });
  const idempotencyKey = String(input.idempotencyKey || "").trim() || null;
  const idempotency = await beginIdempotentOperation(client, c, { operation: "stock.reservation.create", key: idempotencyKey, payload: { ...input, idempotencyKey: undefined } });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  await lockInventoryItem(client, c, input.itemId);
  const values = [c.organizationId, input.itemId, input.warehouseId];
  let dimensionFilter = "";
  if (input.warehouseLocationId) { values.push(input.warehouseLocationId); dimensionFilter += ` AND balance.warehouse_location_id=$${values.length}`; }
  if (input.batchId) { values.push(input.batchId); dimensionFilter += ` AND balance.batch_id=$${values.length}`; }
  const balance = (await client.query(
    `SELECT balance.* FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
      WHERE balance.organization_id=$1 AND balance.item_id=$2 AND balance.warehouse_id=$3${dimensionFilter}
        AND balance.quantity-balance.reserved_quantity >= $${values.length + 1} AND ${USABLE_ROW}
      ORDER BY (balance.quantity-balance.reserved_quantity) DESC,balance.updated_at ASC
      LIMIT 1 FOR UPDATE OF balance`,
    [...values, quantity],
  )).rows[0];
  if (!balance) throw new StockError(409, "Insufficient available stock for this reservation.", "STOCK_RESERVATION_INSUFFICIENT");
  await assertQualityAllowsDecrease(client, c, { itemId: input.itemId, warehouseId: input.warehouseId, warehouseLocationId: balance.warehouse_location_id, batchId: balance.batch_id, serialId: null }, quantity, balance);
  const created = await insertReservation(client, c, balance, quantity, input, idempotencyKey);
  const response = { ...created, replayed: false };
  await completeIdempotentOperation(client, c, idempotency, { response, aggregateType: "stock_reservation", aggregateId: created.id });
  return response;
}

// Reserves as much as is usable and free now, up to maxQuantity, in one
// warehouse: the product is locked first, so two requests can never reserve
// the same unit; stock spread over several locations or batches is reserved
// from each (one reservation per row). Stock under quality hold is left.
// input: { itemId, warehouseId, maxQuantity, referenceType, referenceId, salesOrderId?, salesOrderLineId?, salesQuantityPerBase?, salesUom? }
// Returns { requested, reserved, reservations }.
export async function reserveAvailableStock(client, c, input = {}) {
  need(c, "stock.reserve");
  const wanted = num(input.maxQuantity, "Quantity");
  if (!input.referenceType || !input.referenceId)
    throw new StockError(400, "Reservation reference type and reference id are required.", "STOCK_RESERVATION_REFERENCE_REQUIRED");
  await stockDimension(client, c, { itemId: input.itemId, warehouseId: input.warehouseId });
  await lockInventoryItem(client, c, input.itemId);
  const rows = (await client.query(
    `SELECT balance.* FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
      WHERE balance.organization_id=$1 AND balance.item_id=$2 AND balance.warehouse_id=$3 AND balance.quantity-balance.reserved_quantity > 0 AND ${USABLE_ROW}
      ORDER BY (balance.quantity-balance.reserved_quantity) DESC,balance.updated_at ASC
      FOR UPDATE OF balance`,
    [c.organizationId, input.itemId, input.warehouseId],
  )).rows;
  const holds = (await client.query(
    `SELECT bool_or(quantity=0) AS blocks_all, COALESCE(sum(CASE WHEN quantity=0 THEN 0 ELSE greatest(quantity-released_quantity,0) END),0) AS held
       FROM tenant.quality_holds WHERE organization_id=$1 AND item_id=$2 AND status='active' AND hold_type IN ('inventory','batch','serial') AND (warehouse_id IS NULL OR warehouse_id=$3)`,
    [c.organizationId, input.itemId, input.warehouseId],
  )).rows[0];
  if (holds?.blocks_all) return { requested: wanted, reserved: 0, reservations: [], blockedByQuality: true };
  const free = Math.max(0, rows.reduce((total, row) => total + Number(row.quantity) - Number(row.reserved_quantity), 0) - Number(holds?.held ?? 0));
  let left = Math.min(wanted, free);
  const reservations = [];
  for (const row of rows) {
    if (left <= 1e-9) break;
    const take = reservationRound(Math.min(left, Number(row.quantity) - Number(row.reserved_quantity)));
    if (take <= 1e-9) continue;
    const perBase = Number(input.salesQuantityPerBase) || null;
    reservations.push(await insertReservation(client, c, row, take, { ...input, salesQuantity: perBase ? reservationRound(take * perBase) : null }, null));
    left = reservationRound(left - take);
  }
  return { requested: wanted, reserved: reservationRound(reservations.reduce((total, row) => total + Number(row.quantity), 0)), reservations, blockedByQuality: false };
}

// Gives back what a reservation still holds, or part of it.
// options: { status: "released" | "cancelled" | "consumed", quantity?, reasonCode?, reason? }
// "consumed" closes what is left as consumed (a work order that used its material).
export async function releaseStockReservation(client, c, id, { status = "released", quantity = null, reasonCode = null, reason = null } = {}) {
  need(c, "stock.reserve");
  if (!new Set(["released", "cancelled", "consumed"]).has(status))
    throw new StockError(400, "Reservation close status is invalid.", "STOCK_RESERVATION_STATUS_INVALID");
  const reservation = (await client.query(`SELECT * FROM tenant.stock_reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!reservation) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  if (reservation.status !== "active") return reservation;
  const active = Number(reservation.active_quantity);
  const amount = quantity == null ? active : reservationRound(num(quantity, "Quantity to release"));
  if (amount > active + 1e-9) throw new StockError(409, `Only ${active} is still reserved.`, "STOCK_RESERVATION_EXCEEDS_ACTIVE");
  await adjustReservedBalance(client, c, reservation, amount);
  const closing = amount + 1e-9 >= active;
  const consumed = status === "consumed";
  const { rows } = await client.query(
    `UPDATE tenant.stock_reservations
        SET consumed_quantity=consumed_quantity+$3, released_quantity=released_quantity+$4,
            status=CASE WHEN $5 THEN (CASE WHEN $6 THEN 'consumed' WHEN consumed_quantity > 0 AND $7 = 'released' THEN 'consumed' ELSE $7 END) ELSE 'active' END,
            released_at=CASE WHEN $5 THEN now() ELSE released_at END, released_by=$8, release_reason_code=COALESCE($9, release_reason_code), release_reason=COALESCE($10, release_reason),
            updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, id, consumed ? amount : 0, consumed ? 0 : amount, closing, consumed, status, c.userId ?? null, reasonCode, reason],
  );
  return rows[0];
}

// A delivery used part or all of a reservation: the reservation is consumed,
// the stock is issued from the very row it was reserved in, and the
// consumption is recorded with the delivery and the movement, together.
// reference: { deliveryId?, deliveryLineId?, issue: { referenceType, referenceId, idempotencyKey } }
export async function consumeStockReservation(client, c, id, quantity, reference = {}) {
  need(c, "stock.reserve");
  const amount = reservationRound(num(quantity, "Quantity consumed"));
  const reservation = (await client.query(`SELECT * FROM tenant.stock_reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!reservation) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  if (reservation.status !== "active" || amount > Number(reservation.active_quantity) + 1e-9)
    throw new StockError(409, `Only ${Number(reservation.active_quantity)} is still reserved on ${reservation.reservation_number ?? "this reservation"}.`, "STOCK_RESERVATION_EXCEEDS_ACTIVE");
  await adjustReservedBalance(client, c, reservation, amount);
  const { rows } = await client.query(
    `UPDATE tenant.stock_reservations
        SET consumed_quantity=consumed_quantity+$3, last_consumed_at=now(),
            status=CASE WHEN quantity-consumed_quantity-released_quantity-$3 <= 0 THEN 'consumed' ELSE 'active' END,
            released_at=CASE WHEN quantity-consumed_quantity-released_quantity-$3 <= 0 THEN now() ELSE released_at END, updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, id, amount],
  );
  const movement = reference.issue
    ? await postStockMovement(client, c, {
      movementType: "issue", itemId: reservation.item_id, warehouseId: reservation.warehouse_id, warehouseLocationId: reservation.warehouse_location_id,
      batchId: reservation.batch_id, quantity: amount, referenceType: reference.issue.referenceType, referenceId: reference.issue.referenceId,
      idempotencyKey: reference.issue.idempotencyKey,
    })
    : null;
  await client.query(
    `INSERT INTO tenant.stock_reservation_consumptions (organization_id, reservation_id, quantity, delivery_id, delivery_line_id, stock_movement_id, consumed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, id, amount, reference.deliveryId ?? null, reference.deliveryLineId ?? null, movement?.id ?? null, c.userId ?? null],
  );
  return { ...rows[0], stockMovementId: movement?.id ?? null };
}

async function adjustReservedBalance(client, c, reservation, amount) {
  const balance = (await client.query(
    `SELECT reserved_quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3
       AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5 FOR UPDATE`,
    [c.organizationId, reservation.item_id, reservation.warehouse_id, reservation.warehouse_location_id, reservation.batch_id],
  )).rows[0];
  if (!balance || Number(balance.reserved_quantity) + 1e-9 < amount)
    throw new StockError(409, "Reservation balance is inconsistent; reconcile stock reservations before releasing it.", "STOCK_RESERVATION_DRIFT");
  await client.query(
    `UPDATE tenant.stock_balances SET reserved_quantity=greatest(reserved_quantity-$6,0),updated_at=now()
      WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`,
    [c.organizationId, reservation.item_id, reservation.warehouse_id, reservation.warehouse_location_id, reservation.batch_id, amount],
  );
}

export async function listActiveStockReservationsByReference(client, c, { referenceType, referenceId }) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT * FROM tenant.stock_reservations
      WHERE organization_id=$1 AND reference_type=$2 AND reference_id=$3 AND status='active' ORDER BY created_at, id`,
    [c.organizationId, String(referenceType).slice(0, 100), referenceId],
  );
  return rows;
}

// The reserved quantity cached on each balance row against the active
// reservations that make it up. With repair, the cache is rebuilt from the reservations.
export async function reconcileStockReservations(client, c, { repair = false } = {}) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT balance.id, balance.item_id, balance.warehouse_id, balance.warehouse_location_id, balance.batch_id, balance.reserved_quantity AS cached,
            COALESCE((SELECT sum(reservation.active_quantity) FROM tenant.stock_reservations reservation
                       WHERE reservation.organization_id=balance.organization_id AND reservation.item_id=balance.item_id AND reservation.warehouse_id=balance.warehouse_id
                         AND reservation.warehouse_location_id IS NOT DISTINCT FROM balance.warehouse_location_id AND reservation.batch_id IS NOT DISTINCT FROM balance.batch_id
                         AND reservation.status='active'), 0) AS actual
       FROM tenant.stock_balances balance WHERE balance.organization_id=$1`,
    [c.organizationId],
  );
  const mismatches = rows.filter((row) => Math.abs(Number(row.cached) - Number(row.actual)) > 1e-6)
    .map((row) => ({ balanceId: row.id, itemId: row.item_id, warehouseId: row.warehouse_id, cachedReserved: Number(row.cached), activeReservations: Number(row.actual) }));
  if (repair && mismatches.length) {
    need(c, "stock.adjust");
    for (const mismatch of mismatches)
      await client.query(`UPDATE tenant.stock_balances SET reserved_quantity=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, mismatch.balanceId, mismatch.activeReservations]);
  }
  return { checked: rows.length, mismatchCount: mismatches.length, mismatches, repaired: repair ? mismatches.length : 0 };
}

export async function listStockOperationOptions(client,c){
  need(c,"stock.view");
  const [items,warehouses,locations,batches]=await Promise.all([
    client.query(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 500`,[c.organizationId]),
    client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`,[c.organizationId]),
    client.query(`SELECT l.id,l.code,l.name,l.warehouse_id FROM tenant.warehouse_locations l JOIN tenant.warehouses w ON w.organization_id=l.organization_id AND w.id=l.warehouse_id WHERE l.organization_id=$1 AND l.status='active' AND w.status='active' ORDER BY w.code,l.code LIMIT 1000`,[c.organizationId]),
    client.query(`SELECT id,batch_number AS code,batch_number AS name,item_id FROM tenant.stock_batches WHERE organization_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 500`,[c.organizationId]),
  ]);
  return {items:items.rows,warehouses:warehouses.rows,locations:locations.rows,batches:batches.rows};
}

// Batch and serial registration, used by Manufacturing when production creates or receives tracked stock.
export { createStockBatch, receiveSerializedStock } from "./master-operations.js";
