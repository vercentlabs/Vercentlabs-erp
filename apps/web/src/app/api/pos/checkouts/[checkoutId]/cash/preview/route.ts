import { z } from "zod";

import { previewPosCashPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// What a cash amount would do: settle the bill, the change, or what is still due. Nothing is recorded.
export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  const schema = z.object({ cashReceived: z.union([z.string().trim().max(30), z.number()]), currency: z.string().trim().max(3).optional() });
  return posMutation(request, schema, async (client, context, input) => ({
    preview: await previewPosCashPayment(client, context, checkoutId, { cashReceived: String(input.cashReceived), currency: input.currency }),
  }), 200, "pos.view");
}
