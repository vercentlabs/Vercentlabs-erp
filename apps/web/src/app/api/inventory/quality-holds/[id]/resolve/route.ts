import { resolveStockHold } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Release to available, escalate to quarantine or move to damaged — all or part of what is held. Each permission is checked by the action.
const schema = z.object({ action: z.enum(["release", "escalate", "damage"]), reason: z.string().max(1000), decision: z.enum(["pass", "fail", "partial_pass", "escalate"]).optional(),
  targetLocationId: z.string().uuid().nullable().optional(), idempotencyKey: z.string().max(200).optional(),
  entries: z.array(z.object({ allocationId: z.string().uuid(), quantity: z.union([z.string(), z.number()]).nullable().optional() })).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, schema, async (client, context, input) => ({ detail: await resolveStockHold(client, context, id, input) }), 200, STOCK_HOLD_PERMISSIONS.view);
}
