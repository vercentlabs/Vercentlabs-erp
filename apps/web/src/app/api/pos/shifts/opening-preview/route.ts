import { z } from "zod";

import { previewShiftOpening } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: what opening this counter would do — checks, cash mode, the count against any handover, whether a supervisor must approve, payment
// methods and warnings. Nothing is saved.
const schema = z.object({
  terminalId: z.string().uuid(),
  cashEnabled: z.boolean().optional(),
  sourceType: z.enum(["FRESH_FLOAT", "HANDOVER", "EXISTING_DRAWER", "ZERO_FLOAT"]).optional(),
  openingCash: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
  denominations: z.array(z.object({ denomination: z.number().positive(), count: z.number().int().min(0) })).max(30).optional(),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ preview: await previewShiftOpening(client, context, input) }), 200, "pos.view");
}
