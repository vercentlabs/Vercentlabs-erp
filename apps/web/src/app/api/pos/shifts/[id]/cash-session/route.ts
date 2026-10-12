import { z } from "zod";

import { openPosCashSession } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: a card / UPI shift starts taking cash — count the drawer into a cash session (never an implicit ₹0).
const schema = z.object({
  openingCash: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
  denominations: z.array(z.object({ denomination: z.number().positive(), count: z.number().int().min(0) })).max(30).optional(),
  openingCashConfirmed: z.boolean(),
  sourceType: z.enum(["FRESH_FLOAT", "HANDOVER", "EXISTING_DRAWER", "ZERO_FLOAT"]).optional(),
  sourceReference: z.string().trim().max(200).optional(),
  varianceReason: z.string().trim().max(500).optional(),
  approvalId: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ shift: await openPosCashSession(client, context, id, input) }), 200, "pos.view");
}
