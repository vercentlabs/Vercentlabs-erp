// A return's life: Draft → Received, or a draft Cancelled.
//
// Receive is the moment the goods are back. In one transaction, under the
// order's lock: each line is checked again against what can still come back
// (delivered less returns already received), then a stock return is posted for
// each stock-tracked line at the cost it left with, into the return
// warehouse: Restock to sellable stock, Inspection / Hold, Damaged and Other
// to a quality location of that warehouse, which is never available to sell.
// Receiving twice receives once (each stock return carries its own key). A
// received return is never cancelled: goods are corrected through inventory.
import { StockError, postStockMovement } from "../../stock/index.js";
import { dayOf, text } from "../orders/constants.js";
import { refreshSalesOrderProgress } from "../orders/progress.js";
import { lockOrder } from "../orders/versions.js";
import { loadReturn, recordReturnEvent, requireReturnPermission } from "./access.js";
import { RETURN_PERMISSIONS, RETURN_STATUS, ReturnError, dispositionOf, reasonLabel } from "./constants.js";
import { returnableLines } from "./records.js";

const EPSILON = 1e-6;
const stockContext = (context) => ({ organizationId: context.organizationId, userId: context.userId ?? null, permissions: ["stock.view", "stock.receive"], roleSlugs: [] });

// The warehouse's quality location for held returns, made the first time it is needed.
async function holdLocation(client, context, warehouseId, disposition) {
  const { code, name } = dispositionOf(disposition).location;
  const existing = (await client.query(`SELECT id, location_type, status FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND code = $3`,
    [context.organizationId, warehouseId, code])).rows[0];
  if (existing) {
    if (existing.location_type !== "quality" || existing.status !== "active")
      throw new ReturnError(409, `The location ${code} of the return warehouse must be an active quality location to hold returned goods.`, "SALES_RETURN_HOLD_LOCATION_INVALID");
    return existing.id;
  }
  return (await client.query(
    `INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, name, code, location_type, status, created_by, updated_by) VALUES ($1, $2, $3, $4, 'quality', 'active', $5, $5) RETURNING id`,
    [context.organizationId, warehouseId, name, code, context.userId ?? null])).rows[0].id;
}

// input: { expectedVersion? }. Returns { returnId, returnNumber, status, replayed }.
export async function receiveSalesReturn(client, context, returnId, input = {}) {
  requireReturnPermission(context, RETURN_PERMISSIONS.receive, "You do not have permission to receive returns.");
  const seen = await loadReturn(client, context, returnId);
  const order = await lockOrder(client, context, seen.sales_order_id);
  const salesReturn = await loadReturn(client, context, returnId, { lock: true });
  if (salesReturn.status === RETURN_STATUS.received) return { returnId: salesReturn.id, returnNumber: salesReturn.return_number, status: RETURN_STATUS.received, replayed: true };
  if (salesReturn.status === RETURN_STATUS.cancelled) throw new ReturnError(409, "A cancelled return cannot be received.", "SALES_RETURN_CANCELLED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(salesReturn.version))
    throw new ReturnError(409, "Someone else changed this return. Reload it and try again.", "SALES_RETURN_VERSION_CONFLICT");
  const lines = (await client.query(
    `SELECT line.*, COALESCE(item.track_inventory, false) AS stock_tracked FROM tenant.sales_return_lines line JOIN tenant.items item ON item.id = line.item_id
      WHERE line.organization_id = $1 AND line.sales_return_id = $2 ORDER BY line.sequence`, [context.organizationId, salesReturn.id])).rows;
  if (!lines.length) throw new ReturnError(409, "The return has no lines.", "SALES_RETURN_EMPTY");
  // Never more back than was delivered: returns received since this draft was made are counted now.
  const position = new Map((await returnableLines(client, context.organizationId, salesReturn.delivery_id, salesReturn.id)).map((line) => [line.id, line]));
  for (const line of lines) {
    const state = position.get(line.delivery_line_id);
    if (!state || Number(line.quantity) > state.returnable + EPSILON)
      throw new ReturnError(409, `${line.item_name_snapshot}: only ${state?.returnable ?? 0} ${line.uom_snapshot ?? ""} can come back now (delivered ${state?.delivered ?? 0}, already returned ${state?.returned ?? 0}). Change the quantity first.`.replace("  ", " "),
        "SALES_RETURN_EXCEEDS_DELIVERED");
  }
  const warehouse = (await client.query(`SELECT id, name, status FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [context.organizationId, salesReturn.warehouse_id])).rows[0];
  if (!warehouse || warehouse.status !== "active") throw new ReturnError(409, "The return warehouse is inactive. Choose another warehouse.", "SALES_WAREHOUSE_NOT_ELIGIBLE");
  const received = [];
  for (const line of lines) {
    const condition = dispositionOf(line.disposition);
    if (!line.stock_tracked) {
      received.push({ item: line.item_name_snapshot, quantity: Number(line.quantity), unit: line.uom_snapshot, condition: condition.label, stock: "not stock tracked" });
      continue;
    }
    const locationId = condition.sellable ? null : await holdLocation(client, context, warehouse.id, line.disposition);
    // Back at the cost it left with.
    const issue = (await client.query(
      `SELECT unit_cost FROM tenant.stock_movements WHERE organization_id = $1 AND reference_type = 'sales_delivery' AND reference_id = $2 AND item_id = $3 ORDER BY created_at LIMIT 1`,
      [context.organizationId, salesReturn.delivery_id, line.item_id])).rows[0];
    let movement;
    try {
      movement = await postStockMovement(client, stockContext(context), {
        movementType: "return", itemId: line.item_id, warehouseId: warehouse.id, warehouseLocationId: locationId, quantity: Number(line.base_quantity),
        unitCost: issue?.unit_cost ?? undefined, referenceType: "sales_return", referenceId: salesReturn.id,
        reason: `Sales return ${salesReturn.return_number} (${condition.label}): ${reasonLabel(line.reason_code ?? salesReturn.reason_code)}`,
        idempotencyKey: `sales-return:${salesReturn.id}:${line.id}`,
      });
    } catch (error) {
      if (!(error instanceof StockError)) throw error;
      throw new ReturnError(409, `${line.item_name_snapshot}: ${error.message}`, error.code ?? "SALES_RETURN_STOCK_FAILED");
    }
    await client.query(`UPDATE tenant.sales_return_lines SET warehouse_location_id = $3, stock_movement_id = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, line.id, locationId, movement.id]);
    received.push({ item: line.item_name_snapshot, quantity: Number(line.quantity), unit: line.uom_snapshot, condition: condition.label, movement: movement.movement_number,
      stock: condition.sellable ? "available to sell" : "held in quality" });
  }
  await client.query(
    `UPDATE tenant.sales_returns SET status = 'received', received_at = clock_timestamp(), received_by = $3, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, salesReturn.id, context.userId ?? null]);
  await recordReturnEvent(client, context, salesReturn.id, "sales_return.received", RETURN_STATUS.draft, RETURN_STATUS.received, { warehouse: warehouse.name, lines: received });
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'sales_order', $2, 'sales_order.return_received', $3, $3, $4::jsonb, $5, clock_timestamp())`,
    [context.organizationId, order.id, order.lifecycle_status, JSON.stringify({ returnId: salesReturn.id, returnNumber: salesReturn.return_number, lines: received }), context.userId ?? null]);
  await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { returnId: salesReturn.id, returnNumber: salesReturn.return_number, status: RETURN_STATUS.received, replayed: false, returnDate: dayOf(salesReturn.return_date) };
}

// Cancels a draft: nothing moved. input: { reason? }
export async function cancelDraftReturn(client, context, returnId, input = {}) {
  requireReturnPermission(context, RETURN_PERMISSIONS.edit, "You do not have permission to cancel returns.");
  const salesReturn = await loadReturn(client, context, returnId, { lock: true });
  if (salesReturn.status === RETURN_STATUS.cancelled) return { returnId: salesReturn.id, status: RETURN_STATUS.cancelled, changed: false };
  if (salesReturn.status === RETURN_STATUS.received)
    throw new ReturnError(409, "A received return is never cancelled: the goods are in stock. Correct it through inventory.", "SALES_RETURN_RECEIVED");
  const reason = text(input.reason, 1000);
  await client.query(
    `UPDATE tenant.sales_returns SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, salesReturn.id, context.userId ?? null, reason]);
  await recordReturnEvent(client, context, salesReturn.id, "sales_return.cancelled", RETURN_STATUS.draft, RETURN_STATUS.cancelled, { reason: reason ?? undefined });
  return { returnId: salesReturn.id, status: RETURN_STATUS.cancelled, changed: true };
}
