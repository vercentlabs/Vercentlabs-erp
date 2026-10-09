import { z } from "zod";

import { createStockCount, listStockCounts } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Stock Counts. GET ?view=&warehouseId=&countType=&from=&to=&search=&limit=&offset=; POST creates a draft (nothing frozen or counted yet).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["view", "warehouseId", "countType", "from", "to", "search", "limit", "offset"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listStockCounts(client, context, filters), STOCK_COUNT_PERMISSIONS.view);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await createStockCount(client, context, input) }), 201,
    STOCK_COUNT_PERMISSIONS.create);
}
