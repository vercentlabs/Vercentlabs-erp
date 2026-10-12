import { z } from "zod";

import { resolvePosRefundException } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ exceptionId: string }> };

// POST: resolve with evidence. For an unknown outcome: refunded (with the provider reference) settles it; not_refunded releases it for a retry.
const schema = z.object({ outcome: z.enum(["refunded", "not_refunded"]).optional(), reference: z.string().trim().max(80).optional(), note: z.string().trim().min(1).max(300) });

export async function POST(request: Request, { params }: Params) {
  const { exceptionId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ exception: await resolvePosRefundException(client, context, exceptionId, input) }), 200, "pos.view");
}
