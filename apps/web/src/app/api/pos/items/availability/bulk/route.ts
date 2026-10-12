import { z } from "zod";

import { getPosBulkItemAvailability } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: availability of up to 200 items at once at one outlet (a product list, a bill) — one read, each row with its version.
const schema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(200),
  cartId: z.string().uuid().optional(),
  terminalId: z.string().uuid().optional(),
  outletId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ availability: await getPosBulkItemAvailability(client, context, input) }), 200, "pos.view");
}
