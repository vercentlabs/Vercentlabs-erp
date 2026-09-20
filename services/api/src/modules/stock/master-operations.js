import { StockError, postStockMovement } from "./index.js";

// Stock operations that sit around the movement ledger: company settings, scan/lookup,
// batch and serial registration, and reorder rules. Everything here is scoped to the
// caller's organisation and ACTIVE company, like the rest of the module.
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
const nonNegative = (value, label, { allowNull = false } = {}) => {
  if ((value === undefined || value === null || value === "") && allowNull) return null;
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new StockError(400, `${label} must be zero or greater.`, "STOCK_QUANTITY_INVALID");
  return n;
};
const date = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(value)) || Number.isNaN(Date.parse(String(value)))) throw new StockError(400, `${label} is not a valid date.`, "STOCK_DATE_INVALID");
  return String(value).slice(0, 10);
};

// ---------------------------------------------------------------- settings
const SETTINGS_DEFAULTS = Object.freeze({ costing_method: "moving_average", allow_negative_stock: false });

export async function getStockSettings(client, c) {
  need(c, "stock.view");
  const { rows } = await client.query(`SELECT costing_method,allow_negative_stock,updated_at FROM tenant.stock_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]);
  return { ...SETTINGS_DEFAULTS, ...(rows[0] || {}), configured: Boolean(rows[0]) };
}

export async function updateStockSettings(client, c, input = {}) {
  need(c, "stock.settings.manage");
  const current = await getStockSettings(client, c);
  const method = input.costingMethod === undefined ? current.costing_method : String(input.costingMethod);
  if (!["moving_average", "fifo", "standard"].includes(method)) throw new StockError(400, "Costing method must be moving_average, fifo or standard.", "STOCK_SETTINGS_INVALID");
  const allowNegative = input.allowNegativeStock === undefined ? current.allow_negative_stock : Boolean(input.allowNegativeStock);
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_settings(organization_id,company_id,costing_method,allow_negative_stock,updated_by) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (organization_id,company_id) DO UPDATE SET costing_method=EXCLUDED.costing_method,allow_negative_stock=EXCLUDED.allow_negative_stock,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING costing_method,allow_negative_stock,updated_at`,
    [c.organizationId, c.companyId, method, allowNegative, c.userId],
  );
  return { ...rows[0], configured: true };
}

// ---------------------------------------------------------------- scan / lookup (F119)
// Resolves whatever a scanner or a person typed: an item code or barcode, a variant SKU or
// barcode, a batch number, or a serial number -- and says what it found.
export async function lookupStockByCode(client, c, input = {}) {
  need(c, "stock.view");
  const code = text(input.code, 200);
  if (!code) throw new StockError(400, "Scan or enter a code.", "STOCK_CODE_REQUIRED");
  const companyScope = "(item.company_id IS NULL OR item.company_id=$2)";
  const itemColumns = "item.id,item.code,item.name,item.barcode,item.tracking_type,item.track_inventory,item.uom_id,item.status";
  const summary = async (itemId) => {
    const r = await client.query(
      `SELECT COALESCE(sum(quantity),0)::text AS on_hand,COALESCE(sum(reserved_quantity),0)::text AS reserved,COALESCE(sum(quantity-reserved_quantity),0)::text AS available FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3`,
      [c.organizationId, c.companyId, itemId],
    );
    return r.rows[0];
  };
  const item = (await client.query(`SELECT ${itemColumns} FROM tenant.items item WHERE item.organization_id=$1 AND ${companyScope} AND (lower(item.code)=lower($3) OR lower(item.barcode)=lower($3)) LIMIT 1`, [c.organizationId, c.companyId, code])).rows[0];
  if (item) return { kind: "item", item, stock: await summary(item.id) };
  const variant = (
    await client.query(
      `SELECT variant.id AS variant_id,variant.sku,variant.name AS variant_name,${itemColumns} FROM tenant.item_variants variant JOIN tenant.items item ON item.organization_id=variant.organization_id AND item.id=variant.item_id
        WHERE variant.organization_id=$1 AND ${companyScope} AND (lower(variant.sku)=lower($3) OR lower(variant.barcode)=lower($3)) LIMIT 1`,
      [c.organizationId, c.companyId, code],
    )
  ).rows[0];
  if (variant) return { kind: "variant", item: { id: variant.id, code: variant.code, name: variant.name, barcode: variant.barcode, tracking_type: variant.tracking_type, track_inventory: variant.track_inventory, uom_id: variant.uom_id, status: variant.status }, variant: { id: variant.variant_id, sku: variant.sku, name: variant.variant_name }, stock: await summary(variant.id) };
  const batch = (
    await client.query(
      `SELECT batch.id AS batch_id,batch.batch_number,batch.expires_on,batch.status AS batch_status,${itemColumns} FROM tenant.stock_batches batch JOIN tenant.items item ON item.organization_id=batch.organization_id AND item.id=batch.item_id
        WHERE batch.organization_id=$1 AND batch.company_id=$2 AND lower(batch.batch_number)=lower($3) LIMIT 1`,
      [c.organizationId, c.companyId, code],
    )
  ).rows[0];
  if (batch) return { kind: "batch", item: { id: batch.id, code: batch.code, name: batch.name, tracking_type: batch.tracking_type, uom_id: batch.uom_id, status: batch.status }, batch: { id: batch.batch_id, batch_number: batch.batch_number, expires_on: batch.expires_on, status: batch.batch_status }, stock: await summary(batch.id) };
  const serial = (
    await client.query(
      `SELECT serial.id AS serial_id,serial.serial_number,serial.status AS serial_status,serial.warehouse_id,${itemColumns} FROM tenant.stock_serials serial JOIN tenant.items item ON item.organization_id=serial.organization_id AND item.id=serial.item_id
        WHERE serial.organization_id=$1 AND serial.company_id=$2 AND lower(serial.serial_number)=lower($3) LIMIT 1`,
      [c.organizationId, c.companyId, code],
    )
  ).rows[0];
  if (serial) return { kind: "serial", item: { id: serial.id, code: serial.code, name: serial.name, tracking_type: serial.tracking_type, uom_id: serial.uom_id, status: serial.status }, serial: { id: serial.serial_id, serial_number: serial.serial_number, status: serial.serial_status, warehouse_id: serial.warehouse_id }, stock: await summary(serial.id) };
  throw new StockError(404, `Nothing matches "${code}".`, "STOCK_CODE_NOT_FOUND");
}

// ---------------------------------------------------------------- batches (F115-F118)
async function trackedItem(client, c, itemId, expected) {
  const item = (await client.query(`SELECT id,company_id,code,name,tracking_type,track_inventory,status FROM tenant.items WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(itemId, "Item")])).rows[0];
  if (!item || (item.company_id && item.company_id !== c.companyId)) throw new StockError(404, "Item was not found for the active company.", "STOCK_ITEM_NOT_FOUND");
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
  const duplicate = await client.query(`SELECT 1 FROM tenant.stock_batches WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND lower(batch_number)=lower($4)`, [c.organizationId, c.companyId, item.id, batchNumber]);
  if (duplicate.rows[0]) throw new StockError(409, `Batch ${batchNumber} already exists for this item.`, "STOCK_BATCH_DUPLICATE");
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_batches(organization_id,company_id,item_id,batch_number,manufactured_on,expires_on,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [c.organizationId, c.companyId, item.id, batchNumber, manufacturedOn, expiresOn, text(input.notes, 2000) || null, c.userId],
  );
  return rows[0];
}

export async function setStockBatchStatus(client, c, batchId, status, reason) {
  need(c, "stock.manage");
  if (!["active", "blocked", "expired"].includes(status)) throw new StockError(400, "Batch status must be active, blocked or expired.", "STOCK_BATCH_STATUS_INVALID");
  if (status !== "active" && !text(reason, 1000)) throw new StockError(400, "A reason is required to block or expire a batch.", "STOCK_REASON_REQUIRED");
  const { rows } = await client.query(
    `UPDATE tenant.stock_batches SET status=$4,notes=COALESCE(NULLIF($5,''),notes),updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, uuid(batchId, "Batch"), status, text(reason, 1000)],
  );
  if (!rows[0]) throw new StockError(404, "Batch was not found.", "STOCK_BATCH_NOT_FOUND");
  return rows[0];
}

// Batches with what is on hand in each, and days to expiry -- the basis of the expiry screen.
export async function listStockBatchesWithBalance(client, c, { withinDays = null, limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (withinDays !== null && withinDays !== undefined && withinDays !== "") {
    values.push(Math.max(0, Math.trunc(Number(withinDays))));
    filter = ` AND batch.expires_on IS NOT NULL AND batch.expires_on <= current_date+$${values.length}::int`;
  }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT batch.*,item.code AS item_code,item.name AS item_name,
            COALESCE(sum(balance.quantity),0)::text AS on_hand_quantity,
            CASE WHEN batch.expires_on IS NULL THEN NULL ELSE (batch.expires_on-current_date) END AS days_to_expiry
       FROM tenant.stock_batches batch
       JOIN tenant.items item ON item.organization_id=batch.organization_id AND item.id=batch.item_id
       LEFT JOIN tenant.stock_balances balance ON balance.organization_id=batch.organization_id AND balance.company_id=batch.company_id AND balance.batch_id=batch.id
      WHERE batch.organization_id=$1 AND batch.company_id=$2${filter}
      GROUP BY batch.id,item.code,item.name
      ORDER BY batch.expires_on NULLS LAST,batch.created_at DESC
      LIMIT $${values.length}`,
    values,
  );
  return rows;
}

// ---------------------------------------------------------------- serials (F117)
// Receiving serial-tracked stock: ONE receipt movement for the count plus the serial
// rows, in one transaction, so the balance and the serial register cannot disagree.
export async function receiveSerializedStock(client, c, input = {}) {
  need(c, "stock.receive");
  const item = await trackedItem(client, c, input.itemId, "serial");
  const numbers = [...new Set((Array.isArray(input.serialNumbers) ? input.serialNumbers : String(input.serialNumbers || "").split(/[\s,;]+/)).map((n) => text(n, 120)).filter(Boolean))];
  if (!numbers.length) throw new StockError(400, "Enter at least one serial number.", "STOCK_SERIALS_REQUIRED");
  if (numbers.length > 500) throw new StockError(400, "Receive at most 500 serial numbers at a time.", "STOCK_SERIALS_TOO_MANY");
  const existing = await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id=$1 AND company_id=$2 AND lower(serial_number)=ANY($3::text[])`, [c.organizationId, c.companyId, numbers.map((n) => n.toLowerCase())]);
  if (existing.rows.length) throw new StockError(409, `Serial number ${existing.rows[0].serial_number} is already registered.`, "STOCK_SERIAL_DUPLICATE");
  const movement = await postStockMovement(client, c, {
    movementType: "receipt",
    itemId: item.id,
    warehouseId: input.warehouseId,
    warehouseLocationId: input.warehouseLocationId || null,
    batchId: input.batchId || null,
    quantity: numbers.length,
    unitCost: input.unitCost,
    referenceType: input.referenceType || null,
    referenceId: input.referenceId || null,
    reason: text(input.reason, 500) || "Serialized receipt",
    idempotencyKey: input.idempotencyKey,
  });
  if (movement.replayed) return { movement, serials: [], replayed: true };
  const serials = [];
  for (const serialNumber of numbers) {
    const r = await client.query(
      `INSERT INTO tenant.stock_serials(organization_id,company_id,item_id,serial_number,warehouse_id,warehouse_location_id,status,batch_id) VALUES($1,$2,$3,$4,$5,$6,'available',$7) RETURNING *`,
      [c.organizationId, c.companyId, item.id, serialNumber, input.warehouseId, input.warehouseLocationId || null, input.batchId || null],
    );
    serials.push(r.rows[0]);
  }
  return { movement, serials, replayed: false };
}

export async function listStockSerialsDetailed(client, c, { itemId = null, status = null, limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (itemId) { values.push(uuid(itemId, "Item")); filter += ` AND serial.item_id=$${values.length}`; }
  if (status) { values.push(String(status)); filter += ` AND serial.status=$${values.length}`; }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT serial.*,item.code AS item_code,item.name AS item_name FROM tenant.stock_serials serial JOIN tenant.items item ON item.organization_id=serial.organization_id AND item.id=serial.item_id
      WHERE serial.organization_id=$1 AND serial.company_id=$2${filter} ORDER BY serial.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

// ---------------------------------------------------------------- reorder rules (F122-F125)
export async function saveStockReorderRule(client, c, input = {}) {
  need(c, "stock.manage");
  const item = await trackedItem(client, c, input.itemId);
  if (!item.track_inventory) throw new StockError(409, "Only inventory-tracked items can have reorder rules.", "STOCK_ITEM_NOT_TRACKED");
  const warehouseId = uuid(input.warehouseId, "Warehouse");
  const warehouse = (await client.query(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND status='active'`, [c.organizationId, warehouseId, c.companyId])).rows[0];
  if (!warehouse) throw new StockError(404, "Warehouse was not found for the active company.", "STOCK_WAREHOUSE_NOT_FOUND");
  const minimum = nonNegative(input.minimumQuantity, "Minimum quantity");
  const safety = nonNegative(input.safetyQuantity, "Safety stock");
  const maximum = nonNegative(input.maximumQuantity, "Maximum quantity", { allowNull: true });
  const reorder = Number(input.reorderQuantity);
  if (!Number.isFinite(reorder) || reorder <= 0) throw new StockError(400, "Reorder quantity must be greater than zero.", "STOCK_REORDER_QUANTITY_INVALID");
  if (maximum !== null && maximum > 0 && maximum < minimum + safety) throw new StockError(400, "The maximum must be at least the minimum plus safety stock.", "STOCK_MAXIMUM_BELOW_MINIMUM");
  const lead = input.leadTimeDays === undefined || input.leadTimeDays === null || input.leadTimeDays === "" ? 0 : Math.trunc(Number(input.leadTimeDays));
  if ((!Number.isFinite(lead) || lead < 0 || lead > 3650)) throw new StockError(400, "Lead time must be between 0 and 3650 days.", "STOCK_LEAD_TIME_INVALID");
  const supplierId = input.preferredSupplierId ? uuid(input.preferredSupplierId, "Supplier") : null;
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_reorder_rules(organization_id,company_id,item_id,warehouse_id,minimum_quantity,reorder_quantity,maximum_quantity,safety_quantity,preferred_supplier_id,lead_time_days,active,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (organization_id,company_id,item_id,warehouse_id) DO UPDATE SET minimum_quantity=EXCLUDED.minimum_quantity,reorder_quantity=EXCLUDED.reorder_quantity,maximum_quantity=EXCLUDED.maximum_quantity,
       safety_quantity=EXCLUDED.safety_quantity,preferred_supplier_id=EXCLUDED.preferred_supplier_id,lead_time_days=EXCLUDED.lead_time_days,active=EXCLUDED.active,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [c.organizationId, c.companyId, item.id, warehouseId, minimum, reorder, maximum, safety, supplierId, lead, input.active === undefined ? true : Boolean(input.active), c.userId],
  );
  return rows[0];
}

export async function listStockReorderRulesDetailed(client, c) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT rule.*,item.code AS item_code,item.name AS item_name,warehouse.name AS warehouse_name,
            COALESCE(sum(balance.quantity),0)::text AS on_hand_quantity,COALESCE(sum(balance.quantity-balance.reserved_quantity),0)::text AS available_quantity
       FROM tenant.stock_reorder_rules rule
       JOIN tenant.items item ON item.organization_id=rule.organization_id AND item.id=rule.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id=rule.organization_id AND warehouse.id=rule.warehouse_id
       LEFT JOIN tenant.stock_balances balance ON balance.organization_id=rule.organization_id AND balance.company_id=rule.company_id AND balance.item_id=rule.item_id AND balance.warehouse_id=rule.warehouse_id
      WHERE rule.organization_id=$1 AND rule.company_id=$2
      GROUP BY rule.id,item.code,item.name,warehouse.name
      ORDER BY item.name,warehouse.name`,
    [c.organizationId, c.companyId],
  );
  return rows;
}
