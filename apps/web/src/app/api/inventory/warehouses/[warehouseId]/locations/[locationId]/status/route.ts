import { z } from "zod";

import { setWarehouseLocationStatus } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string; locationId: string }> };

// body: { status: active | inactive }
export async function POST(request: Request, { params }: Params) {
  const { locationId } = await params;
  return inventoryMutation(request, z.object({ status: z.string() }), async (client, context, input) =>
    ({ location: await setWarehouseLocationStatus(client, context, locationId, input.status) }), 200, WAREHOUSE_PERMISSIONS.view);
}
