// Material availability (F161): what a product's BOM needs against free stock and open purchase orders.
import { need, positive } from "./common.js";
import { explodeBom } from "./engineering.js";

const round = (n) => Math.round(n * 1e6) / 1e6;
// Purchase-order lines keep their quantity in JSON: read it defensively so one odd value cannot fail a check.
const PO_QTY = `(CASE WHEN line.data->>'quantity' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (line.data->>'quantity')::numeric ELSE 0 END)`;

export async function getMaterialAvailability(client, c, input = {}) {
  need(c, "manufacturing.view");
  const quantity = positive(input.quantity ?? 1, "Quantity");
  const explosion = await explodeBom(client, c, { bomId: input.bomId, itemId: input.itemId, quantity, asOf: input.asOf });
  const unit = await explodeBom(client, c, { bomId: input.bomId, itemId: input.itemId, quantity: 1, asOf: input.asOf });
  const lines = [];
  for (const total of explosion.purchasedTotals) {
    const stock = (await client.query(`SELECT COALESCE(sum(quantity),0) AS q,COALESCE(sum(quantity-reserved_quantity),0) AS free FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2`, [c.organizationId, total.itemId])).rows[0];
    const incoming = (await client.query(
      `SELECT COALESCE(sum(GREATEST(${PO_QTY}-line.received_quantity,0)),0) AS q FROM tenant.procurement_purchase_order_lines line JOIN tenant.procurement_purchase_orders po ON po.id=line.parent_id
        WHERE line.organization_id=$1 AND line.item_id=$2 AND po.status IN ('approved','dispatched','acknowledged','partially_received')`,
      [c.organizationId, total.itemId],
    )).rows[0];
    const required = Number(total.requiredQuantity);
    const free = Number(stock.free);
    const perUnit = Number(unit.purchasedTotals.find((u) => u.itemId === total.itemId)?.requiredQuantity ?? 0);
    lines.push({ itemId: total.itemId, itemCode: total.itemCode, itemName: total.itemName, requiredQuantity: String(required), onHand: String(round(Number(stock.q))), freeQuantity: String(round(free)), incomingQuantity: String(round(Number(incoming.q))), shortageNow: String(round(Math.max(required - free, 0))), shortageAfterIncoming: String(round(Math.max(required - free - Number(incoming.q), 0))), status: required <= free + 1e-9 ? "available" : required <= free + Number(incoming.q) + 1e-9 ? "on_order" : "short", makeableFromStock: perUnit > 0 ? Math.floor(free / perUnit) : null });
  }
  const makeable = lines.length ? Math.min(...lines.filter((l) => l.makeableFromStock !== null).map((l) => l.makeableFromStock)) : null;
  return { bomCode: explosion.bomCode, quantity: String(quantity), canMakeNow: lines.every((l) => l.status === "available"), makeableFromStock: makeable === Infinity ? null : makeable, lines };
}
