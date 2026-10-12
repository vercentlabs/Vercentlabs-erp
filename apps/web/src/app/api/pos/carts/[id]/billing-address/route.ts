import { z } from "zod";

import { setPosCartBillingAddress } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Which of the named customer's billing addresses the bill is invoiced to (CUSTOMER_SELECT); tax is worked out again for its state.
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({ billingAddressId: z.string().uuid(), expectedVersion: z.number().int(), idempotencyKey: z.string().min(8).max(100).optional() });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await setPosCartBillingAddress(client, context, id, input) }), 200, "pos.sale.create");
}
