import { z } from "zod";

import { setPosQuickProducts } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string }> };

// body: { products: [{ itemId, uomId? }] } — the outlet's quick products, in order (at most 12).
export async function PUT(request: Request, { params }: Params) {
  const { outletId } = await params;
  const entry = z.object({ itemId: z.string().uuid(), uomId: z.string().uuid().nullable().optional() });
  return posMutation(request, z.object({ products: z.array(entry).max(12) }), async (client, context, input) => setPosQuickProducts(client, context, outletId, input.products));
}
