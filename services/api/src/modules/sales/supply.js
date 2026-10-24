// Make-to-order (Sales report Phase 3): an order line can be marked "Buy for this order", "Make for this order" or (Procurement report
// Phase 3) "Ship from supplier", a purchase order addressed to the customer. Confirming the order raises them through the bridges — a purchase indent or draft purchase orders (Procurement), a draft manufacturing order (Manufacturing)
// — and keeps what was raised, or why it could not be, against the order. It never blocks the confirmation, and a line already raised
// for (the same item and route on the order) is not raised again when the order is confirmed after a change.
import { buyForSalesOrder, dropshipForSalesOrder } from "./bridges/procurement.js";
import { makeForSalesOrder } from "./bridges/manufacturing.js";

export const SUPPLY_ROUTES = Object.freeze(["stock", "buy", "make", "dropship"]);
export const supplyRouteOf = (value) => (value === "buy" || value === "make" || value === "dropship" ? value : "stock");

async function guarded(client, work) {
  await client.query("SAVEPOINT sales_order_supply");
  try {
    const result = await work();
    await client.query("RELEASE SAVEPOINT sales_order_supply");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT sales_order_supply");
    return { error: String(error?.message ?? error) };
  }
}

// order: the locked order row (current_version_id, sales_order_number, version_number). Returns the rows written.
export async function raiseSupplyForOrder(client, context, order) {
  const lines = (await client.query(
    `SELECT line.id, line.sequence, line.item_id, line.supply_route, line.quantity, line.uom_id, line.warehouse_id, COALESCE(line.promised_delivery_date, line.requested_delivery_date) AS required_by
       FROM tenant.sales_order_lines line
      WHERE line.organization_id = $1 AND line.sales_order_version_id = $2 AND line.supply_route IN ('buy', 'make', 'dropship') AND line.item_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tenant.sales_order_supply supply WHERE supply.organization_id = line.organization_id AND supply.sales_order_id = $3
          AND supply.item_id = line.item_id AND supply.route = line.supply_route AND supply.document_id IS NOT NULL)
      ORDER BY line.sequence`, [context.organizationId, order.current_version_id, order.id])).rows;
  if (!lines.length) return [];
  const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ?? null);
  const written = [];
  for (const route of ["buy", "make", "dropship"]) {
    const routed = lines.filter((line) => line.supply_route === route);
    if (!routed.length) continue;
    const asked = routed.map((line) => ({ sequence: line.sequence, lineId: line.id, itemId: line.item_id, quantity: String(Number(line.quantity)), uomId: line.uom_id,
      warehouseId: line.warehouse_id, requiredBy: day(line.required_by) }));
    const outcome = await guarded(client, () => (route === "buy" ? buyForSalesOrder(client, context, order, asked)
      : route === "dropship" ? dropshipForSalesOrder(client, context, order, asked)
      : makeForSalesOrder(client, context, order, routed.map((line) => ({ sequence: line.sequence, lineId: line.id, itemId: line.item_id })))));
    const results = Array.isArray(outcome) ? outcome : [{ sequences: routed.map((line) => line.sequence), error: outcome.error }];
    for (const result of results)
      for (const sequence of result.sequences) {
        const line = routed.find((candidate) => candidate.sequence === sequence);
        const row = (await client.query(
          `INSERT INTO tenant.sales_order_supply (organization_id, sales_order_id, line_sequence, item_id, route, quantity, document_type, document_id, document_number, error, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [context.organizationId, order.id, sequence, line.item_id, route, line.quantity, result.documentType ?? null, result.documentId ?? null, result.documentNumber ?? null,
            result.error ?? null, context.userId ?? null])).rows[0];
        written.push(row);
      }
  }
  return written;
}

// What the order raised: [{ sequence, itemId, itemName, route, quantity, documentType, documentId, documentNumber, error, at }], newest first.
export async function getSalesOrderSupply(client, context, orderId) {
  const rows = (await client.query(
    `SELECT supply.*, item.name AS item_name FROM tenant.sales_order_supply supply LEFT JOIN tenant.items item ON item.id = supply.item_id
      WHERE supply.organization_id = $1 AND supply.sales_order_id = $2 ORDER BY supply.created_at DESC, supply.line_sequence`, [context.organizationId, orderId])).rows;
  return rows.map((row) => ({ sequence: row.line_sequence, itemId: row.item_id, itemName: row.item_name, route: row.route, quantity: Number(row.quantity), documentType: row.document_type,
    documentId: row.document_id, documentNumber: row.document_number, error: row.error, at: row.created_at }));
}
