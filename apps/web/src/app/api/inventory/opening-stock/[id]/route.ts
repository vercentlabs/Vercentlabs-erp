import { z } from "zod";

import { getOpeningStock, updateDraftOpeningStock } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ document: await getOpeningStock(client, context, id) }), OPENING_STOCK_PERMISSIONS.view);
}

// A draft only: header fields, lines (the whole list), expectedVersion.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) =>
    ({ document: await updateDraftOpeningStock(client, context, id, input) }), 200, OPENING_STOCK_PERMISSIONS.view);
}
