import { z } from "zod";

import { resolveDefaultWarehouse, setUserDefaultWarehouse } from "@vercentlabs/api";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// The warehouse new documents start with for the caller: their preferred one, else the company default. ?operation= narrows it.
export async function GET(request: Request) {
  const operation = new URL(request.url).searchParams.get("operation");
  return inventoryRead(request, async (client, context) => ({ default: await resolveDefaultWarehouse(client, context, operation || null) }));
}

// body: { warehouseId: string | null } (null clears the preference).
export async function PUT(request: Request) {
  return inventoryMutation(request, z.object({ warehouseId: z.string().nullable() }), async (client, context, input) =>
    ({ default: await setUserDefaultWarehouse(client, context, input.warehouseId) }));
}
