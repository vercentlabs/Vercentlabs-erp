import { z } from "zod";

import { confirmPosRefundCash } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// POST: cash handed to the customer for a waiting cash component — recorded once in your open cash session.
const schema = z.object({ componentId: z.string().uuid().optional() });

export async function POST(request: Request, { params }: Params) {
  const { refundId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ refund: await confirmPosRefundCash(client, context, refundId, input) }), 200, "pos.view");
}
