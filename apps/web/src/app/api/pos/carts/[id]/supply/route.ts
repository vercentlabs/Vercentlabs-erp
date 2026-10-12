import { z } from "zod";

import { setPosCartSupply } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Handed over at the counter, or delivered to a state: decides the place of supply; the tax is worked out again.
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({
    supplyMode: z.enum(["in_store", "delivery"]),
    deliveryStateCode: z.string().regex(/^\d{2}$/).nullish(),
    expectedVersion: z.number().int(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await setPosCartSupply(client, context, id, input) }), 200, "pos.sale.create");
}
