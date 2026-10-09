import { z } from "zod";

import { releaseInventoryReservation } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Inventory releases another document's reservation (all, or part: newest allocation first). body: { quantity? (base), reason }
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.object({ quantity: z.union([z.string(), z.number()]).nullable().optional(), reason: z.string() }), async (client, context, input) =>
    ({ detail: await releaseInventoryReservation(client, context, id, input) }), 200, STOCK_RESERVATION_PERMISSIONS.release);
}
