import { z } from "zod";

import { setWalkInCustomer } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Back to walk-in: the customer link goes and the retail price applies again (the customer record stays).
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({ expectedVersion: z.number().int(), idempotencyKey: z.string().min(8).max(100).optional() });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await setWalkInCustomer(client, context, id, input) }), 200, "pos.sale.create");
}
