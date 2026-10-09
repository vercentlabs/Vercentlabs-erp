import { createInventoryTransfer, listInventoryTransfers } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Internal Transfers. GET ?view=&type=&mode=&sourceWarehouseId=&destinationWarehouseId=&itemId=&from=&to=&search=&limit=&offset=; POST creates a draft
// (nothing reserved or moved until it is confirmed).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["view", "type", "mode", "sourceWarehouseId", "destinationWarehouseId", "itemId", "from", "to", "search", "limit", "offset"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listInventoryTransfers(client, context, filters), STOCK_TRANSFER_PERMISSIONS.view);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await createInventoryTransfer(client, context, input) }), 201,
    STOCK_TRANSFER_PERMISSIONS.create);
}
