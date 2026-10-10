import { z } from "zod";

import { selectPosCustomer } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Link a Customer Master customer (CUSTOMER_SELECT): their pricing and tax apply; earlier approvals no longer count.
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({ customerId: z.string().uuid(), expectedVersion: z.number().int(), idempotencyKey: z.string().min(8).max(100).optional() });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await selectPosCustomer(client, context, id, input) }), 200, "pos.sale.create");
}
