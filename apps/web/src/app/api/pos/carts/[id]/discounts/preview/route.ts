import { z } from "zod";

import { previewPosCartDiscount } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What a proposed bill discount would do (eligible value, shares, tax, totals) and whether the cashier may give it. Nothing is saved, no
// approval is used, the bill's version does not change.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({
    type: z.enum(["percent", "amount", "percentage", "fixed", "PERCENTAGE", "FIXED_AMOUNT"]),
    value: z.union([z.string().trim().max(20), z.number().nonnegative()]),
  });
  return posMutation(request, schema, async (client, context, input) => ({
    preview: await previewPosCartDiscount(client, context, id, { type: input.type, value: String(input.value) }),
  }), 200, "pos.view");
}
