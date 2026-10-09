import { recordHoldReview } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Reviewer, review date, inspection notes and decision (no stock moves).
const schema = z.object({ assignedUserId: z.string().uuid().nullable().optional(), reviewDueOn: z.string().max(10).nullable().optional(), inspectionNotes: z.string().max(4000).nullable().optional(),
  inspectionResult: z.enum(["pass", "fail", "partial_pass", "escalate"]).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, schema, async (client, context, input) => ({ detail: await recordHoldReview(client, context, id, input) }), 200, STOCK_HOLD_PERMISSIONS.view);
}
