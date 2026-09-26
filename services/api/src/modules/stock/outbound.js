import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { StockError, postStockMovement, releaseStockReservation, reserveStock } from "./index.js";

// Picking, packing and shipping (F135-F137).
//
//   open -> picking -> picked -> packing -> packed -> shipped        (cancel any time before shipping)
//
// Creating a pick list RESERVES the stock it asks for. Picking records what was actually found
// (short picks need a reason). Packing puts picked quantity into packages. Shipping consumes the
// reservation and issues the stock -- one ledger movement per line, idempotent -- so stock leaves
// exactly once, at the moment it physically ships.
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
// Outbound holds the stock via reservations and issues it on shipment; the caller needs stock.issue
// (checked above) and the narrow rights below apply only inside these functions.
const asOutbound = (c) => ({ ...c, permissions: [...new Set([...(c.permissions || []), "stock.reserve", "stock.issue"])] });
const qty = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new StockError(400, `${label} must be greater than zero.`, "STOCK_QUANTITY_INVALID");
  return n;
};

async function loadList(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.stock_pick_lists WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Pick list")]);
  if (!rows[0]) throw new StockError(404, "Pick list was not found.", "STOCK_PICK_NOT_FOUND");
  return rows[0];
}
const requireStatus = (list, ...allowed) => {
  if (!allowed.includes(list.status)) throw new StockError(409, `This pick list is ${list.status}; that action needs it to be ${allowed.join(" or ")}.`, "STOCK_PICK_STATE_INVALID");
};
const loadLines = async (client, c, listId) => (await client.query(`SELECT * FROM tenant.stock_pick_lines WHERE organization_id=$1 AND pick_list_id=$2 ORDER BY created_at,id`, [c.organizationId, listId])).rows;

export async function createPickList(client, c, input = {}) {
  need(c, "stock.issue");
  const warehouseId = uuid(input.warehouseId, "Warehouse");
  const warehouse = (await client.query(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND status='active'`, [c.organizationId, warehouseId, c.companyId])).rows[0];
  if (!warehouse) throw new StockError(404, "Warehouse was not found for the active company.", "STOCK_WAREHOUSE_NOT_FOUND");
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new StockError(400, "A pick list needs at least one line.", "STOCK_PICK_LINES_REQUIRED");
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const replay = (await client.query(`SELECT * FROM tenant.stock_pick_lists WHERE organization_id=$1 AND company_id=$2 AND idempotency_key=$3`, [c.organizationId, c.companyId, key])).rows[0];
    if (replay) return { ...replay, replayed: true };
  }
  const number = await nextDocumentNumber(client, c, { documentType: "stock_pick_list", prefix: "PCK" });
  const list = (
    await client.query(
      `INSERT INTO tenant.stock_pick_lists(organization_id,company_id,pick_number,warehouse_id,reference_type,reference_id,reference_label,notes,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [c.organizationId, c.companyId, number, warehouseId, input.referenceId ? text(input.referenceType || "manual", 80) : null, input.referenceId ? uuid(input.referenceId, "Reference") : null, text(input.referenceLabel, 200) || null, text(input.notes, 2000) || null, c.userId, key],
    )
  ).rows[0];
  for (const [index, line] of lines.entries()) {
    const item = (await client.query(`SELECT id,tracking_type,track_inventory FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active' AND (company_id IS NULL OR company_id=$3)`, [c.organizationId, uuid(line.itemId, "Item"), c.companyId])).rows[0];
    if (!item || !item.track_inventory) throw new StockError(404, "Stock item was not found for the active company.", "STOCK_ITEM_NOT_FOUND");
    if (item.tracking_type === "serial") throw new StockError(409, "Serial-tracked items are shipped by issuing their serial numbers; they cannot go on a pick list.", "STOCK_PICK_SERIAL_UNSUPPORTED");
    if (item.tracking_type === "batch" && !line.batchId) throw new StockError(400, "Choose the batch to pick for a batch-tracked item.", "STOCK_BATCH_REQUIRED");
    const quantity = qty(line.quantity, "Quantity");
    const inserted = (
      await client.query(
        `INSERT INTO tenant.stock_pick_lines(organization_id,pick_list_id,item_id,warehouse_location_id,batch_id,requested_quantity) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [c.organizationId, list.id, item.id, line.warehouseLocationId ? uuid(line.warehouseLocationId, "Location") : null, line.batchId ? uuid(line.batchId, "Batch") : null, quantity],
      )
    ).rows[0];
    const reservation = await reserveStock(client, asOutbound(c), { itemId: item.id, warehouseId, warehouseLocationId: inserted.warehouse_location_id, batchId: inserted.batch_id, quantity, referenceType: "stock_pick_list", referenceId: list.id, idempotencyKey: `pick:${list.id}:${index}` });
    // The hold lands on a concrete location/batch when none was asked for; the line adopts it so
    // shipment issues from exactly where the stock was reserved.
    await client.query(`UPDATE tenant.stock_pick_lines SET reservation_id=$2,warehouse_location_id=$3,batch_id=$4 WHERE id=$1`, [inserted.id, reservation.id, reservation.warehouse_location_id ?? null, reservation.batch_id ?? null]);
  }
  return { ...list, replayed: false };
}

export async function recordPicks(client, c, listId, picks = []) {
  need(c, "stock.issue");
  const list = await loadList(client, c, listId, { lock: true });
  requireStatus(list, "open", "picking");
  if (!Array.isArray(picks) || !picks.length) throw new StockError(400, "Enter at least one picked quantity.", "STOCK_PICK_LINES_REQUIRED");
  for (const pick of picks) {
    const line = (await client.query(`SELECT * FROM tenant.stock_pick_lines WHERE organization_id=$1 AND pick_list_id=$2 AND id=$3`, [c.organizationId, list.id, uuid(pick.lineId, "Line")])).rows[0];
    if (!line) throw new StockError(404, "Pick line was not found.", "STOCK_PICK_LINE_NOT_FOUND");
    const picked = Number(pick.pickedQuantity);
    if (!Number.isFinite(picked) || picked < 0) throw new StockError(400, "A picked quantity must be zero or greater.", "STOCK_QUANTITY_INVALID");
    if (picked > Number(line.requested_quantity)) throw new StockError(409, "You cannot pick more than was requested.", "STOCK_PICK_OVER");
    if (picked < Number(line.requested_quantity) && !text(pick.shortReason)) throw new StockError(400, "A short pick needs a reason.", "STOCK_REASON_REQUIRED");
    await client.query(`UPDATE tenant.stock_pick_lines SET picked_quantity=$3,short_reason=$4 WHERE organization_id=$1 AND id=$2`, [c.organizationId, line.id, picked, picked < Number(line.requested_quantity) ? text(pick.shortReason) : null]);
  }
  await client.query(`UPDATE tenant.stock_pick_lists SET status='picking',updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, list.id]);
  return { updated: picks.length };
}

export async function completePicking(client, c, listId) {
  need(c, "stock.issue");
  const list = await loadList(client, c, listId, { lock: true });
  requireStatus(list, "open", "picking");
  const lines = await loadLines(client, c, list.id);
  const unpicked = lines.filter((l) => Number(l.picked_quantity) < Number(l.requested_quantity) && !text(l.short_reason));
  if (unpicked.length) throw new StockError(409, `${unpicked.length} line(s) have not been picked. Record a quantity, or a short-pick reason, for each.`, "STOCK_PICK_INCOMPLETE");
  const asC = asOutbound(c);
  // A short pick frees what was not found: re-reserve only what was really picked.
  for (const line of lines) {
    if (Number(line.picked_quantity) >= Number(line.requested_quantity)) continue;
    await releaseStockReservation(client, asC, line.reservation_id, { status: "released" });
    let reservationId = null;
    if (Number(line.picked_quantity) > 0) {
      const again = await reserveStock(client, asC, { itemId: line.item_id, warehouseId: list.warehouse_id, warehouseLocationId: line.warehouse_location_id, batchId: line.batch_id, quantity: Number(line.picked_quantity), referenceType: "stock_pick_list", referenceId: list.id, idempotencyKey: `pick:${list.id}:short:${line.id}` });
      reservationId = again.id;
    }
    await client.query(`UPDATE tenant.stock_pick_lines SET reservation_id=$2 WHERE id=$1`, [line.id, reservationId]);
  }
  const { rows } = await client.query(`UPDATE tenant.stock_pick_lists SET status='picked',picked_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, list.id]);
  return rows[0];
}

export async function createPackage(client, c, listId, input = {}) {
  need(c, "stock.issue");
  const list = await loadList(client, c, listId, { lock: true });
  requireStatus(list, "picked", "packing");
  const items = Array.isArray(input.lines) ? input.lines : [];
  if (!items.length) throw new StockError(400, "Put at least one line into the package.", "STOCK_PACKAGE_LINES_REQUIRED");
  const weight = input.weightKg === undefined || input.weightKg === null || input.weightKg === "" ? null : Number(input.weightKg);
  if (weight !== null && (!Number.isFinite(weight) || weight < 0)) throw new StockError(400, "Weight must be zero or greater.", "STOCK_WEIGHT_INVALID");
  const count = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.stock_packages WHERE organization_id=$1 AND pick_list_id=$2`, [c.organizationId, list.id])).rows[0].n);
  const pkg = (await client.query(`INSERT INTO tenant.stock_packages(organization_id,pick_list_id,package_number,weight_kg,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, list.id, `PKG-${count + 1}`, weight, text(input.notes, 1000) || null, c.userId])).rows[0];
  for (const item of items) {
    const line = (await client.query(`SELECT * FROM tenant.stock_pick_lines WHERE organization_id=$1 AND pick_list_id=$2 AND id=$3`, [c.organizationId, list.id, uuid(item.lineId, "Line")])).rows[0];
    if (!line) throw new StockError(404, "Pick line was not found.", "STOCK_PICK_LINE_NOT_FOUND");
    const quantity = qty(item.quantity, "Package quantity");
    const packed = Number((await client.query(`SELECT COALESCE(sum(quantity),0) AS q FROM tenant.stock_package_lines WHERE organization_id=$1 AND pick_line_id=$2`, [c.organizationId, line.id])).rows[0].q);
    if (packed + quantity > Number(line.picked_quantity)) throw new StockError(409, "You cannot pack more than was picked.", "STOCK_PACK_OVER");
    await client.query(`INSERT INTO tenant.stock_package_lines(organization_id,package_id,pick_line_id,quantity) VALUES($1,$2,$3,$4)`, [c.organizationId, pkg.id, line.id, quantity]);
  }
  await client.query(`UPDATE tenant.stock_pick_lists SET status='packing',updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, list.id]);
  return pkg;
}

export async function completePacking(client, c, listId) {
  need(c, "stock.issue");
  const list = await loadList(client, c, listId, { lock: true });
  requireStatus(list, "picked", "packing");
  const rows = (
    await client.query(
      `SELECT line.id,line.picked_quantity,COALESCE((SELECT sum(p.quantity) FROM tenant.stock_package_lines p WHERE p.pick_line_id=line.id),0) AS packed
         FROM tenant.stock_pick_lines line WHERE line.organization_id=$1 AND line.pick_list_id=$2 AND line.picked_quantity>0`,
      [c.organizationId, list.id],
    )
  ).rows;
  if (!rows.length) throw new StockError(409, "Nothing was picked, so there is nothing to pack. Cancel the pick list instead.", "STOCK_PACK_NOTHING");
  const open = rows.filter((r) => Number(r.packed) < Number(r.picked_quantity));
  if (open.length) throw new StockError(409, `${open.length} picked line(s) are not fully packed yet.`, "STOCK_PACK_INCOMPLETE");
  const { rows: updated } = await client.query(`UPDATE tenant.stock_pick_lists SET status='packed',packed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, list.id]);
  return updated[0];
}

export async function shipPickList(client, c, listId, input = {}) {
  need(c, "stock.issue");
  const list = await loadList(client, c, listId, { lock: true });
  if (list.status === "shipped") return { ...list, replayed: true };
  requireStatus(list, "packed");
  const carrier = text(input.carrier, 120);
  if (!carrier) throw new StockError(400, "Enter the carrier.", "STOCK_CARRIER_REQUIRED");
  const asC = asOutbound(c);
  for (const line of await loadLines(client, c, list.id)) {
    if (!(Number(line.picked_quantity) > 0)) continue;
    // release the hold first (it would otherwise block its own issue), then take the stock out
    await releaseStockReservation(client, asC, line.reservation_id, { status: "consumed" });
    await postStockMovement(client, asC, {
      movementType: "issue",
      itemId: line.item_id,
      warehouseId: list.warehouse_id,
      warehouseLocationId: line.warehouse_location_id,
      batchId: line.batch_id,
      quantity: line.picked_quantity,
      referenceType: "stock_shipment",
      referenceId: list.id,
      reason: `Shipment ${list.pick_number}`,
      idempotencyKey: `ship:${list.id}:${line.id}`,
    });
  }
  const { rows } = await client.query(`UPDATE tenant.stock_pick_lists SET status='shipped',shipped_by=$3,shipped_at=now(),carrier=$4,tracking_number=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, list.id, c.userId, carrier, text(input.trackingNumber, 120) || null]);
  return { ...rows[0], replayed: false };
}

export async function cancelPickList(client, c, listId, reason) {
  need(c, "stock.issue");
  const list = await loadList(client, c, listId, { lock: true });
  requireStatus(list, "open", "picking", "picked", "packing", "packed");
  if (!text(reason)) throw new StockError(400, "A reason is required to cancel a pick list.", "STOCK_REASON_REQUIRED");
  const asC = asOutbound(c);
  for (const line of await loadLines(client, c, list.id)) if (line.reservation_id) await releaseStockReservation(client, asC, line.reservation_id, { status: "cancelled" });
  const { rows } = await client.query(`UPDATE tenant.stock_pick_lists SET status='cancelled',cancel_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, list.id, text(reason)]);
  return rows[0];
}

export async function listPickLists(client, c, { status = null, limit = 250 } = {}) {
  need(c, "stock.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (status) { values.push(String(status)); filter = ` AND list.status=$${values.length}`; }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT list.id,list.pick_number,list.status,list.reference_label,list.carrier,list.tracking_number,list.created_at,list.shipped_at,warehouse.name AS warehouse_name,
            (SELECT count(*)::int FROM tenant.stock_pick_lines l WHERE l.pick_list_id=list.id) AS line_count,
            (SELECT COALESCE(sum(l.requested_quantity),0)::text FROM tenant.stock_pick_lines l WHERE l.pick_list_id=list.id) AS requested_quantity,
            (SELECT COALESCE(sum(l.picked_quantity),0)::text FROM tenant.stock_pick_lines l WHERE l.pick_list_id=list.id) AS picked_quantity
       FROM tenant.stock_pick_lists list JOIN tenant.warehouses warehouse ON warehouse.organization_id=list.organization_id AND warehouse.id=list.warehouse_id
      WHERE list.organization_id=$1 AND list.company_id=$2${filter} ORDER BY list.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

export async function getPickList(client, c, listId) {
  need(c, "stock.view");
  const list = await loadList(client, c, listId);
  const warehouse = (await client.query(`SELECT name FROM tenant.warehouses WHERE organization_id=$1 AND id=$2`, [c.organizationId, list.warehouse_id])).rows[0];
  const lines = (
    await client.query(
      `SELECT line.id,line.item_id,item.code AS item_code,item.name AS item_name,location.code AS location_code,batch.batch_number,line.requested_quantity::text AS requested_quantity,line.picked_quantity::text AS picked_quantity,line.short_reason,
              COALESCE((SELECT sum(p.quantity) FROM tenant.stock_package_lines p WHERE p.pick_line_id=line.id),0)::text AS packed_quantity
         FROM tenant.stock_pick_lines line JOIN tenant.items item ON item.organization_id=line.organization_id AND item.id=line.item_id
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id=line.organization_id AND location.id=line.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id=line.organization_id AND batch.id=line.batch_id
        WHERE line.organization_id=$1 AND line.pick_list_id=$2 ORDER BY line.created_at,line.id`,
      [c.organizationId, list.id],
    )
  ).rows;
  const packages = (
    await client.query(
      `SELECT pkg.id,pkg.package_number,pkg.weight_kg::text AS weight_kg,pkg.notes,
              (SELECT json_agg(json_build_object('itemCode',item.code,'quantity',pl.quantity::text) ORDER BY item.code) FROM tenant.stock_package_lines pl JOIN tenant.stock_pick_lines l ON l.id=pl.pick_line_id JOIN tenant.items item ON item.organization_id=l.organization_id AND item.id=l.item_id WHERE pl.package_id=pkg.id) AS contents
         FROM tenant.stock_packages pkg WHERE pkg.organization_id=$1 AND pkg.pick_list_id=$2 ORDER BY pkg.package_number`,
      [c.organizationId, list.id],
    )
  ).rows;
  return { ...list, warehouse_name: warehouse?.name ?? null, lines, packages };
}
