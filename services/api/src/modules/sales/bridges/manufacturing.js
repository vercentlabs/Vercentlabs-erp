// The Sales + Manufacturing bridge (Sales report Phase 3, make-to-order): a confirmed order's "make" lines each get a draft manufacturing
// order, planned from the line's demand (the same as Manufacturing › From sales does), for what stock and production do not already
// cover. Raised as the person confirming, who need not be a planner.
import { appOn } from "../../../core/access/apps.js";
import { createManufacturingOrderFromSales, getSalesDemand } from "../../manufacturing/demand/demand-service.js";
import { syncDemands } from "../../manufacturing/demand/demand-engine.js";

export const manufacturingOn = (client, context) => appOn(client, context, "manufacturing");
const internal = (context) => ({ ...context, apps: undefined, permissions: [...new Set([...(context.permissions ?? []),
  "manufacturing.demand.view", "manufacturing.demand.create_mo", "manufacturing.mo.create", "manufacturing.mo.view"])] });

// lines: [{ sequence, lineId, itemId }]. Returns [{ sequences, documentType, documentId, documentNumber } | { sequences, error }].
export async function makeForSalesOrder(client, context, order, lines) {
  if (!(await manufacturingOn(client, context))) return [{ sequences: lines.map((line) => line.sequence), error: "Manufacturing is not switched on: plan production by hand." }];
  const c = internal(context);
  await syncDemands(client, c, { orderId: order.id });
  const results = [];
  for (const line of lines) {
    const demand = (await client.query("SELECT id FROM tenant.manufacturing_sales_demands WHERE organization_id = $1 AND sales_order_line_id = $2 AND planning_status <> 'CANCELLED'",
      [context.organizationId, line.lineId])).rows[0];
    if (!demand) { results.push({ sequences: [line.sequence], error: "This product has no bill of materials, so it cannot be made. Add one in Manufacturing." }); continue; }
    const shown = await getSalesDemand(client, c, demand.id);
    if (!(Number(shown.quantities.plannable) > 0)) { results.push({ sequences: [line.sequence], error: "Stock and production already cover it." }); continue; }
    const made = await createManufacturingOrderFromSales(client, c, { lines: [{ demandId: demand.id, quantity: shown.quantities.plannable }],
      idempotencyKey: `sales-supply:${order.id}:${order.version_number}:${line.sequence}` });
    const number = (await client.query("SELECT mo_number FROM tenant.manufacturing_orders WHERE organization_id = $1 AND id = $2", [context.organizationId, made.orderId])).rows[0]?.mo_number;
    results.push({ sequences: [line.sequence], documentType: "manufacturing_order", documentId: made.orderId, documentNumber: number ?? null });
  }
  return results;
}
