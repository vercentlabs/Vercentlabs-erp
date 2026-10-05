// Changing where a confirmed order line ships from: Mumbai → Nagpur, chosen
// by an authorized user after seeing where the stock is. An availability
// check never changes it by itself. One fulfillment warehouse per line; stock
// already reserved for the line in the old warehouse is released, and the
// line is reserved in the new warehouse in the same step (unless asked not to). A draft changes its
// warehouses by editing the order. The order line itself is never rewritten:
// the warehouse it ships from now is kept on the line's progress.
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
  // The warehouse must be this organization's, active and used for sales fulfillment.
  const warehouse = (await client.query(`SELECT id, name, status, sales_fulfillment FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, warehouseId])).rows[0];
  if (!warehouse) throw new OrderError(404, "Warehouse not found.", "SALES_WAREHOUSE_NOT_FOUND");
  if (warehouse.status !== "active" || !warehouse.sales_fulfillment)
    throw new OrderError(409, `${warehouse.name} is inactive or not used for sales fulfillment.`, "SALES_WAREHOUSE_NOT_ELIGIBLE");
  if (line.warehouse_id === warehouse.id) return { orderId: order.id, lineId, warehouseId, changed: false, reservationsReleased: 0 };
  const releasedLines = await releaseOrderReservations(client, context, order, { lineId, how: "released", reasonCode: "warehouse_changed", reason: `Moved to ${warehouse.name}` });
  const released = releasedLines.reduce((total, line) => total + line.count, 0);
  await client.query(`UPDATE tenant.sales_order_line_progress SET fulfillment_warehouse_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND sales_order_line_id = $2`,
    [context.organizationId, lineId, warehouse.id, context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, "sales_order.warehouse_changed", order.lifecycle_status, order.lifecycle_status, {
    item: line.item_name_snapshot, from: line.old_name ?? null, to: warehouse.name, reservationsReleased: released, reason: text(input.reason, 500) ?? undefined,
  });
  // Release in the old warehouse, reserve in the new one: one step, one transaction.
  let reservation = null;
  if (input.reserve !== false && line.track_inventory) {
    [reservation] = await reserveOrderLines(client, context, order, { lineIds: [lineId] });
    if (reservation?.reserved > 0)
      await recordOrderEvent(client, context, order.id, "sales_order.stock_reserved", order.lifecycle_status, order.lifecycle_status, {
        lines: [{ item: reservation.itemName, quantity: reservation.reserved, unit: reservation.unit, warehouse: reservation.warehouseName, reservations: reservation.reservations }], short: [],
      });
  }
  await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { orderId: order.id, lineId, warehouseId: warehouse.id, changed: true, reservationsReleased: released, reserved: reservation?.reserved ?? 0, shortage: reservation?.shortage ?? 0 };
}
