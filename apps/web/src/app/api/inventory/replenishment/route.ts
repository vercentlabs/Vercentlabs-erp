import { createReorderRule, getReorderRules } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Replenishment: reorder rules with their planning status. ?view=required|covered|below|ok|disabled|all, ?warehouseId=, ?itemId=, ?categoryId=,
// ?search=, ?overdue=true. Planning only: nothing here moves stock.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["view", "warehouseId", "itemId", "categoryId", "search", "overdue", "limit", "offset"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => getReorderRules(client, context, filters), STOCK_REORDER_PERMISSIONS.view);
}

// A reorder rule for an item at a warehouse (base units).
export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await createReorderRule(client, context, input) }), 201,
    STOCK_REORDER_PERMISSIONS.create);
}
