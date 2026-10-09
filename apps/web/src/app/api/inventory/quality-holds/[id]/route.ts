import { getStockHold, updateDraftStockHold } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ detail: await getStockHold(client, context, id) }), STOCK_HOLD_PERMISSIONS.view);
}

// Only a draft is changed.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await updateDraftStockHold(client, context, id, input) }), 200,
    STOCK_HOLD_PERMISSIONS.editDraft);
}
