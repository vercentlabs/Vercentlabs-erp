import { z } from "zod";

import { createWarehouseLocation, getWarehouseLocations } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryRead(request, async (client, context) => ({ locations: await getWarehouseLocations(client, context, warehouseId) }), WAREHOUSE_PERMISSIONS.view);
}

// body: { code, name, purpose, structure, parentLocationId?, allowStock? }
export async function POST(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) =>
    ({ location: await createWarehouseLocation(client, context, warehouseId, input) }), 201, WAREHOUSE_PERMISSIONS.view);
}
