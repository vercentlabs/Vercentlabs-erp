import { z } from "zod";

import { releaseReservation } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ allocationId: string }> };

// Release one allocation (all, or part). body: { quantity? (all when empty), reason }
export async function POST(request: Request, { params }: Params) {
  const { allocationId } = await params;
  return inventoryMutation(request, z.object({ quantity: z.union([z.string(), z.number()]).nullable().optional(), reason: z.string() }), async (client, context, input) =>
    ({ allocation: await releaseReservation(client, context, allocationId, input) }), 200, STOCK_RESERVATION_PERMISSIONS.release);
}
