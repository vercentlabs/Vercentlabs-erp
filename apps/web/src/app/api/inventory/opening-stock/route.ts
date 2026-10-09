import { z } from "zod";

import { createOpeningStock, listOpeningStocks } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// ?view=all|draft|posted|cancelled|reversed, ?search=, ?warehouseId=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = { view: url.searchParams.get("view") ?? undefined, search: url.searchParams.get("search") ?? undefined, warehouseId: url.searchParams.get("warehouseId") ?? undefined };
  return inventoryRead(request, (client, context) => listOpeningStocks(client, context, filters), OPENING_STOCK_PERMISSIONS.view);
}

// body: { warehouseId, openingDate, accountingDate?, migrationReference, sourceSystem?, externalReference?, notes?, lines? }
export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) =>
    ({ document: await createOpeningStock(client, context, input) }), 201, OPENING_STOCK_PERMISSIONS.view);
}
