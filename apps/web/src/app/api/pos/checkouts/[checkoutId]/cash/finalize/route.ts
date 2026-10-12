import { z } from "zod";

import { finalizePosCashPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Try again to finalise a bill whose cash is already in hand (after a stock, tax or network problem).
export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  const schema = z.object({ idempotencyKey: z.string().min(8).max(100).optional() });
  return posMutation(request, schema, async (client, context, input) => ({ cash: await finalizePosCashPayment(client, context, checkoutId, input) }), 200, "pos.sale.create");
}
