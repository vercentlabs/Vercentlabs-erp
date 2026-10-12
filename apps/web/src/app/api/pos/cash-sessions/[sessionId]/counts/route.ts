import { z } from "zod";

import { submitCashSessionCount } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// POST: a closing count or recount for this cash session (the same blind count as Shift Closing; a repeated key returns the same count).
const schema = z.object({
  countedAmount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
  denominations: z.array(z.object({ denomination: z.number().positive(), count: z.number().int().min(0) })).max(20).optional(),
  countedConfirmed: z.boolean(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ count: await submitCashSessionCount(client, context, sessionId, input) }), 201, "pos.shift.close");
}
