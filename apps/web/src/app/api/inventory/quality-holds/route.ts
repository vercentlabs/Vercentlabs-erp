import { createStockHold, listStockHolds } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Quality holds: ?view=active|quality_hold|quarantine|overdue|partially_resolved|resolved|draft|cancelled|all, ?search=, ?warehouseId=, ?itemId=, ?reasonId=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["view", "search", "warehouseId", "itemId", "reasonId"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listStockHolds(client, context, filters), STOCK_HOLD_PERMISSIONS.view);
}

// A draft hold (no stock effect until it is placed).
export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await createStockHold(client, context, input) }), 201,
    STOCK_HOLD_PERMISSIONS.create);
}
