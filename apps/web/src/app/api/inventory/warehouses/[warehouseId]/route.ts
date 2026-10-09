import { z } from "zod";

import { deleteWarehouse, getWarehouse, updateWarehouse } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryRead(request, async (client, context) => ({ warehouse: await getWarehouse(client, context, warehouseId) }), WAREHOUSE_PERMISSIONS.view);
}

// Any warehouse field, expectedVersion, reason (for a code change), isDefault: true.
export async function PATCH(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) =>
    ({ warehouse: await updateWarehouse(client, context, warehouseId, input) }), 200, WAREHOUSE_PERMISSIONS.view);
}

// Only a warehouse nothing has used; anything else is deactivated.
export async function DELETE(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), (client, context) => deleteWarehouse(client, context, warehouseId), 200, WAREHOUSE_PERMISSIONS.view);
}
