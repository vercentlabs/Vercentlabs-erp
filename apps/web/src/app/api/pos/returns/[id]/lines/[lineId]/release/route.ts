import { z } from "zod";

import { releasePosReturnStock } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string; lineId: string }> };

// POST: release goods held after posting — back to sellable stock, or to damaged / quarantined stock. Moves stock only; no money changes.
const schema = z.object({ dispositionCode: z.enum(["restock_approved", "damaged", "quarantined"]) });

export async function POST(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await releasePosReturnStock(client, context, id, { lineId, dispositionCode: input.dispositionCode }) }),
    200, "pos.view");
}
