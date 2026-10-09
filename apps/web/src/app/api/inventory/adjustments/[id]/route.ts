import { getInventoryAdjustment, updateDraftAdjustment } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ detail: await getInventoryAdjustment(client, context, id) }), STOCK_ADJUSTMENT_PERMISSIONS.view);
}

// A draft's header and lines (lines replaced as a whole), with expectedVersion. Unchanged counts keep the stock they were counted against.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await updateDraftAdjustment(client, context, id, input) }), 200,
    STOCK_ADJUSTMENT_PERMISSIONS.edit);
}
