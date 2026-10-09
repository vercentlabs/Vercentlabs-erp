import { z } from "zod";

import { setWarehouseStatus, validateWarehouseForDeactivation } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string }> };

// What stands between the warehouse and Inactive (empty: it can be deactivated).
export async function GET(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryRead(request, async (client, context) => ({ blockers: await validateWarehouseForDeactivation(client, context, warehouseId) }), WAREHOUSE_PERMISSIONS.view);
}

// body: { status: active | inactive, reason?, replacementDefaultId? }
export async function POST(request: Request, { params }: Params) {
  const { warehouseId } = await params;
  return inventoryMutation(request, z.object({ status: z.string(), reason: z.string().optional(), replacementDefaultId: z.string().optional() }),
    async (client, context, input) => ({ warehouse: await setWarehouseStatus(client, context, warehouseId, input.status, input) }), 200, WAREHOUSE_PERMISSIONS.view);
}
