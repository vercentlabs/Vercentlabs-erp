import { createInventoryAdjustment, listInventoryAdjustments } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Stock Adjustments. GET ?status=&warehouseId=&reasonId=&itemId=&direction=&from=&to=&postedBy=&search=&limit=&offset=; POST creates a draft (nothing moves).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "warehouseId", "reasonId", "itemId", "direction", "from", "to", "postedBy", "search", "limit", "offset"]
    .map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listInventoryAdjustments(client, context, filters), STOCK_ADJUSTMENT_PERMISSIONS.view);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await createInventoryAdjustment(client, context, input) }), 201,
    STOCK_ADJUSTMENT_PERMISSIONS.create);
}
