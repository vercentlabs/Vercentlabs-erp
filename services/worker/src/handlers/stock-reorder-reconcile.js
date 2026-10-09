import { z } from "zod";
import { reconcileLowStockAlerts, reconcileReorderStatusProjection } from "@vercentlabs/api";

export const JOB_TYPE = "stock.reorder.reconcile";

export const payloadSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();

// Daily Reorder Level reconciliation: every rule's status recalculated from the sources (stock, sales orders, purchase orders, transfers),
// then every low-stock alert checked against its status. It also catches what no event announces — a batch passing its expiry date, a
// purchase order becoming overdue. Only the planning projection and alert state are rewritten, so a re-run is harmless.
export async function reconcileReorderHandler(client, systemContext) {
  const context = { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] };
  const reorder = await reconcileReorderStatusProjection(client, context);
  const alerts = await reconcileLowStockAlerts(client, context);
  return { reorder, alerts };
}
