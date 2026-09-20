import { nextDocumentNumber } from "../../core/document-numbering.js";
import { StockError, postStockMovement } from "./index.js";

// Cycle counts and physical inventory (F126-F128).
//
//   counting -> review -> posted        (or cancelled at any point before posting)
//
// Snapshot: creating a count captures the system quantity per (item, location, batch).
// Count: people enter what they physically counted; a reason is required for any variance.
// Review: the counter submits; an approver (a DIFFERENT person, holding stock.adjust) approves,
// and only then are the variances posted as stock adjustments -- the ledger stays append-only.
// A physical count can freeze its warehouse, so nothing moves while it is being counted.
// Serial-tracked items are not counted here (their units are individually registered).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new StockError(400, `${label} is invalid.`, "STOCK_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p)) throw new StockError(403, "You do not have permission to perform this stock operation.", "STOCK_FORBIDDEN");
};

async function loadCount(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.stock_counts WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Count")]);
  if (!rows[0]) throw new StockError(404, "Count was not found.", "STOCK_COUNT_NOT_FOUND");
  return rows[0];
}
const requireStatus = (count, ...allowed) => {
  if (!allowed.includes(count.status)) throw new StockError(409, `This count is ${count.status}; that action needs it to be ${allowed.join(" or ")}.`, "STOCK_COUNT_STATE_INVALID");
};

export async function createStockCount(client, c, input = {}) {
  need(c, "stock.count");
  const countType = String(input.countType || "");
  if (!["cycle", "physical"].includes(countType)) throw new StockError(400, "Count type must be cycle or physical.", "STOCK_COUNT_TYPE_INVALID");
  const warehouseId = uuid(input.warehouseId, "Warehouse");
  const warehouse = (await client.query(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND status='active'`, [c.organizationId, warehouseId, c.companyId])).rows[0];
  if (!warehouse) throw new StockError(404, "Warehouse was not found for the active company.", "STOCK_WAREHOUSE_NOT_FOUND");
  const locationId = input.warehouseLocationId ? uuid(input.warehouseLocationId, "Location") : null;
  const groupId = input.groupId ? uuid(input.groupId, "Category") : null;
  if (countType === "cycle" && !locationId && !groupId && !(Array.isArray(input.itemIds) && input.itemIds.length)) {
    throw new StockError(400, "A cycle count covers part of a warehouse: choose a location, a category or specific items.", "STOCK_COUNT_SCOPE_REQUIRED");
  }
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const replay = (await client.query(`SELECT * FROM tenant.stock_counts WHERE organization_id=$1 AND company_id=$2 AND idempotency_key=$3`, [c.organizationId, c.companyId, key])).rows[0];
    if (replay) return { ...replay, replayed: true };
  }
  const freeze = countType === "physical" ? input.freezeStock !== false : Boolean(input.freezeStock);
  if (freeze) {
    const other = (await client.query(`SELECT count_number FROM tenant.stock_counts WHERE organization_id=$1 AND company_id=$2 AND warehouse_id=$3 AND freeze_stock AND status IN ('counting','review') LIMIT 1`, [c.organizationId, c.companyId, warehouseId])).rows[0];
    if (other) throw new StockError(409, `Warehouse is already frozen by count ${other.count_number}.`, "STOCK_COUNT_FREEZE_CONFLICT");
  }
  const countNumber = await nextDocumentNumber(client, c, { documentType: "stock_count", prefix: countType === "physical" ? "PHY" : "CYC" });
  const count = (
    await client.query(
      `INSERT INTO tenant.stock_counts(organization_id,company_id,count_number,count_type,warehouse_id,warehouse_location_id,group_id,freeze_stock,blind,notes,created_by,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [c.organizationId, c.companyId, countNumber, countType, warehouseId, locationId, groupId, freeze, Boolean(input.blind), text(input.notes, 2000) || null, c.userId, key],
    )
  ).rows[0];

  // Snapshot: every non-serial balance in scope (a physical count covers the whole warehouse).
  const values = [c.organizationId, c.companyId, warehouseId];
  let scope = "";
  if (locationId) { values.push(locationId); scope += ` AND balance.warehouse_location_id=$${values.length}`; }
  if (groupId) { values.push(groupId); scope += ` AND item.group_id=$${values.length}`; }
  if (Array.isArray(input.itemIds) && input.itemIds.length) { values.push(input.itemIds.map((id) => uuid(id, "Item"))); scope += ` AND balance.item_id=ANY($${values.length}::uuid[])`; }
  const snapshot = await client.query(
    `INSERT INTO tenant.stock_count_lines(organization_id,count_id,item_id,warehouse_location_id,batch_id,system_quantity)
     SELECT balance.organization_id,'${count.id}'::uuid,balance.item_id,balance.warehouse_location_id,balance.batch_id,balance.quantity
       FROM tenant.stock_balances balance JOIN tenant.items item ON item.organization_id=balance.organization_id AND item.id=balance.item_id
      WHERE balance.organization_id=$1 AND balance.company_id=$2 AND balance.warehouse_id=$3 AND item.tracking_type<>'serial'${scope}`,
    values,
  );
  return { ...count, lineCount: snapshot.rowCount, replayed: false };
}

// A line for stock found that the system does not know about (system quantity 0).
export async function addStockCountLine(client, c, countId, input = {}) {
  need(c, "stock.count");
  const count = await loadCount(client, c, countId, { lock: true });
  requireStatus(count, "counting");
  const itemId = uuid(input.itemId, "Item");
  const item = (await client.query(`SELECT id,tracking_type,track_inventory FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active' AND (company_id IS NULL OR company_id=$3)`, [c.organizationId, itemId, c.companyId])).rows[0];
  if (!item || !item.track_inventory) throw new StockError(404, "Stock item was not found for the active company.", "STOCK_ITEM_NOT_FOUND");
  if (item.tracking_type === "serial") throw new StockError(409, "Serial-tracked items are not counted here.", "STOCK_COUNT_SERIAL_UNSUPPORTED");
  if (item.tracking_type === "batch" && !input.batchId) throw new StockError(400, "Choose the batch for a batch-tracked item.", "STOCK_BATCH_REQUIRED");
  const locationId = input.warehouseLocationId ? uuid(input.warehouseLocationId, "Location") : null;
  const batchId = input.batchId ? uuid(input.batchId, "Batch") : null;
  if (locationId) {
    const location = (await client.query(`SELECT 1 FROM tenant.warehouse_locations WHERE organization_id=$1 AND id=$2 AND warehouse_id=$3`, [c.organizationId, locationId, count.warehouse_id])).rows[0];
    if (!location) throw new StockError(404, "Location was not found in the counted warehouse.", "STOCK_LOCATION_NOT_FOUND");
  }
  try {
    const { rows } = await client.query(`INSERT INTO tenant.stock_count_lines(organization_id,count_id,item_id,warehouse_location_id,batch_id,system_quantity) VALUES($1,$2,$3,$4,$5,0) RETURNING *`, [c.organizationId, count.id, itemId, locationId, batchId]);
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw new StockError(409, "That item is already on this count.", "STOCK_COUNT_LINE_DUPLICATE");
    throw error;
  }
}

export async function recordStockCountLines(client, c, countId, lines = []) {
  need(c, "stock.count");
  const count = await loadCount(client, c, countId, { lock: true });
  requireStatus(count, "counting");
  if (!Array.isArray(lines) || !lines.length) throw new StockError(400, "Enter at least one counted quantity.", "STOCK_COUNT_LINES_REQUIRED");
  let updated = 0;
  for (const line of lines) {
    const counted = Number(line.countedQuantity);
    if (line.countedQuantity === "" || line.countedQuantity === null || line.countedQuantity === undefined) continue;
    if (!Number.isFinite(counted) || counted < 0) throw new StockError(400, "A counted quantity must be zero or greater.", "STOCK_QUANTITY_INVALID");
    const result = await client.query(
      `UPDATE tenant.stock_count_lines SET counted_quantity=$4,variance_reason=$5,counted_by=$6,counted_at=now(),updated_at=now() WHERE organization_id=$1 AND count_id=$2 AND id=$3`,
      [c.organizationId, count.id, uuid(line.lineId, "Line"), counted, text(line.reason, 500) || null, c.userId],
    );
    if (!result.rowCount) throw new StockError(404, "Count line was not found.", "STOCK_COUNT_LINE_NOT_FOUND");
    updated += 1;
  }
  return { updated };
}

export async function submitStockCount(client, c, countId) {
  need(c, "stock.count");
  const count = await loadCount(client, c, countId, { lock: true });
  requireStatus(count, "counting");
  const summary = (
    await client.query(
      `SELECT count(*)::int AS total,count(*) FILTER (WHERE counted_quantity IS NULL)::int AS uncounted,
              count(*) FILTER (WHERE counted_quantity IS NOT NULL AND counted_quantity<>system_quantity AND COALESCE(btrim(variance_reason),'')='')::int AS unexplained
         FROM tenant.stock_count_lines WHERE organization_id=$1 AND count_id=$2`,
      [c.organizationId, count.id],
    )
  ).rows[0];
  if (summary.total === 0) throw new StockError(409, "This count has no lines to submit.", "STOCK_COUNT_EMPTY");
  if (summary.uncounted) throw new StockError(409, `${summary.uncounted} line(s) have not been counted yet. Enter a quantity for every line (zero if none found).`, "STOCK_COUNT_INCOMPLETE");
  if (summary.unexplained) throw new StockError(409, `${summary.unexplained} line(s) differ from the system quantity and need a reason.`, "STOCK_COUNT_REASON_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.stock_counts SET status='review',submitted_by=$3,submitted_at=now(),rejection_reason=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, count.id, c.userId]);
  return rows[0];
}

export async function rejectStockCount(client, c, countId, reason) {
  need(c, "stock.adjust");
  const count = await loadCount(client, c, countId, { lock: true });
  requireStatus(count, "review");
  if (!text(reason)) throw new StockError(400, "A reason is required to send a count back.", "STOCK_REASON_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.stock_counts SET status='counting',rejection_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, count.id, text(reason)]);
  return rows[0];
}

export async function approveStockCount(client, c, countId) {
  need(c, "stock.adjust");
  const count = await loadCount(client, c, countId, { lock: true });
  requireStatus(count, "review");
  // Segregation of duties: whoever counted (created or submitted) cannot approve their own count.
  if ([count.created_by, count.submitted_by].includes(c.userId) && !has(c, "stock.count.self_approve")) {
    throw new StockError(403, "A count must be approved by someone other than the person who counted it.", "STOCK_COUNT_SELF_APPROVAL");
  }
  const lines = (await client.query(`SELECT * FROM tenant.stock_count_lines WHERE organization_id=$1 AND count_id=$2 ORDER BY created_at,id`, [c.organizationId, count.id])).rows;
  let posted = 0;
  for (const line of lines) {
    const delta = Number(line.counted_quantity) - Number(line.system_quantity);
    if (delta === 0) continue;
    const movement = await postStockMovement(client, c, {
      movementType: "adjustment",
      adjustmentDirection: delta > 0 ? "increase" : "decrease",
      itemId: line.item_id,
      warehouseId: count.warehouse_id,
      warehouseLocationId: line.warehouse_location_id,
      batchId: line.batch_id,
      quantity: Math.abs(delta),
      referenceType: "stock_count",
      referenceId: count.id,
      reason: `${count.count_number}: ${line.variance_reason || "count variance"}`,
      idempotencyKey: `count:${count.id}:${line.id}`,
    });
    await client.query(`UPDATE tenant.stock_count_lines SET movement_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, line.id, movement.id]);
    posted += 1;
  }
  const { rows } = await client.query(`UPDATE tenant.stock_counts SET status='posted',approved_by=$3,posted_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, count.id, c.userId]);
  return { ...rows[0], adjustmentsPosted: posted };
}

export async function cancelStockCount(client, c, countId, reason) {
  need(c, "stock.count");
  const count = await loadCount(client, c, countId, { lock: true });
  requireStatus(count, "counting", "review");
  if (!text(reason)) throw new StockError(400, "A reason is required to cancel a count.", "STOCK_REASON_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.stock_counts SET status='cancelled',cancel_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, count.id, text(reason)]);
  return rows[0];
}

export async function listStockCounts(client, c, { countType = null, status = null, limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (countType) { values.push(String(countType)); filter += ` AND count.count_type=$${values.length}`; }
  if (status) { values.push(String(status)); filter += ` AND count.status=$${values.length}`; }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT count.id,count.count_number,count.count_type,count.status,count.freeze_stock,count.blind,warehouse.name AS warehouse_name,count.created_at,count.posted_at,
            (SELECT count(*)::int FROM tenant.stock_count_lines l WHERE l.count_id=count.id) AS line_count,
            (SELECT count(*)::int FROM tenant.stock_count_lines l WHERE l.count_id=count.id AND l.counted_quantity IS NOT NULL AND l.counted_quantity<>l.system_quantity) AS variance_lines
       FROM tenant.stock_counts count JOIN tenant.warehouses warehouse ON warehouse.organization_id=count.organization_id AND warehouse.id=count.warehouse_id
      WHERE count.organization_id=$1 AND count.company_id=$2${filter} ORDER BY count.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

export async function getStockCount(client, c, countId) {
  need(c, "stock.view");
  const count = await loadCount(client, c, countId);
  const warehouse = (await client.query(`SELECT name FROM tenant.warehouses WHERE organization_id=$1 AND id=$2`, [c.organizationId, count.warehouse_id])).rows[0];
  const lines = (
    await client.query(
      `SELECT line.id,line.item_id,item.code AS item_code,item.name AS item_name,line.warehouse_location_id,location.code AS location_code,line.batch_id,batch.batch_number,
              line.system_quantity::text AS system_quantity,line.counted_quantity::text AS counted_quantity,line.variance_reason,line.movement_id,
              COALESCE(balance.average_cost,0)::text AS unit_cost
         FROM tenant.stock_count_lines line
         JOIN tenant.items item ON item.organization_id=line.organization_id AND item.id=line.item_id
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id=line.organization_id AND location.id=line.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id=line.organization_id AND batch.id=line.batch_id
         LEFT JOIN tenant.stock_balances balance ON balance.organization_id=line.organization_id AND balance.company_id=$3 AND balance.item_id=line.item_id AND balance.warehouse_id=$4
              AND balance.warehouse_location_id IS NOT DISTINCT FROM line.warehouse_location_id AND balance.batch_id IS NOT DISTINCT FROM line.batch_id
        WHERE line.organization_id=$1 AND line.count_id=$2 ORDER BY item.name,location.code NULLS FIRST,batch.batch_number NULLS FIRST`,
      [c.organizationId, count.id, c.companyId, count.warehouse_id],
    )
  ).rows;
  // Blind count: the counter must not see the expected quantity until the count is submitted.
  const hideSystem = count.blind && count.status === "counting";
  const showValue = has(c, "stock.valuation.view");
  return {
    ...count,
    warehouse_name: warehouse?.name ?? null,
    lines: lines.map((line) => ({ ...line, system_quantity: hideSystem ? null : line.system_quantity, unit_cost: showValue && !hideSystem ? line.unit_cost : null })),
  };
}
