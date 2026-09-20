import { createHash, randomUUID } from "node:crypto";

import { StockError, postStockMovement } from "./index.js";

// Traceability, damaged stock, quarantine and returns (F138-F141).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new StockError(400, `${label} is invalid.`, "STOCK_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p)) throw new StockError(403, "You do not have permission to perform this stock operation.", "STOCK_FORBIDDEN");
};

// ---------------------------------------------------------------- traceability (F141)
// Where a batch or serial came from and where it went: the receipts that created it, every movement
// that touched it, what is left and where, and any quality hold on it. Movements carry the source
// document type and id (goods receipt, sale, transfer, count...), so a recall can be scoped from here.
export async function getStockTraceability(client, c, { code } = {}) {
  need(c, "stock.view");
  const wanted = text(code, 200);
  if (!wanted) throw new StockError(400, "Enter a batch or serial number.", "STOCK_CODE_REQUIRED");
  const itemColumns = "item.id AS item_id,item.code AS item_code,item.name AS item_name";
  const batch = (
    await client.query(
      `SELECT batch.id,batch.batch_number,batch.status,batch.manufactured_on,batch.expires_on,${itemColumns} FROM tenant.stock_batches batch JOIN tenant.items item ON item.organization_id=batch.organization_id AND item.id=batch.item_id
        WHERE batch.organization_id=$1 AND batch.company_id=$2 AND lower(batch.batch_number)=lower($3) ORDER BY batch.created_at LIMIT 1`,
      [c.organizationId, c.companyId, wanted],
    )
  ).rows[0];
  const serial = batch ? null : (
    await client.query(
      `SELECT serial.id,serial.serial_number,serial.status,serial.warehouse_id,serial.batch_id,${itemColumns} FROM tenant.stock_serials serial JOIN tenant.items item ON item.organization_id=serial.organization_id AND item.id=serial.item_id
        WHERE serial.organization_id=$1 AND serial.company_id=$2 AND lower(serial.serial_number)=lower($3) LIMIT 1`,
      [c.organizationId, c.companyId, wanted],
    )
  ).rows[0];
  if (!batch && !serial) throw new StockError(404, `No batch or serial number matches "${wanted}".`, "STOCK_CODE_NOT_FOUND");
  const key = batch ? "batch_id" : "serial_id";
  const subjectId = (batch || serial).id;
  const movements = (
    await client.query(
      `SELECT movement.id,movement.movement_number,movement.movement_type,movement.quantity::text AS quantity,movement.reference_type,movement.reference_id,movement.reason,movement.occurred_at,
              warehouse.name AS warehouse_name,location.code AS location_code
         FROM tenant.stock_movements movement JOIN tenant.warehouses warehouse ON warehouse.organization_id=movement.organization_id AND warehouse.id=movement.warehouse_id
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id=movement.organization_id AND location.id=movement.warehouse_location_id
        WHERE movement.organization_id=$1 AND movement.company_id=$2 AND movement.${key}=$3 ORDER BY movement.occurred_at,movement.movement_number`,
      [c.organizationId, c.companyId, subjectId],
    )
  ).rows;
  const balances = batch
    ? (
        await client.query(
          `SELECT warehouse.name AS warehouse_name,location.code AS location_code,balance.quantity::text AS quantity,balance.reserved_quantity::text AS reserved_quantity
             FROM tenant.stock_balances balance JOIN tenant.warehouses warehouse ON warehouse.organization_id=balance.organization_id AND warehouse.id=balance.warehouse_id
             LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
            WHERE balance.organization_id=$1 AND balance.company_id=$2 AND balance.batch_id=$3 AND balance.quantity<>0`,
          [c.organizationId, c.companyId, subjectId],
        )
      ).rows
    : [];
  const holds = (
    await client.query(
      `SELECT hold_number,hold_type,status,reason,quantity::text AS quantity,released_quantity::text AS released_quantity FROM tenant.quality_holds
        WHERE organization_id=$1 AND company_id=$2 AND ${batch ? "batch_id" : "serial_id"}=$3 ORDER BY placed_at`,
      [c.organizationId, c.companyId, subjectId],
    )
  ).rows;
  const received = movements.filter((m) => Number(m.quantity) > 0).reduce((t, m) => t + Number(m.quantity), 0);
  const issued = movements.filter((m) => Number(m.quantity) < 0).reduce((t, m) => t - Number(m.quantity), 0);
  return { kind: batch ? "batch" : "serial", subject: batch || serial, movements, balances, holds, summary: { receivedQuantity: String(received), issuedQuantity: String(issued), movements: movements.length } };
}

// ---------------------------------------------------------------- quarantine (F140)
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
        WHERE hold.organization_id=$1 AND hold.company_id=$2 AND hold.status='active' ORDER BY hold.placed_at DESC LIMIT 250`,
      [c.organizationId, c.companyId],
    )
  ).rows;
  const located = (
    await client.query(
      `SELECT balance.id,item.code AS item_code,item.name AS item_name,warehouse.name AS warehouse_name,location.code AS location_code,batch.batch_number,balance.quantity::text AS quantity
         FROM tenant.stock_balances balance JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id AND location.location_type='quality'
         JOIN tenant.items item ON item.organization_id=balance.organization_id AND item.id=balance.item_id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id=balance.organization_id AND warehouse.id=balance.warehouse_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
        WHERE balance.organization_id=$1 AND balance.company_id=$2 AND balance.quantity>0 ORDER BY item.name LIMIT 250`,
      [c.organizationId, c.companyId],
    )
  ).rows;
  return { holds, located };
}

// ---------------------------------------------------------------- damaged stock (F139)
export const DAMAGE_CATEGORIES = ["damaged", "expired", "spoiled", "lost", "theft", "other"];

export async function recordDamagedStock(client, c, input = {}) {
  need(c, "stock.adjust");
  const category = String(input.category || "");
  if (!DAMAGE_CATEGORIES.includes(category)) throw new StockError(400, `Category must be one of: ${DAMAGE_CATEGORIES.join(", ")}.`, "STOCK_DAMAGE_CATEGORY_INVALID");
  const note = text(input.note);
  if (!note) throw new StockError(400, "Describe what happened; a write-off needs a reason.", "STOCK_REASON_REQUIRED");
  const key = text(input.idempotencyKey, 200);
  return postStockMovement(client, c, {
    movementType: "adjustment",
    adjustmentDirection: "decrease",
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    warehouseLocationId: input.warehouseLocationId || null,
    batchId: input.batchId || null,
    quantity: input.quantity,
    referenceType: "stock_damage",
    referenceId: key ? deterministicUuid(`damage:${key}`) : randomUUID(),
    reason: `Write-off (${category}): ${note}`,
    idempotencyKey: key ? `damage:${key}` : undefined,
  });
}

// ---------------------------------------------------------------- returns (F138)
export async function recordStockReturn(client, c, input = {}) {
  need(c, "stock.receive");
  const condition = String(input.condition || "good");
  if (!["good", "damaged"].includes(condition)) throw new StockError(400, "Condition must be good or damaged.", "STOCK_RETURN_CONDITION_INVALID");
  if (!text(input.reason)) throw new StockError(400, "A return needs a reason.", "STOCK_REASON_REQUIRED");
  // Damaged goods must not re-enter sellable stock: they go to a quarantine (quality-type) location.
  if (condition === "damaged") {
    const locationId = input.warehouseLocationId ? uuid(input.warehouseLocationId, "Location") : null;
    const location = locationId ? (await client.query(`SELECT location_type FROM tenant.warehouse_locations WHERE organization_id=$1 AND id=$2`, [c.organizationId, locationId])).rows[0] : null;
    if (!location || location.location_type !== "quality") {
      throw new StockError(409, "A damaged return must be received into a quarantine (quality) location so it does not become sellable stock.", "STOCK_RETURN_QUARANTINE_REQUIRED");
    }
  }
  const key = text(input.idempotencyKey, 200);
  return postStockMovement(client, c, {
    movementType: "receipt",
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    warehouseLocationId: input.warehouseLocationId || null,
    batchId: input.batchId || null,
    quantity: input.quantity,
    unitCost: input.unitCost,
    referenceType: "customer_return",
    referenceId: key ? deterministicUuid(`return:${key}`) : randomUUID(),
    reason: `Return (${condition}): ${text(input.reason)}`,
    idempotencyKey: key ? `return:${key}` : undefined,
  });
}

function deterministicUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
