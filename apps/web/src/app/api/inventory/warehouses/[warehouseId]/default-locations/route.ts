import { z } from "zod";

import { setDefaultWarehouseLocation } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string }> };

// body: { kind: receiving | returns | shipping, locationId: string | null } (null: MAIN).
export async function PUT(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryMutation(request, z.object({ kind: z.string(), locationId: z.string().nullable() }), async (client, context, input) =>
    ({ locations: await setDefaultWarehouseLocation(client, context, warehouseId, input.kind, input.locationId) }), 200, WAREHOUSE_PERMISSIONS.view);
}
