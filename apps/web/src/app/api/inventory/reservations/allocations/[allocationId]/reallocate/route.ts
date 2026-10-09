import { z } from "zod";

import { reallocateStockReservation } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ allocationId: string }> };

// Move one allocation to another warehouse, location, batch or serial number — the old guarantee is given up only when the new one is secured, in
// one transaction. body: { warehouseId?, locationId?, batchId?, serialId?, reason }. Another warehouse needs its own permission (checked inside).
export async function POST(request: Request, { params }: Params) {
  const { allocationId } = await params;
  return inventoryMutation(request, z.object({ warehouseId: z.string().nullable().optional(), locationId: z.string().nullable().optional(), batchId: z.string().nullable().optional(),
    serialId: z.string().nullable().optional(), reason: z.string() }), async (client, context, input) => ({ result: await reallocateStockReservation(client, context, allocationId, input) }), 200,
    STOCK_RESERVATION_PERMISSIONS.view);
}
