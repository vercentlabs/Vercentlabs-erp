import { z } from "zod";

import { updateWarehouseLocation } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string; locationId: string }> };

// body: { name, purpose, structure, parentLocationId, allowStock, expectedVersion }
export async function PATCH(request: Request, { params }: Params) {
  const { locationId } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) =>
    ({ location: await updateWarehouseLocation(client, context, locationId, input) }), 200, WAREHOUSE_PERMISSIONS.view);
}
