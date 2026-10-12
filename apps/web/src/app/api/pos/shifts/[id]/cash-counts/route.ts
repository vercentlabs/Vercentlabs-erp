import { z } from "zod";

import { submitBlindCashCount } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: the blind closing count — an amount or notes and coins, confirmed as physically counted. A recount supersedes the previous count.
const schema = z.object({ countedAmount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(), denominations: z.array(z.object({ denomination: z.number().positive(), count: z.number().int().min(0) })).max(20).optional(), countedConfirmed: z.boolean(), idempotencyKey: z.string().trim().min(8).max(120).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ count: await submitBlindCashCount(client, context, id, input) }), 201, "pos.shift.close");
}
