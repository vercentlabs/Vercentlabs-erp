import { createTransferDraftFromReorder } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// A draft internal transfer into the rule's warehouse from the source chosen. A retry with the same idempotencyKey opens the same draft.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ draft: await createTransferDraftFromReorder(client, context, id, input) }), 201,
    STOCK_REORDER_PERMISSIONS.createTransferDraft);
}
