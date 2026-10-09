import { z } from "zod";

import { getStockCount, updateDraftCount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ detail: await getStockCount(client, context, id) }), STOCK_COUNT_PERMISSIONS.view);
}

// A draft's scope and settings, with expectedVersion.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await updateDraftCount(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.configure);
}
