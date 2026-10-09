import { z } from "zod";

import { getWarehouseAccess, setWarehouseAccess } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryRead(request, async (client, context) => ({ access: await getWarehouseAccess(client, context, warehouseId) }), WAREHOUSE_PERMISSIONS.view);
}

// body: { entries: [{ userId, operations }] }, the whole list; empty opens the warehouse to everyone with the permissions.
export async function PUT(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryMutation(request, z.object({ entries: z.array(z.object({ userId: z.string(), operations: z.array(z.string()).optional() })) }),
    async (client, context, input) => ({ access: await setWarehouseAccess(client, context, warehouseId, input.entries) }), 200, WAREHOUSE_PERMISSIONS.view);
}
