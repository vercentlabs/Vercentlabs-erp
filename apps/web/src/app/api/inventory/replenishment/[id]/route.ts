import { getReorderRule, updateReorderRule } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// One rule recalculated now, with its demand, incoming, other warehouses, preferred supplier, recommendation and history.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ detail: await getReorderRule(client, context, id) }), STOCK_REORDER_PERMISSIONS.view);
}

// Change the reorder level, target, multiple or notes, or enable / disable the rule (expectedVersion guards a concurrent edit).
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await updateReorderRule(client, context, id, input) }), 200,
    STOCK_REORDER_PERMISSIONS.view);
}
