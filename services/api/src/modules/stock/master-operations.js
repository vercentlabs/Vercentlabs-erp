import { StockError, postStockMovement } from "./index.js";

// Stock operations that sit around the movement ledger: organisation settings, scan/lookup,
// batch and serial registration, and reorder rules. Everything here is scoped to the
// caller's organisation, like the rest of the module.
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
const date = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(value)) || Number.isNaN(Date.parse(String(value)))) throw new StockError(400, `${label} is not a valid date.`, "STOCK_DATE_INVALID");
  return String(value).slice(0, 10);
};

// ---------------------------------------------------------------- settings
// The negative-stock policy has its own setting, permission and audit (negative-stock.js); it is read here for display only.
const SETTINGS_DEFAULTS = Object.freeze({ costing_method: "moving_average", negative_stock_policy: "block", negative_stock_alerts_enabled: true, adjustment_value_threshold: null });

export async function getStockSettings(client, c) {
  need(c, "stock.view");
  const { rows } = await client.query(`SELECT costing_method,negative_stock_policy,negative_stock_alerts_enabled,adjustment_value_threshold,updated_at FROM tenant.stock_settings WHERE organization_id=$1`, [c.organizationId]);
  return { ...SETTINGS_DEFAULTS, ...(rows[0] || {}), configured: Boolean(rows[0]) };
}

export async function updateStockSettings(client, c, input = {}) {
  need(c, "stock.settings.manage");
  const current = await getStockSettings(client, c);
  const method = input.costingMethod === undefined ? current.costing_method : String(input.costingMethod);
  if (!["moving_average", "fifo"].includes(method)) throw new StockError(400, "The default valuation method is Moving Average or FIFO.", "STOCK_SETTINGS_INVALID");
  // Stock Adjustments above this absolute value need the large-adjustment permission to post (empty: no threshold).
  const rawThreshold = input.adjustmentValueThreshold === undefined ? current.adjustment_value_threshold : input.adjustmentValueThreshold;
  const threshold = rawThreshold === null || rawThreshold === "" ? null : Number(rawThreshold);
  if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0))
    throw new StockError(400, "The adjustment value threshold is an amount of zero or more (or empty for none).", "STOCK_SETTINGS_INVALID");
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_settings(organization_id,costing_method,adjustment_value_threshold,updated_by) VALUES($1,$2,$3,$4)
     ON CONFLICT (organization_id) DO UPDATE SET costing_method=EXCLUDED.costing_method,
       adjustment_value_threshold=EXCLUDED.adjustment_value_threshold,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING costing_method,negative_stock_policy,negative_stock_alerts_enabled,adjustment_value_threshold,updated_at`,
    [c.organizationId, method, threshold, c.userId],
  );
  return { ...rows[0], configured: true };
}


// ---------------------------------------------------------------- batches (F115-F118)
async function trackedItem(client, c, itemId, expected) {
  const item = (await client.query(`SELECT id,code,name,tracking_type,track_inventory,status FROM tenant.items WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(itemId, "Item")])).rows[0];
  if (!item) throw new StockError(404, "Item was not found.", "STOCK_ITEM_NOT_FOUND");
  if (item.status !== "active") throw new StockError(409, "This item is not active.", "STOCK_ITEM_INACTIVE");
  if (expected && item.tracking_type !== expected) {
    throw new StockError(409, `This item is not ${expected}-tracked. Change its tracking type on the item first.`, `STOCK_ITEM_NOT_${expected.toUpperCase()}_TRACKED`);
  }
  return item;
}

export async function createStockBatch(client, c, input = {}) {
  need(c, "stock.manage");
  const item = await trackedItem(client, c, input.itemId, "batch");
  const batchNumber = text(input.batchNumber, 120);
  if (!batchNumber) throw new StockError(400, "A batch (lot) number is required.", "STOCK_BATCH_NUMBER_REQUIRED");
  const manufacturedOn = date(input.manufacturedOn, "Manufactured date");
  const expiresOn = date(input.expiresOn, "Expiry date");
  if (manufacturedOn && expiresOn && expiresOn < manufacturedOn) throw new StockError(400, "The expiry date cannot be before the manufactured date.", "STOCK_BATCH_DATES_INVALID");
  const duplicate = await client.query(`SELECT 1 FROM tenant.stock_batches WHERE organization_id=$1 AND item_id=$2 AND lower(batch_number)=lower($3)`, [c.organizationId, item.id, batchNumber]);
  if (duplicate.rows[0]) throw new StockError(409, `Batch ${batchNumber} already exists for this item.`, "STOCK_BATCH_DUPLICATE");
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_batches(organization_id,item_id,batch_number,manufactured_on,expires_on,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [c.organizationId, item.id, batchNumber, manufacturedOn, expiresOn, text(input.notes, 2000) || null, c.userId],
  );
  return rows[0];
}

export async function setStockBatchStatus(client, c, batchId, status, reason) {
  need(c, "stock.manage");
  if (!["active", "blocked", "expired"].includes(status)) throw new StockError(400, "Batch status must be active, blocked or expired.", "STOCK_BATCH_STATUS_INVALID");
  if (status !== "active" && !text(reason, 1000)) throw new StockError(400, "A reason is required to block or expire a batch.", "STOCK_REASON_REQUIRED");
  if (status !== "active") {
    const held = (await client.query(`SELECT count(*)::int AS count, COALESCE(sum(active_quantity), 0) AS quantity FROM tenant.stock_reservations WHERE organization_id=$1 AND batch_id=$2 AND status='active'`,
      [c.organizationId, uuid(batchId, "Batch")])).rows[0];
    if (held.count) throw new StockError(409, `${held.count} active reservation${held.count === 1 ? "" : "s"} hold ${Number(held.quantity)} of this batch. Reallocate or release them before it is ${status}.`, "STOCK_BATCH_RESERVED");
  }
  const { rows } = await client.query(
    `UPDATE tenant.stock_batches SET status=$3,notes=COALESCE(NULLIF($4,''),notes),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, uuid(batchId, "Batch"), status, text(reason, 1000)],
  );
  if (!rows[0]) throw new StockError(404, "Batch was not found.", "STOCK_BATCH_NOT_FOUND");
  return rows[0];
}

// ---------------------------------------------------------------- serials (F117)
// Receiving serial-tracked stock: ONE receipt movement for the count plus the serial
// rows, in one transaction, so the balance and the serial register cannot disagree.
// Serial-numbered stock comes in one unit per serial number: each is registered and received by its own movement, so its history starts
// with its receipt. A retry with the same idempotency key receives nothing twice.
export async function receiveSerializedStock(client, c, input = {}) {
  need(c, "stock.receive");
  const item = await trackedItem(client, c, input.itemId, "serial");
  const numbers = [...new Set((Array.isArray(input.serialNumbers) ? input.serialNumbers : String(input.serialNumbers || "").split(/[\s,;]+/)).map((n) => text(n, 120)).filter(Boolean))];
  if (!numbers.length) throw new StockError(400, "Enter at least one serial number.", "STOCK_SERIALS_REQUIRED");
  if (numbers.length > 500) throw new StockError(400, "Receive at most 500 serial numbers at a time.", "STOCK_SERIALS_TOO_MANY");
  const key = text(input.idempotencyKey, 200) || null;
  const keyOf = (serialNumber) => (key ? `${key}:${serialNumber.toLowerCase()}` : undefined);
  if (key) {
    const done = (await client.query(`SELECT * FROM tenant.stock_movements WHERE organization_id=$1 AND idempotency_key=ANY($2::text[]) ORDER BY ledger_sequence`,
      [c.organizationId, numbers.map(keyOf)])).rows;
    if (done.length === numbers.length) return { movement: { ...done[0], replayed: true }, movements: done, serials: [], replayed: true };
  }
  const existing = await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id=$1 AND lower(serial_number)=ANY($2::text[])`, [c.organizationId, numbers.map((n) => n.toLowerCase())]);
  if (existing.rows.length) throw new StockError(409, `Serial number ${existing.rows[0].serial_number} is already registered.`, "STOCK_SERIAL_DUPLICATE");
  const serials = [];
  const movements = [];
  for (const serialNumber of numbers) {
    const serial = (await client.query(
      `INSERT INTO tenant.stock_serials(organization_id,item_id,serial_number,warehouse_id,warehouse_location_id,status,batch_id) VALUES($1,$2,$3,$4,$5,'available',$6) RETURNING *`,
      [c.organizationId, item.id, serialNumber, input.warehouseId, input.warehouseLocationId || null, input.batchId || null],
    )).rows[0];
    movements.push(await postStockMovement(client, c, {
      movementType: "receipt", itemId: item.id, warehouseId: input.warehouseId, warehouseLocationId: input.warehouseLocationId || null, batchId: input.batchId || null,
      serialId: serial.id, serialRegistered: true, quantity: 1, unitCost: input.unitCost, costSource: input.costSource, costSnapshot: input.costSnapshot, referenceType: input.referenceType || null, referenceId: input.referenceId || null,
      sourceLineId: input.sourceLineId, ledgerType: input.ledgerType, groupId: input.groupId, occurredOn: input.occurredOn,
      reason: text(input.reason, 500) || "Serialized receipt", idempotencyKey: keyOf(serialNumber),
    }));
    serials.push((await client.query(`SELECT * FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`, [c.organizationId, serial.id])).rows[0]);
  }
  return { movement: movements[0], movements, serials, replayed: false };
}

