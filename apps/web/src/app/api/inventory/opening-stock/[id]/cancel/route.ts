import { z } from "zod";

import { cancelOpeningStock } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// A draft only; body: { reason? }.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ document: await cancelOpeningStock(client, context, id, input) }), 200, OPENING_STOCK_PERMISSIONS.view);
}
