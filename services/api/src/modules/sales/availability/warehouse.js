// Changing where a confirmed order line ships from: Mumbai → Nagpur, chosen
// by an authorized user after seeing where the stock is. An availability
// check never changes it by itself. One fulfillment warehouse per line; stock
// already reserved for the line in the old warehouse is released, and the
// line is reserved in the new warehouse in the same step (unless asked not to). A draft changes its
// warehouses by editing the order. The order line itself is never rewritten:
// the warehouse it ships from now is kept on the line's progress.
import { restrictedStockSql } from "../../stock/rules.js";
import { assertOrderVisible, requireOrderPermission } from "../orders/access.js";
import { OrderError, STATUS, requireUuid, text } from "../orders/constants.js";
import { refreshSalesOrderProgress } from "../orders/progress.js";
import { releaseOrderReservations, reserveOrderLines } from "../reservations/service.js";
import { lockOrder, recordOrderEvent } from "../orders/versions.js";
import { AVAILABILITY_PERMISSIONS } from "./constants.js";

// input: { lineId, warehouseId, reason?, reserve? (default true) }
export async function changeSalesOrderLineWarehouse(client, context, orderId, input = {}) {
  requireOrderPermission(context, AVAILABILITY_PERMISSIONS.changeWarehouse, "You do not have permission to change the fulfillment warehouse.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status !== STATUS.confirmed)
    throw new OrderError(409, order.lifecycle_status === STATUS.draft ? "Edit the draft to change its warehouses." : "Only a confirmed order's warehouse can be changed.", "SALES_ORDER_NOT_CONFIRMED");
  const lineId = requireUuid(input.lineId, "Order line");
  const warehouseId = requireUuid(input.warehouseId, "Warehouse");
  const line = (await client.query(
    `SELECT line.id, line.item_name_snapshot, COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id) AS warehouse_id, old.name AS old_name, item.item_type,
            COALESCE(item.track_inventory, false) AS track_inventory
       FROM tenant.sales_order_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
       LEFT JOIN tenant.warehouses old ON old.organization_id = line.organization_id AND old.id = COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id)
      WHERE line.organization_id = $1 AND line.id = $2 AND line.sales_order_version_id = $3`, [context.organizationId, lineId, order.current_version_id])).rows[0];
  if (!line) throw new OrderError(404, "That line is not on this order.", "SALES_ORDER_LINE_NOT_FOUND");
  if (line.item_type === "service") throw new OrderError(409, `${line.item_name_snapshot} is a service and ships from no warehouse.`, "SALES_ORDER_LINE_NOT_DELIVERABLE");
  // The warehouse must be this organization's, active and shipping.
  const warehouse = (await client.query(`SELECT id, name, status, shipping_enabled AND sales_fulfillment AS shipping_enabled FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, warehouseId])).rows[0];
  if (!warehouse) throw new OrderError(404, "Warehouse not found.", "SALES_WAREHOUSE_NOT_FOUND");
  if (warehouse.status !== "active" || !warehouse.shipping_enabled)
    throw new OrderError(409, `${warehouse.name} is inactive or does not ship.`, "SALES_WAREHOUSE_NOT_ELIGIBLE");
  if (line.warehouse_id === warehouse.id) return { orderId: order.id, lineId, warehouseId, changed: false, reservationsReleased: 0 };
  let heldBase = 0;
  if (line.track_inventory && input.reserve !== false) {
    const held = Number((await client.query(`SELECT COALESCE(sum(active_quantity), 0) AS quantity FROM tenant.stock_reservations WHERE organization_id = $1 AND sales_order_line_id = $2 AND status = 'active'`,
      [context.organizationId, lineId])).rows[0].quantity);
    heldBase = held;
    if (held > 0) {
      const free = Number((await client.query(
        `SELECT COALESCE(greatest(sum(CASE WHEN ${restrictedStockSql("location", "batch")} THEN 0 ELSE greatest(balance.quantity - balance.reserved_quantity, 0) END), 0), 0) AS free
           FROM tenant.stock_balances balance
           LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
           LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
          WHERE balance.organization_id = $1 AND balance.warehouse_id = $2 AND balance.item_id = (SELECT item_id FROM tenant.sales_order_lines WHERE organization_id = $1 AND id = $3)`,
        [context.organizationId, warehouse.id, lineId])).rows[0].free);
      if (free + 1e-9 < held)
        throw new OrderError(409, `${warehouse.name} has only ${free} available; ${held} are reserved in ${line.old_name ?? "the current warehouse"} and stay there. Nothing was changed.`,
          "SALES_WAREHOUSE_INSUFFICIENT", { reserved: held, available: free });
    }
  }
  const releasedLines = await releaseOrderReservations(client, context, order, { lineId, how: "released", reasonCode: "warehouse_changed", reason: `Moved to ${warehouse.name}` });
  const released = releasedLines.reduce((total, line) => total + line.count, 0);
  await client.query(`UPDATE tenant.sales_order_line_progress SET fulfillment_warehouse_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND sales_order_line_id = $2`,
    [context.organizationId, lineId, warehouse.id, context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, "sales_order.warehouse_changed", order.lifecycle_status, order.lifecycle_status, {
    item: line.item_name_snapshot, from: line.old_name ?? null, to: warehouse.name, reservationsReleased: released, reason: text(input.reason, 500) ?? undefined,
  });
  // Release in the old warehouse, reserve in the new one: one step, one transaction. The old guarantee is given up only if the new warehouse
  // takes all of it: otherwise the whole change rolls back and the reservation stays where it was.
  let reservation = null;
  if (input.reserve !== false && line.track_inventory) {
    [reservation] = await reserveOrderLines(client, context, order, { lineIds: [lineId] });
    const factor = Number((await client.query(`SELECT COALESCE(NULLIF(conversion_factor, 0), 1) AS factor FROM tenant.sales_order_lines WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, lineId])).rows[0].factor);
    if (heldBase > 0 && (reservation?.reserved ?? 0) * factor + 1e-9 < heldBase)
      throw new OrderError(409, `${warehouse.name} could not take the ${Math.round((heldBase / factor) * 1e6) / 1e6} reserved: nothing was changed and the reservation stays in ${line.old_name ?? "the current warehouse"}.`,
        "SALES_WAREHOUSE_INSUFFICIENT", { reserved: heldBase / factor, available: reservation?.reserved ?? 0 });
    if (reservation?.reserved > 0)
      await recordOrderEvent(client, context, order.id, "sales_order.stock_reserved", order.lifecycle_status, order.lifecycle_status, {
        lines: [{ item: reservation.itemName, quantity: reservation.reserved, unit: reservation.unit, warehouse: reservation.warehouseName, reservations: reservation.reservations }], short: [],
      });
  }
  await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { orderId: order.id, lineId, warehouseId: warehouse.id, changed: true, reservationsReleased: released, reserved: reservation?.reserved ?? 0, shortage: reservation?.shortage ?? 0 };
}
