import { z } from "zod";

import { previewPosCartLineDiscount } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string; lineId: string }> };

// What a proposed discount would do (line, tax, bill total) and whether the cashier may give it — nothing is saved.
export async function POST(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  const schema = z.object({ type: z.enum(["percent", "amount"]), value: z.union([z.string().trim().max(20), z.number().nonnegative()]) });
  return posMutation(request, schema, async (client, context, input) => ({ preview: await previewPosCartLineDiscount(client, context, id, lineId, { ...input, value: String(input.value) }) }),
    200, "pos.view");
}
