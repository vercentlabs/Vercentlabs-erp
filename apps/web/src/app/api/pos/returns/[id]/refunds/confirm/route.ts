import { z } from "zod";

import { confirmPosReturnRefund } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: confirm a waiting refund — cash handed to the customer (from your open session), or a refund made outside the provider with its
// reference. Each once.
const schema = z.object({ paymentId: z.string().uuid().optional(), externalReference: z.string().trim().max(80).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await confirmPosReturnRefund(client, context, id, input) }), 200, "pos.view");
}
