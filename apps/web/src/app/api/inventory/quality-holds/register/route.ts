import { registerHeldStock } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Held stock that no case explains: an active case for it (no stock moves). input: { warehouseId, reasonId, notes?, positions: [{ itemId, locationId, batchId?, quantity }] }
const schema = z.object({ warehouseId: z.string().uuid(), reasonId: z.string().uuid(), notes: z.string().max(2000).nullable().optional(),
  positions: z.array(z.object({ itemId: z.string().uuid(), locationId: z.string().uuid(), batchId: z.string().uuid().nullable().optional(), quantity: z.union([z.string(), z.number()]) })).min(1) });

export async function POST(request: Request) {
  return inventoryMutation(request, schema, async (client, context, input) => ({ holdId: await registerHeldStock(client, context, { ...input, sourceType: "existing_stock" }) }), 201,
    STOCK_HOLD_PERMISSIONS.create);
}
